//! Odpowiedź bota w procesie głównym: prompt z osobowości, pamięci i skilli, narzędzia z rejestru,
//! dostawca HTTP przez pętlę (`loop.ts`), claude/codex z serwerem MCP `bot` (`bridge.ts`).

import { randomUUID } from "node:crypto";
import fs from "node:fs";
import { botSystemPrompt, botTurns, type BotChat, type Routine } from "../../../src/bot";
import type { ChatEvent, ChatRequest, ToolSpec } from "../../../src/chat";
import { streamAnthropic } from "../chat/anthropic";
import { streamClaude } from "../chat/claude";
import { streamCodex } from "../chat/codex";
import { isAbort } from "../chat/http";
import { usageReport, type UsageReport } from "../chat/service";
import { streamOpenAI } from "../chat/openai";
import type { ApprovalBroker } from "./approvals";
import { ToolBridge } from "./bridge";
import { reportedCall, runBotTurn, type RunTool, type Step } from "./loop";
import type { BotStore } from "./store";
import { runTool, toolDefs, type Grant, type ToolContext } from "./tools";

export type BotServiceDeps = {
  store: BotStore;
  broker: ApprovalBroker;
  /** Most MCP (gniazdo) – uruchamiany przy pierwszej rozmowie z claude/codex. */
  bridge: () => Promise<ToolBridge>;
  /** Binarka aplikacji i `mcp-server.cjs` (serwer MCP uruchamiany jako node). */
  execPath: string;
  mcpScript: string;
  key: (p: ChatRequest["provider"]) => string | null;
  /** Przed wywołaniem dostawcy `openai` (np. start FreeToken na żądanie). */
  beforeOpenAI?: (req: ChatRequest, signal: AbortSignal, emit: (e: ChatEvent) => void) => Promise<void>;
  web?: ToolContext["web"];
  now?: () => number;
  /** Zużycie każdego wywołania modelu w odpowiedzi bota. */
  onUsage?: (r: UsageReport & { bot: string }) => void;
};

export class BotService {
  private running = new Map<string, AbortController>();
  /** Zgody „w tej rozmowie” (do zamknięcia aplikacji). */
  private grants = new Map<string, Grant[]>();
  /** Prompt systemowy z pierwszej odpowiedzi w rozmowie: zmiany pamięci widać w następnej rozmowie,
   *  a prefiks się nie zmienia (cache dostawcy). */
  private prompts = new Map<string, string>();

  constructor(private deps: BotServiceDeps) {}

  /** `chat` z ostatnim pytaniem; `req`: dostawca, model, sesja CLI i `prompt` jak w Czacie.
   *  `routine`: przebieg z harmonogramu (zgody z góry z `allow`, nazwa zadania w prompcie).
   *  Ostatnie zdarzenie to zawsze `done` albo `error`. */
  async send(reqId: string, chat: BotChat, req: ChatRequest, emit: (e: ChatEvent) => void, routine?: Routine): Promise<void> {
    const ctl = new AbortController();
    this.running.get(reqId)?.abort();
    this.running.set(reqId, ctl);
    const out = (e: ChatEvent) => {
      if (e.type === "usage") this.deps.onUsage?.({ ...usageReport(req, e), bot: chat.bot });
      if (!ctl.signal.aborted) emit(e);
    };
    try {
      await this.turn(chat, req, ctl.signal, out, routine);
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

  /** `keep`: odpowiedzi, które mają przetrwać (przebiegi harmonogramu przy przeładowaniu strony). */
  abortAll(keep: (reqId: string) => boolean = () => false): void {
    for (const [id, ctl] of this.running) {
      if (keep(id)) continue;
      ctl.abort();
      this.running.delete(id);
    }
  }

  private system(chat: BotChat, routine?: Routine): string {
    const cached = this.prompts.get(chat.id);
    if (cached !== undefined) return cached;
    const { store } = this.deps;
    const bot = store.load(chat.bot)!;
    const mem = store.memory(bot.id);
    const prompt = botSystemPrompt(bot, {
      memory: mem.memory,
      user: mem.user,
      skills: store.skills(bot.id).filter((s) => !s.error),
      now: (this.deps.now ?? Date.now)(),
      work: store.work(bot.id),
      ...(routine ? { routine: routine.name } : {}),
      ...(bot.builtin === "creator" ? { bots: store.list().bots } : {}),
    });
    this.prompts.set(chat.id, prompt);
    return prompt;
  }

  private async turn(chat: BotChat, req: ChatRequest, signal: AbortSignal, emit: (e: ChatEvent) => void, routine?: Routine): Promise<void> {
    const { store, broker, key } = this.deps;
    const bot = store.load(chat.bot);
    if (!bot) throw new Error(`nie ma bota „${chat.bot}”`);
    const work = store.work(bot.id);
    fs.mkdirSync(work, { recursive: true });
    let grants = this.grants.get(chat.id);
    if (!grants) this.grants.set(chat.id, (grants = []));
    const model = { provider: req.provider.id, model: req.model };
    const ctx: ToolContext = { store, bot, chat: chat.id, broker, grants, signal, model, routine: routine?.allow, web: this.deps.web, now: this.deps.now };
    const run: RunTool = (name, args) => runTool(name, args, ctx);
    const tools: ToolSpec[] = chat.toolsUnsupported ? [] : toolDefs(bot);
    const base: ChatRequest = { ...req, system: this.system(chat, routine), search: false };

    switch (req.provider.kind) {
      case "openai":
      case "anthropic": {
        const k = key(req.provider);
        const step: Step =
          req.provider.kind === "openai"
            ? async (r, s, e) => {
                await this.deps.beforeOpenAI?.(r, s, e);
                return streamOpenAI(r, k, s, e);
              }
            : (r, s, e) => streamAnthropic(r, k, s, e);
        return runBotTurn({ ...base, turns: botTurns(chat) }, tools, step, run, signal, emit);
      }
      case "claude-cli":
      case "codex-cli": {
        // Wbudowane wyszukiwanie CLI tylko z grupą „sieć”; reszta narzędzi wyłącznie z serwera `bot`.
        const cliReq: ChatRequest = { ...base, search: bot.tools.web };
        const stream = req.provider.kind === "claude-cli" ? streamClaude : streamCodex;
        if (tools.length === 0) return stream(cliReq, work, signal, emit);
        const bridge = await this.deps.bridge();
        const session = bridge.register({ tools, call: (name, args) => reportedCall({ id: randomUUID(), name, args }, run, emit) });
        try {
          // Katalog roboczy CLI = `work/` bota: ten sam przy `--resume`, a codex czyta tylko tam.
          return await stream({ ...cliReq, mcp: ToolBridge.serverSpec(this.deps.execPath, this.deps.mcpScript, session.env) }, work, signal, emit);
        } finally {
          session.dispose();
        }
      }
    }
  }
}
