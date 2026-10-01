//! Zakładka Czat w procesie głównym: konfiguracja, wykrywanie modeli, trwające odpowiedzi.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DEFAULT_PROVIDERS, type ChatEvent, type ChatRequest, type ProviderDef } from "../../../src/chat";
import { writeAtomic } from "../config";
import { isAbort } from "./http";
import { openaiModels, streamOpenAI } from "./openai";
import { streamClaude } from "./claude";

const CONFIG_FILE = "chat.json";

export type Adapter = (req: ChatRequest, signal: AbortSignal, emit: (e: ChatEvent) => void) => Promise<void>;

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

export class ChatService {
  private running = new Map<string, AbortController>();

  constructor(
    private adapters: Partial<Record<ProviderDef["kind"], Adapter>>,
    private discover: Partial<Record<ProviderDef["kind"], (p: ProviderDef) => Promise<string[]>>>,
  ) {}

  /** Uruchamia odpowiedź; zdarzenia idą do `emit`, ostatnie to zawsze `done` albo `error`. */
  async send(reqId: string, req: ChatRequest, emit: (e: ChatEvent) => void): Promise<void> {
    const adapter = this.adapters[req.provider.kind];
    if (!adapter) return emit({ type: "error", message: `dostawca „${req.provider.kind}” jeszcze nie działa` });
    const ctl = new AbortController();
    this.running.get(reqId)?.abort();
    this.running.set(reqId, ctl);
    try {
      await adapter(req, ctl.signal, (e) => {
        if (!ctl.signal.aborted) emit(e);
      });
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

/** `cwd`: pusty katalog roboczy programów CLI (bez CLAUDE.md; ten sam przy `--resume`). */
export function defaultChatService(cwd: string, key: (p: ProviderDef) => string | null = () => null): ChatService {
  return new ChatService(
    {
      openai: (req, signal, emit) => streamOpenAI(req, key(req.provider), signal, emit),
      "claude-cli": (req, signal, emit) => streamClaude(req, cwd, signal, emit),
    },
    { openai: (p) => openaiModels(p.baseUrl ?? "", key(p)) },
  );
}
