import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { newBot, newBotChat, parseBotChat, serializeBot, type BotChat, type Routine } from "../../../src/bot";
import type { ChatEvent, ChatRequest, ProviderDef } from "../../../src/chat";
import { ApprovalBroker } from "./approvals";
import { INTERRUPTED, RUN_PREFIX, Scheduler, TICK_MS, type RunInfo } from "./scheduler";
import { BotStore } from "./store";

const local = (y: number, mo: number, d: number, h = 0, mi = 0) => new Date(y, mo - 1, d, h, mi).getTime();
const claude: ProviderDef = { id: "claude", name: "Claude", kind: "claude-cli", group: "sub", models: [{ id: "haiku", name: "Haiku" }] };

/** Atrapa `BotService`: odpowiedź kończy test (`end`), Stop kończy ją jak prawdziwa usługa (`done`). */
type Sent = { reqId: string; chat: BotChat; req: ChatRequest; routine?: Routine; emit(e: ChatEvent): void; end(e?: ChatEvent): void };
let sent: Sent[] = [];
let aborted: string[] = [];
const service = {
  send(reqId: string, chat: BotChat, req: ChatRequest, emit: (e: ChatEvent) => void, routine?: Routine) {
    return new Promise<void>((resolve) => {
      sent.push({ reqId, chat, req, routine, emit, end: (e = { type: "done" }) => (emit(e), resolve()) });
    });
  },
  abort(reqId: string) {
    aborted.push(reqId);
    sent.find((s) => s.reqId === reqId)?.end();
  },
};

let dir = "";
let store: BotStore;
let now = 0;
let events: RunInfo[] = [];
let ticker: (() => void) | null = null;
let scheduler: Scheduler;

const routine = (patch: Partial<Routine> = {}): Routine => ({
  id: "rano",
  name: "Poranne newsy",
  prompt: "Przejrzyj newsy o Ruście.",
  schedule: { kind: "daily", at: "08:00" },
  allow: { writeWork: true, bash: ["cargo test"] },
  enabled: true,
  created: local(2026, 10, 1, 12),
  ...patch,
});
const addBot = (id: string, routines: Routine[], model: BotChat["model"] | null = { provider: "claude", model: "haiku" }) => {
  store.create(serializeBot(newBot(id, 1, { name: id, model })));
  store.routinesSave(id, JSON.stringify({ routines }));
};
const runs = (bot: string) => {
  const s = store.chats(bot, "runs");
  return s.list().map((m) => parseBotChat(s.load(m.id)!)!);
};
const routinesOf = (bot: string) => JSON.parse(store.routines(bot)).routines as Routine[];

beforeEach(() => {
  dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "aw-sched-")));
  store = new BotStore(path.join(dir, "bots"), path.join(dir, "trash"), () => 1000);
  sent = [];
  aborted = [];
  events = [];
  now = local(2026, 10, 2, 7, 0);
  scheduler = new Scheduler({
    store,
    service,
    providers: () => [claude],
    now: () => now,
    every: (fn, ms) => {
      expect(ms).toBe(TICK_MS);
      ticker = fn;
      return () => (ticker = null);
    },
    onRun: (r) => events.push(r),
  });
});
afterEach(() => {
  scheduler.stop();
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("Scheduler", () => {
  it("przed terminem nic; termin = przebieg z promptem zadania, zgodami i lastRun zapisanym od razu", () => {
    addBot("rusty", [routine()]);
    scheduler.start();
    expect(sent).toHaveLength(0);
    now = local(2026, 10, 2, 8, 0) + 10_000;
    ticker!();
    expect(sent).toHaveLength(1);
    const s = sent[0];
    expect(s.reqId.startsWith(RUN_PREFIX)).toBe(true);
    expect(s.routine).toMatchObject({ id: "rano", allow: { writeWork: true, bash: ["cargo test"] } });
    expect(s.req).toMatchObject({ provider: claude, model: "haiku", prompt: "Przejrzyj newsy o Ruście.", session: { resume: false } });
    expect(routinesOf("rusty")[0].lastRun).toBe(now);
    const [run] = runs("rusty");
    expect(run).toMatchObject({ routine: "rano", title: "Poranne newsy", state: "running" });
    expect(run.messages.map((m) => m.role)).toEqual(["user", "assistant"]);
    // kolejne tyknięcie w trakcie nie uruchamia drugiego
    ticker!();
    expect(sent).toHaveLength(1);
  });

  it("koniec: odpowiedź i wywołania w pliku, stan done; błąd = error", () => {
    addBot("rusty", [routine({ schedule: { kind: "every", minutes: 5 } })]);
    now = local(2026, 10, 1, 12, 5);
    scheduler.start();
    const s = sent[0];
    const reply = s.chat.messages[1].id;
    s.emit({ type: "tool_call", id: "t1", name: "web_search", args: { query: "rust" } });
    s.emit({ type: "tool_result", id: "t1", text: "wyniki", error: false, approval: "auto" });
    expect(runs("rusty")[0].calls).toHaveLength(1); // postęp zapisany przed końcem
    s.emit({ type: "text", text: "Dwa nowe wydania tokio." });
    s.end();
    const [run] = runs("rusty");
    expect(run.state).toBe("done");
    expect(run.messages.find((m) => m.id === reply)?.text).toBe("Dwa nowe wydania tokio.");
    expect(events.map((e) => e.state)).toEqual(["running", "done"]);

    now += 5 * 60_000;
    ticker!();
    sent[1].end({ type: "error", message: "limit" });
    expect(runs("rusty")[0]).toMatchObject({ state: "error" });
    expect(runs("rusty")[0].messages[1].error).toBe("limit");
  });

  it("kilka ominiętych terminów (aplikacja zamknięta, uśpienie) = jeden przebieg", () => {
    addBot("rusty", [routine({ lastRun: local(2026, 9, 28, 8, 0) })]);
    now = local(2026, 10, 2, 13, 0);
    scheduler.start();
    expect(sent).toHaveLength(1);
    sent[0].end();
    for (let i = 0; i < 10; i++) {
      now += TICK_MS;
      ticker!();
    }
    expect(sent).toHaveLength(1);
    now = local(2026, 10, 3, 8, 0); // komputer uśpiony do rana: jedno tyknięcie wystarcza
    ticker!();
    expect(sent).toHaveLength(2);
  });

  it("najwyżej 2 naraz; zwolnione miejsce bierze następny z kolejki", () => {
    const due = routine({ schedule: { kind: "every", minutes: 5 }, lastRun: local(2026, 10, 2, 6, 0) });
    addBot("a", [due]);
    addBot("b", [due]);
    addBot("c", [due]);
    scheduler.start();
    expect(sent.map((s) => s.chat.bot)).toEqual(["a", "b"]);
    expect(runs("c")).toHaveLength(0);
    sent[0].end();
    expect(sent.map((s) => s.chat.bot)).toEqual(["a", "b", "c"]);
  });

  it("czekający na zgodę: stan w pliku, miejsce dla kolejnego, po decyzji znowu running", () => {
    const broker = new ApprovalBroker((e) => scheduler.approvalChanged(e));
    const due = routine({ schedule: { kind: "every", minutes: 5 }, lastRun: local(2026, 10, 2, 6, 0) });
    for (const id of ["a", "b", "c"]) addBot(id, [due]);
    scheduler.start();
    const first = sent[0];
    const decision = broker.request({ bot: "a", chat: first.chat.id, tool: "bash", title: "Uruchomić?", canGrant: true }, new AbortController().signal);
    expect(runs("a")[0].state).toBe("waiting_approval");
    expect(scheduler.runs().find((r) => r.bot === "a")?.state).toBe("waiting_approval");
    expect(sent.map((s) => s.chat.bot)).toEqual(["a", "b", "c"]);
    // przeładowanie strony nie odrzuca próśb przebiegów
    broker.denyAll((req) => scheduler.owns(req.chat));
    expect(broker.list()).toHaveLength(1);
    broker.decide(broker.list()[0].id, "once");
    return decision.then((d) => {
      expect(d).toBe("once");
      expect(runs("a")[0].state).toBe("running");
    });
  });

  it("wyłączone zadanie i zepsuty routines.json pomijane; brak dostawcy = przebieg z błędem bez wywołania", () => {
    addBot("off", [routine({ enabled: false, lastRun: 0 })]);
    addBot("lost", [routine({ lastRun: local(2026, 10, 1, 8, 0) })], { provider: "nie-ma", model: "x" });
    store.create(serializeBot(newBot("broken", 1)));
    fs.writeFileSync(path.join(dir, "bots", "broken", "routines.json"), "{");
    now = local(2026, 10, 2, 9, 0);
    scheduler.start();
    expect(sent).toHaveLength(0);
    expect(runs("off")).toHaveLength(0);
    const [run] = runs("lost");
    expect(run.state).toBe("error");
    expect(run.messages[1].error).toContain("nie ma dostawcy");
    now += TICK_MS;
    ticker!();
    expect(runs("lost")).toHaveLength(1); // lastRun zapisany: nie powtarza co tyknięcie
  });

  it("stop przerywa trwające (zapisane jako przerwane); start oznacza przerwane z poprzedniego uruchomienia", () => {
    addBot("rusty", [routine({ lastRun: local(2026, 10, 1, 8, 0) })]);
    now = local(2026, 10, 2, 9, 0);
    scheduler.start();
    sent[0].emit({ type: "text", text: "Zaczynam…" });
    scheduler.stop();
    expect(aborted).toEqual([sent[0].reqId]);
    expect(ticker).toBeNull();
    expect(runs("rusty")[0]).toMatchObject({ state: "error" });
    expect(runs("rusty")[0].messages[1]).toMatchObject({ text: "Zaczynam…", error: INTERRUPTED });

    // plik „w trakcie” po twardym zamknięciu
    const stale: BotChat = { ...newBotChat("cccccccc-0001", "rusty", 5, { provider: "claude", model: "haiku" }, "rano"), state: "waiting_approval" };
    stale.messages = [
      { id: "u", role: "user", text: "x", at: 5 },
      { id: "a", role: "assistant", text: "", at: 5 },
    ];
    store.chatSave(JSON.stringify(stale));
    new Scheduler({ store, service, providers: () => [claude], now: () => now, every: () => () => {} }).start();
    const after = runs("rusty").find((c) => c.id === "cccccccc-0001")!;
    expect(after.state).toBe("error");
    expect(after.messages[1].error).toBe(INTERRUPTED);
  });
});
