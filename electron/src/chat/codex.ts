//! ChatGPT z subskrypcji: `codex exec --json`. Bez konfiguracji użytkownika (MCP, reguły),
//! piaskownica tylko do odczytu w pustym katalogu, wyszukiwanie przez natywne `web_search`.
//! `exec` nie strumieniuje tekstu: odpowiedź przychodzi w całości w `item.completed`.

import type { ChatEvent, ChatRequest } from "../../../src/chat";
import { runCli, type LineParser } from "./cli";

/** Wartość `-c klucz=wartość` jako napis TOML (JSON escaping jest poprawnym TOML basic string). */
const toml = (s: string) => JSON.stringify(s);
export const MCP_TOOL_TIMEOUT_SEC = 6 * 60 * 60;

export function codexArgs(req: ChatRequest): string[] {
  const resume = req.session?.resume ? ["resume"] : [];
  const args = [
    "exec", ...resume, "--json", "--skip-git-repo-check", "--ignore-user-config", "--ignore-rules",
    "-c", 'sandbox_mode="read-only"',
    "-c", 'model_reasoning_effort="low"',
    "-c", `web_search=${req.search ? '"live"' : '"disabled"'}`,
    "-c", `developer_instructions=${toml(req.system)}`,
  ];
  if (req.mcp) {
    // Serwer `bot` z `-c`, bo `--ignore-user-config` pomija config.toml. Zgoda jest w narzędziu:
    // codex nie pyta sam (w `exec` odrzuciłby wywołanie), a limit czasu przetrwa czekanie na kliknięcie.
    const env = Object.entries(req.mcp.env).map(([k, v]) => `${k} = ${toml(v)}`).join(", ");
    args.push(
      "-c", `mcp_servers.bot.command=${toml(req.mcp.command)}`,
      "-c", `mcp_servers.bot.args=${JSON.stringify(req.mcp.args)}`,
      "-c", `mcp_servers.bot.env={ ${env} }`,
      "-c", `mcp_servers.bot.tool_timeout_sec=${MCP_TOOL_TIMEOUT_SEC}`,
      "-c", 'mcp_servers.bot.default_tools_approval_mode="approve"',
    );
  }
  if (req.model) args.push("-m", req.model);
  if (req.session?.resume) args.push(req.session.id);
  return args; // polecenie na stdin
}

type Item = { type?: string; text?: string; query?: string; action?: { type?: string; query?: string; url?: string } };
type Line = { type?: string; thread_id?: string; item?: Item; error?: { message?: string }; message?: string };

export class CodexParser implements LineParser {
  private pending: string | null = null; // ostatnia wiadomość: odpowiedź albo zapowiedź przed narzędziem
  private error: string | null = null;

  line(obj: unknown): ChatEvent[] {
    const d = obj as Line;
    const out: ChatEvent[] = [];
    const item = d.item;
    switch (d.type) {
      case "thread.started":
        if (d.thread_id) out.push({ type: "session", id: d.thread_id });
        break;
      case "item.completed":
        if (item?.type === "agent_message" && item.text) {
          // Wcześniejsza wiadomość w tej turze to zapowiedź („Sprawdzę…”), nie odpowiedź.
          if (this.pending) out.push({ type: "thinking", text: `${this.pending}\n` });
          this.pending = item.text;
        } else if (item?.type === "reasoning" && item.text) {
          out.push({ type: "thinking", text: `${item.text}\n` });
        } else if (item?.type === "web_search") {
          const a = item.action;
          const q = a?.query || item.query || a?.url;
          if (q) out.push({ type: "search", query: q });
          if (a?.type === "open_page" && a.url) out.push({ type: "found", url: a.url, title: "" });
        }
        break;
      case "turn.completed":
        if (this.pending) out.push({ type: "text", text: this.pending });
        this.pending = null;
        break;
      case "turn.failed":
        this.error = d.error?.message ?? "codex: nieudana tura";
        break;
      case "error":
        // „Reconnecting… n/5” to ponowienia; liczy się dopiero `turn.failed`.
        break;
    }
    return out;
  }

  failure(): string | null {
    if (!this.error) return null;
    const m = /The model `([^`]+)` does not exist or you do not have access/.exec(this.error);
    if (m) return `model ${m[1]} niedostępny w tej subskrypcji ChatGPT`;
    if (/usage limit|rate limit/i.test(this.error)) return `limit subskrypcji ChatGPT: ${this.error}`;
    return this.error.replace(/, url: \S+.*$/, "");
  }
}

export function streamCodex(req: ChatRequest, cwd: string, signal: AbortSignal, emit: (e: ChatEvent) => void): Promise<void> {
  return runCli(req.provider.command || "codex", codexArgs(req), req.prompt, cwd, new CodexParser(), signal, emit);
}
