//! Harmonogram botów: jeden zegar dla zadań wszystkich botów, przebiegi najwyżej po 2 naraz.
//! Działa tylko przy otwartej aplikacji. Termin liczony z czasu ściennego przy każdym tyknięciu
//! (`routineDue`), więc uśpienie komputera ani zgubione tyknięcia niczego nie przesuwają.
//! Przebieg = rozmowa w `runs/` ze stanem (`state`); prośba o zgodę zatrzymuje go na
//! „czeka na zgodę” – nikt nie odpowiada za użytkownika.

import { t } from "../i18n";
import { randomUUID } from "node:crypto";
import {
  applyBotEvent,
  newBotChat,
  parseBotChat,
  parseRoutines,
  routineDue,
  runModel,
  type BotChat,
  type Routine,
  type RunInfo,
  type RunState,
} from "../../../src/bot";

export type { RunInfo };
import { applyEvent, extractSources, modelKey, type ChatEvent, type ChatRequest, type Message, type ProviderDef } from "../../../src/chat";
import type { ApprovalChange } from "./approvals";
import type { BotService } from "./service";
import type { BotStore } from "./store";

export const TICK_MS = 30_000;
export const MAX_PARALLEL = 2;
/** Prefiks `reqId` przebiegów w `BotService` (przeładowanie strony ich nie przerywa). */
export const RUN_PREFIX = "run:";
/** Ile ostatnich przebiegów bota sprawdzić przy starcie (zostały „w trakcie” po zamknięciu aplikacji). */
const RECOVER_LAST = 20;
export const INTERRUPTED = "Przerwane: aplikacja została zamknięta w trakcie przebiegu.";


export type SchedulerDeps = {
  store: BotStore;
  service: Pick<BotService, "send" | "abort">;
  /** Dostawcy z `chat.json` (czytani przy każdym przebiegu: zmiany w Czacie działają od razu). */
  providers: () => ProviderDef[];
  now?: () => number;
  /** Zegar: wywołuje `fn` co `ms`, zwraca zatrzymanie. Testy podstawiają własny. */
  every?: (fn: () => void, ms: number) => () => void;
  /** Zmiana stanu przebiegu (do okna, powiadomienia w etapie 10). */
  onRun?: (r: RunInfo) => void;
  parallel?: number;
};

type Job = { bot: string; routine: string; /** „Uruchom teraz”: także wyłączone */ manual?: boolean };
type Active = { info: RunInfo; reqId: string; chat: BotChat; waiting: Set<string> };

const keyOf = (j: Job) => `${j.bot}/${j.routine}`;
const defaultEvery = (fn: () => void, ms: number) => {
  const t = setInterval(fn, ms);
  return () => clearInterval(t);
};

export class Scheduler {
  private queue: Job[] = [];
  private active = new Map<string, Active>();
  /** Start przebiegu w tej sesji: gdy `routines.json` nie da się zapisać, zadanie i tak nie ruszy drugi raz. */
  private started = new Map<string, number>();
  private stopTimer: (() => void) | null = null;
  private stopped = false;

  constructor(private deps: SchedulerDeps) {}

  private now(): number {
    return (this.deps.now ?? Date.now)();
  }

  start(): void {
    this.stopped = false;
    this.recover();
    this.tick();
    this.stopTimer ??= (this.deps.every ?? defaultEvery)(() => this.tick(), TICK_MS);
  }

  /** Zamknięcie aplikacji: kolejka pusta, trwające przebiegi przerwane (zapisane jako przerwane). */
  stop(): void {
    this.stopped = true;
    this.stopTimer?.();
    this.stopTimer = null;
    this.queue = [];
    for (const a of this.active.values()) this.deps.service.abort(a.reqId);
  }

  /** Przebiegi w toku i w kolejce nie są w tej liście – tylko trwające (stan na teraz). */
  runs(): RunInfo[] {
    return [...this.active.values()].map((a) => ({ ...a.info }));
  }

  /** Czy rozmowa to trwający przebieg (jego prośby o zgodę przetrwają przeładowanie strony). */
  owns(chat: string): boolean {
    return [...this.active.values()].some((a) => a.info.chat === chat);
  }

  /** Jedno tyknięcie: zaległe zadania do kolejki, kolejka do wolnych miejsc. */
  tick(): void {
    if (this.stopped) return;
    const now = this.now();
    const { store } = this.deps;
    for (const bot of store.list().bots) {
      for (const r of this.routinesOf(bot.id)) {
        const key = keyOf({ bot: bot.id, routine: r.id });
        if (this.active.has(key) || this.queue.some((j) => keyOf(j) === key)) continue;
        const last = Math.max(r.lastRun ?? 0, this.started.get(key) ?? 0);
        if (routineDue(last ? { ...r, lastRun: last } : r, now)) this.queue.push({ bot: bot.id, routine: r.id });
      }
    }
    this.pump();
  }

  /** „Uruchom teraz” z karty bota: przed terminem, także wyłączone zadanie. Kolejka jak zwykle. */
  runNow(bot: string, routine: string): void {
    if (this.stopped) throw new Error("harmonogram zatrzymany");
    const key = keyOf({ bot, routine });
    if (this.active.has(key)) throw new Error(t("sched.running"));
    if (this.queue.some((j) => keyOf(j) === key)) throw new Error(t("sched.queued"));
    if (!this.routinesOf(bot).some((r) => r.id === routine)) throw new Error(`nie ma zadania „${routine}”`);
    this.queue.push({ bot, routine, manual: true });
    this.pump();
  }

  /** Zmiana w `ApprovalBroker`: przebieg czekający na zgodę nie zajmuje miejsca w kolejce. */
  approvalChanged(e: ApprovalChange): void {
    if (e.type === "request") {
      const a = [...this.active.values()].find((x) => x.info.chat === e.req.chat);
      if (!a) return;
      a.waiting.add(e.req.id);
      this.setState(a, "waiting_approval");
      this.pump();
      return;
    }
    const a = [...this.active.values()].find((x) => x.waiting.has(e.id));
    if (!a) return;
    a.waiting.delete(e.id);
    if (a.waiting.size === 0) this.setState(a, "running");
  }

  private routinesOf(bot: string): Routine[] {
    try {
      return parseRoutines(JSON.parse(this.deps.store.routines(bot))).routines;
    } catch {
      return []; // zepsuty routines.json: karta bota pokaże błąd, harmonogram go pomija
    }
  }

  private pump(): void {
    const limit = this.deps.parallel ?? MAX_PARALLEL;
    const running = () => [...this.active.values()].filter((a) => a.info.state === "running").length;
    while (!this.stopped && this.queue.length > 0 && running() < limit) this.launch(this.queue.shift()!);
  }

  private save(chat: BotChat): void {
    try {
      this.deps.store.chatSave(JSON.stringify(chat));
    } catch {
      // bot usunięty w trakcie przebiegu: nie ma gdzie zapisać
    }
  }

  private setState(a: Active, state: RunState): void {
    if (a.info.state === state) return;
    a.info.state = state;
    a.chat = { ...a.chat, state, updated: this.now() };
    this.save(a.chat);
    this.deps.onRun?.({ ...a.info });
  }

  /** `lastRun` w `routines.json` od razu przy starcie: restart w trakcie nie powtórzy przebiegu. */
  private markLastRun(bot: string, routine: string, at: number): void {
    const { store } = this.deps;
    try {
      const raw = JSON.parse(store.routines(bot)) as { routines: Record<string, unknown>[] };
      const r = raw.routines.find((x) => x?.id === routine);
      if (!r) return;
      r.lastRun = at;
      store.routinesSave(bot, `${JSON.stringify(raw, null, 2)}\n`);
    } catch {
      // zły plik: zostaje `started` z tej sesji
    }
  }

  private launch(job: Job): void {
    const { store, service } = this.deps;
    const key = keyOf(job);
    const bot = store.load(job.bot);
    const routine = this.routinesOf(job.bot).find((r) => r.id === job.routine);
    if (!bot || !routine || (!routine.enabled && !job.manual)) return;
    const now = this.now();
    this.started.set(key, now);
    this.markLastRun(bot.id, routine.id, now);

    const m = runModel(bot, this.deps.providers());
    const ref = typeof m === "string" ? (bot.model ?? { provider: "", model: "" }) : m.ref;
    const question: Message = { id: randomUUID(), role: "user", text: routine.prompt, at: now };
    const reply: Message = { id: randomUUID(), role: "assistant", text: "", at: now, model: ref };
    let chat: BotChat = { ...newBotChat(randomUUID(), bot.id, now, ref, routine.id), title: routine.name, state: "running", messages: [question, reply] };
    const info: RunInfo = { bot: bot.id, routine: routine.id, chat: chat.id, state: "running", started: now };

    if (typeof m === "string") {
      chat = { ...chat, state: "error", messages: [question, { ...reply, error: m }] };
      this.save(chat);
      this.deps.onRun?.({ ...info, state: "error" });
      return;
    }
    const session = m.provider.kind === "claude-cli" ? randomUUID() : undefined;
    if (session) chat = { ...chat, cli: { [modelKey(ref)]: session } };
    const a: Active = { info, reqId: `${RUN_PREFIX}${chat.id}`, chat, waiting: new Set() };
    this.active.set(key, a);
    this.save(chat);
    this.deps.onRun?.({ ...info });

    const req: ChatRequest = {
      provider: m.provider,
      model: ref.model,
      system: "", // BotService składa prompt bota z nazwą zadania
      messages: [{ role: "user", content: routine.prompt }],
      prompt: routine.prompt,
      session: session ? { id: session, resume: false } : undefined,
      search: false,
    };
    const onEvent = (e: ChatEvent) => {
      if (e.type === "session") {
        a.chat = { ...a.chat, cli: { ...a.chat.cli, [modelKey(ref)]: e.id } };
      } else if (e.type === "done" || e.type === "error") {
        this.finish(key, a, reply.id, e);
      } else {
        a.chat = applyBotEvent(a.chat, reply.id, e);
        if (e.type === "tool_result") this.save(a.chat); // postęp widać w pliku przed końcem
      }
    };
    void service.send(a.reqId, chat, req, onEvent, routine);
  }

  private finish(key: string, a: Active, replyId: string, e: ChatEvent): void {
    let failed = e.type === "error";
    a.chat = {
      ...a.chat,
      messages: a.chat.messages.map((m) => {
        if (m.id !== replyId) return m;
        const done = extractSources(applyEvent(m, e));
        if (this.stopped && e.type === "done") return { ...done, stopped: true, error: INTERRUPTED };
        if (done.error) failed = true;
        return done;
      }),
    };
    if (this.stopped) failed = true;
    this.active.delete(key);
    a.info.state = failed ? "error" : "done";
    a.chat = { ...a.chat, state: a.info.state, updated: this.now() };
    this.save(a.chat);
    this.deps.onRun?.({ ...a.info });
    this.pump();
  }

  /** Przebiegi „w trakcie” z poprzedniego uruchomienia aplikacji: oznaczone jako przerwane. */
  private recover(): void {
    const { store } = this.deps;
    for (const bot of store.list().bots) {
      let runs;
      try {
        runs = store.chats(bot.id, "runs");
      } catch {
        continue;
      }
      for (const meta of runs.list().slice(0, RECOVER_LAST)) {
        const c = parseBotChat(runs.load(meta.id) ?? "");
        if (!c || (c.state !== "running" && c.state !== "waiting_approval")) continue;
        const last = c.messages.length - 1;
        const messages = c.messages.map((m, i) => (i === last && m.role === "assistant" && !m.error ? { ...m, error: INTERRUPTED } : m));
        this.save({ ...c, messages, state: "error" });
      }
    }
  }
}
