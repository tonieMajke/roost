//! „Szukaj w sieci” dla modeli lokalnych i API: `pi -p --mode json` z samym rozszerzeniem
//! pi-web-access (narzędzia web_search, fetch_content). Własny katalog agenta pi z jednym
//! dostawcą (wybranym modelem); klucz API idzie zmienną środowiskową, nie do pliku.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { ChatEvent, ChatRequest } from "../../../src/chat";
import { writeAtomic } from "../config";
import { runCli, type LineParser } from "./cli";

const KEY_VAR = "AW_CHAT_API_KEY";
const PROVIDER = "aw";
const TOOLS = "web_search,fetch_content";

/** Katalog rozszerzenia pi-web-access z instalacji pi użytkownika; `null` = brak. */
export function webAccessDir(home = os.homedir()): string | null {
  const dir = path.join(home, ".pi", "agent", "npm", "node_modules", "pi-web-access");
  return fs.existsSync(path.join(dir, "package.json")) ? dir : null;
}

/** `models.json` dla pi z jednym dostawcą i jednym modelem z żądania. */
export function piModelsJson(req: ChatRequest): string {
  const anthropic = req.provider.kind === "anthropic";
  return JSON.stringify(
    {
      providers: {
        [PROVIDER]: {
          baseUrl: anthropic ? (req.provider.baseUrl ?? "").replace(/\/v1$/, "") : req.provider.baseUrl,
          api: anthropic ? "anthropic-messages" : "openai-completions",
          apiKey: `$${KEY_VAR}`,
          models: [
            {
              id: req.model,
              name: req.model,
              reasoning: false,
              input: ["text"],
              contextWindow: 131072,
              maxTokens: 16384,
              cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
              ...(anthropic ? {} : { compat: { supportsDeveloperRole: false, supportsStore: false, maxTokensField: "max_tokens" } }),
            },
          ],
        },
      },
    },
    null,
    2,
  );
}

export function piArgs(req: ChatRequest, extension: string): string[] {
  return [
    "-p", "--mode", "json", "--no-session", "-ne", "-e", extension, "--tools", TOOLS,
    "--no-skills", "-np", "--no-themes", "-nc", "--thinking", "off",
    "--provider", PROVIDER, "--model", req.model, "--system-prompt", req.system,
  ];
}

type Line = {
  type?: string;
  assistantMessageEvent?: { type?: string; delta?: string };
  toolName?: string;
  args?: { query?: string; queries?: string[]; url?: string; urls?: string[] };
  entry?: { customType?: string; data?: { queries?: { results?: { url?: string; title?: string }[] }[] } };
  message?: { role?: string; stopReason?: string; errorMessage?: string };
};

export class PiParser implements LineParser {
  private error: string | null = null;

  line(obj: unknown): ChatEvent[] {
    const d = obj as Line;
    const out: ChatEvent[] = [];
    switch (d.type) {
      case "message_update": {
        const e = d.assistantMessageEvent;
        if (e?.type === "text_delta" && e.delta) out.push({ type: "text", text: e.delta });
        else if (e?.type === "thinking_delta" && e.delta) out.push({ type: "thinking", text: e.delta });
        break;
      }
      case "tool_execution_start": {
        const a = d.args ?? {};
        for (const q of [a.query, ...(a.queries ?? []), a.url, ...(a.urls ?? [])]) if (q) out.push({ type: "search", query: q });
        break;
      }
      case "entry_appended":
        if (d.entry?.customType === "web-search-results")
          for (const q of d.entry.data?.queries ?? [])
            for (const r of q.results ?? []) if (r.url) out.push({ type: "found", url: r.url, title: r.title ?? "" });
        break;
      case "message_end":
        if (d.message?.role === "assistant" && d.message.stopReason === "error") this.error = d.message.errorMessage ?? "błąd modelu";
        break;
    }
    return out;
  }

  failure(): string | null {
    return this.error;
  }
}

/** `agentDir`: własny katalog agenta pi (models.json nadpisywany przy każdym żądaniu). */
export async function streamPi(
  req: ChatRequest,
  key: string | null,
  agentDir: string,
  cwd: string,
  signal: AbortSignal,
  emit: (e: ChatEvent) => void,
): Promise<void> {
  const ext = webAccessDir();
  if (!ext) throw new Error("wyszukiwanie dla tego modelu wymaga pi z rozszerzeniem pi-web-access (`pi install npm:pi-web-access`)");
  fs.mkdirSync(agentDir, { recursive: true });
  writeAtomic(path.join(agentDir, "models.json"), piModelsJson(req));
  if (!fs.existsSync(path.join(agentDir, "settings.json"))) writeAtomic(path.join(agentDir, "settings.json"), "{}");
  // Ustawienia wyszukiwarek użytkownika (kolejność dostawców, ich klucze) – kopia tylko do odczytu.
  const userSearch = path.join(os.homedir(), ".pi", "agent", "web-search.json");
  if (fs.existsSync(userSearch)) {
    fs.copyFileSync(userSearch, path.join(agentDir, "web-search.json"));
    fs.chmodSync(path.join(agentDir, "web-search.json"), 0o600);
  }
  const env = { PI_CODING_AGENT_DIR: agentDir, PI_OFFLINE: "1", [KEY_VAR]: key ?? "none" };
  return runCli("pi", piArgs(req, ext), req.prompt, cwd, new PiParser(), signal, emit, env);
}
