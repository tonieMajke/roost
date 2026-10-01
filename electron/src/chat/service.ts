//! Zakładka Czat w procesie głównym: konfiguracja, wykrywanie modeli, trwające odpowiedzi.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DEFAULT_PROVIDERS, type ChatEvent, type ChatRequest, type ProviderDef, type ToolCall } from "../../../src/chat";
import { writeAtomic } from "../config";
import { isAbort } from "./http";
import { openaiModels, streamOpenAI } from "./openai";
import { streamClaude } from "./claude";
import { streamCodex } from "./codex";
import { anthropicModels, streamAnthropic } from "./anthropic";
import { streamPi } from "./pi";
import { providerLabel } from "../usage-store";
import type { Usage } from "../../../src/usage";
import { ensureFreeToken, freeGpuForRouter, freetokenInstance, isRouter } from "./freetoken";

const CONFIG_FILE = "chat.json";

/** Wynik adaptera (np. wywołania narzędzi z `streamOpenAI`) Czat pomija. */
export type Adapter = (req: ChatRequest, signal: AbortSignal, emit: (e: ChatEvent) => void) => Promise<unknown>;
type AdapterKey = ProviderDef["kind"] | "pi";

/** Surowy `chat.json` (brak = powstaje z domyślnymi) i `~/.pi/agent/models.json` (tylko odczyt). */
export function chatConfigLoad(dir: string, home = os.homedir()): { chat: string; pi: string | null } {
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, CONFIG_FILE);
  let chat: string;
  try {
    chat = fs.readFileSync(file, "utf8");
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw new Error(`${file}: ${String(e)}`);
    chat = JSON.stringify({ providers: DEFAULT_PROVIDERS }, null, 2);
    writeAtomic(file, chat);
  }
  let pi: string | null = null;
  try {
    pi = fs.readFileSync(path.join(home, ".pi", "agent", "models.json"), "utf8");
  } catch {
    // pi nie zainstalowane albo bez własnych dostawców
  }
  return { chat, pi };
}

/** Zużycie jednego wywołania modelu, z dostawcą i modelem z żądania (gdy adapter go nie podał). */
export type UsageReport = { provider: string; model: string; usage: Usage; costUsd?: number };

/** Zdarzenie `usage` → raport; model z adaptera, a bez niego z żądania. */
export function usageReport(req: Pick<ChatRequest, "provider" | "model">, e: Extract<ChatEvent, { type: "usage" }>): UsageReport {
  return { provider: providerLabel(req.provider), model: e.model || req.model, usage: e.usage, ...(e.costUsd ? { costUsd: e.costUsd } : {}) };
}

export class ChatService {
  private running = new Map<string, AbortController>();

  constructor(
    private adapters: Partial<Record<AdapterKey, Adapter>>,
    private discover: Partial<Record<ProviderDef["kind"], (p: ProviderDef) => Promise<string[]>>>,
    /** Wołane dla każdego zużycia, także gdy odpowiedź przerwano (tokeny i tak poszły). */
    private onUsage?: (r: UsageReport) => void,
  ) {}

  /** Uruchamia odpowiedź; zdarzenia idą do `emit`, ostatnie to zawsze `done` albo `error`. */
  async send(reqId: string, req: ChatRequest, emit: (e: ChatEvent) => void): Promise<void> {
    // Wyszukiwanie dla dostawców HTTP idzie przez pi (adapter "pi"); CLI szukają same.
    const viaPi = req.search && (req.provider.kind === "openai" || req.provider.kind === "anthropic");
    const adapter = viaPi ? this.adapters.pi : this.adapters[req.provider.kind];
    if (!adapter) return emit({ type: "error", message: `dostawca „${req.provider.kind}” jeszcze nie działa` });
    const ctl = new AbortController();
    this.running.get(reqId)?.abort();
    this.running.set(reqId, ctl);
    try {
      const calls = await adapter(req, ctl.signal, (e) => {
        if (e.type === "usage") this.onUsage?.(usageReport(req, e));
        if (!ctl.signal.aborted) emit(e);
      });
      // Z `req.tools` wywołania wracają do strony, która wykonuje narzędzia i pyta dalej (rozmowa głosowa).
      if (req.tools?.length && Array.isArray(calls) && !ctl.signal.aborted)
        for (const c of calls as ToolCall[]) emit({ type: "tool_call", id: c.id, name: c.name, args: c.args, ...(c.bad !== undefined ? { bad: c.bad } : {}) });
      emit({ type: "done" });
    } catch (e) {
      if (ctl.signal.aborted || isAbort(e)) emit({ type: "done" });
      else emit({ type: "error", message: e instanceof Error ? e.message : String(e) });
    } finally {
      if (this.running.get(reqId) === ctl) this.running.delete(reqId);
    }
  }

  abort(reqId: string): void {
    this.running.get(reqId)?.abort();
  }

  abortAll(): void {
    for (const ctl of this.running.values()) ctl.abort();
    this.running.clear();
  }

  models(p: ProviderDef): Promise<string[]> {
    const fn = this.discover[p.kind];
    return fn ? fn(p) : Promise.resolve([]);
  }
}

/** `cwd`: pusty katalog roboczy programów CLI (bez CLAUDE.md; ten sam przy `--resume`).
 *  `piDir`: własny katalog agenta pi do wyszukiwania z modelami lokalnymi i API. */
export function defaultChatService(
  cwd: string,
  piDir: string,
  key: (p: ProviderDef) => string | null = () => null,
  onUsage?: (r: UsageReport) => void,
): ChatService {
  return new ChatService(
    {
      pi: (req, signal, emit) => streamPi(req, key(req.provider), piDir, cwd, signal, emit),
      openai: async (req, signal, emit) => {
        // FreeToken sam wstaje na żądanie (jedna instancja na dwóch kartach, port 1919); router
        // llama.cpp ładuje model sam, ale najpierw trzeba mu oddać karty zajęte przez FreeToken
        const ft = freetokenInstance(req.provider.baseUrl, req.model);
        const status = (text: string) => emit({ type: "thinking", text: `${text}\n` });
        if (ft) await ensureFreeToken(req.model, ft, signal, status);
        else if (isRouter(req.provider.baseUrl)) await freeGpuForRouter(signal, status);
        return streamOpenAI(req, key(req.provider), signal, emit);
      },
      anthropic: (req, signal, emit) => streamAnthropic(req, key(req.provider), signal, emit),
      "claude-cli": (req, signal, emit) => streamClaude(req, cwd, signal, emit),
      "codex-cli": (req, signal, emit) => streamCodex(req, cwd, signal, emit),
    },
    {
      openai: (p) => openaiModels(p.baseUrl ?? "", key(p)),
      anthropic: (p) => anthropicModels(p.baseUrl ?? "", key(p)),
    },
    onUsage,
  );
}

/** Zapis `chat.json` z okna „Dostawcy”; zły JSON albo brak listy = odrzucenie, plik bez zmian. */
export function chatConfigSave(dir: string, json: string): void {
  const parsed = JSON.parse(json) as { providers?: unknown };
  if (!Array.isArray(parsed.providers)) throw new Error("chat.json: brak tablicy `providers`");
  fs.mkdirSync(dir, { recursive: true });
  writeAtomic(path.join(dir, CONFIG_FILE), json);
}
