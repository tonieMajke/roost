import { describe, expect, it } from "vitest";
import type { ChatEvent, Turn } from "../chat";
import type { CardDecision } from "./tools";
import { VoiceSession, type VoiceDeps } from "./session";
import type { VoiceExchange, VoiceState } from "./voice";

const tick = () => new Promise((r) => setTimeout(r, 0));
const flush = async () => {
  for (let i = 0; i < 20; i++) await tick();
};

/** Atrapy z ręcznym sterowaniem: odpowiedź mózgu, synteza i odtwarzanie kończą się na żądanie. */
function rig(opts: { tts?: boolean; transcript?: string | Error; tool?: VoiceDeps["tool"]; toolResult?: VoiceDeps["toolResult"] } = {}) {
  const log: string[] = [];
  const asked: VoiceExchange[][] = [];
  const extras: Turn[][] = [];
  let send: ((e: ChatEvent) => void) | null = null;
  let stops = 0;
  const playing: { text: string; done: () => void }[] = [];
  const cancelled: string[] = [];
  let clock = 0;
  const deps: VoiceDeps = {
    transcribe: async () => {
      const t = opts.transcript ?? "cześć";
      if (t instanceof Error) throw t;
      return t;
    },
    ask: (history, extra, onEvent) => {
      asked.push(history);
      extras.push([...extra]);
      send = onEvent;
      return () => void stops++;
    },
    speak: opts.tts === false ? null : async (id, text) => new TextEncoder().encode(`${id}:${text}`),
    cancelSpeak: (id) => void cancelled.push(id),
    play: (audio, signal) =>
      new Promise<void>((resolve) => {
        const text = new TextDecoder().decode(audio);
        log.push(`play ${text}`);
        const item = { text, done: resolve };
        playing.push(item);
        signal.addEventListener("abort", () => resolve(), { once: true });
      }),
    now: () => ++clock,
    ...(opts.tool ? { tool: opts.tool } : {}),
    ...(opts.toolResult ? { toolResult: opts.toolResult } : {}),
  };
  const states: VoiceState[] = [];
  const s = new VoiceSession(deps, (st) => states.push(st));
  return {
    s,
    log,
    asked,
    extras,
    cancelled,
    /** Następne wypowiedzi rozpoznają się jako ten tekst. */
    hear: (t: string) => void (opts.transcript = t),
    states,
    stops: () => stops,
    send: (e: ChatEvent) => send!(e),
    finishPlaying: async () => {
      playing.shift()?.done();
      await flush();
    },
    /** Pełna wypowiedź użytkownika. */
    say: async () => {
      s.speechStart();
      await s.speechEnd(new Uint8Array([1]));
      await flush();
    },
  };
}

describe("VoiceSession", () => {
  it("pytanie → odpowiedź strumieniem → zdania grane po kolei → słuchanie", async () => {
    const r = rig();
    r.s.start();
    await r.say();
    expect(r.s.state.phase).toBe("thinking");
    expect(r.asked[0].map((e) => e.user)).toEqual(["cześć"]);
    r.send({ type: "text", text: "Hej. Co **słychać**" });
    await flush();
    expect(r.log).toEqual(["play 0-0:Hej."]);
    expect(r.s.state.phase).toBe("speaking");
    r.send({ type: "text", text: "? Mów." });
    r.send({ type: "done" });
    await flush();
    await r.finishPlaying();
    await r.finishPlaying();
    expect(r.log).toEqual(["play 0-0:Hej.", "play 0-1:Co słychać?", "play 0-2:Mów."]);
    expect(r.s.state.phase).toBe("speaking");
    await r.finishPlaying();
    expect(r.s.state.phase).toBe("listening");
    expect(r.s.state.history[0]).toMatchObject({ reply: "Hej. Co **słychać**? Mów.", spoken: ["Hej.", "Co **słychać**?", "Mów."], done: true });
  });

  it("mowa w trakcie odpowiedzi przerywa: Stop mózgu, anulowana synteza, cisza", async () => {
    const r = rig();
    r.s.start();
    await r.say();
    r.send({ type: "text", text: "Raz. Dwa. Trzy" });
    await flush();
    r.s.speechStart();
    expect(r.stops()).toBe(1);
    expect(r.cancelled).toEqual(["0-0", "0-1"]);
    expect(r.s.state.history[0]).toMatchObject({ interrupted: true, spoken: ["Raz."] });
    // Spóźnione zdarzenia starej odpowiedzi nic nie zmieniają.
    r.send({ type: "text", text: " cztery" });
    await r.finishPlaying();
    expect(r.log).toEqual(["play 0-0:Raz."]);
    await r.s.speechEnd(new Uint8Array([1]));
    await flush();
    expect(r.asked).toHaveLength(2);
    expect(r.asked[1].map((e) => e.user)).toEqual(["cześć", "cześć"]);
  });

  it("szum w trakcie myślenia (wolny model lokalny) nie przerywa odpowiedzi", async () => {
    const r = rig();
    r.s.start();
    await r.say();
    r.hear("");
    await r.say();
    expect(r.stops()).toBe(0);
    expect(r.asked).toHaveLength(1);
    expect(r.s.state.phase).toBe("thinking");
    r.send({ type: "text", text: "Jestem." });
    r.send({ type: "done" });
    await flush();
    expect(r.log).toEqual(["play 0-0:Jestem."]);
  });

  it("pytanie w trakcie myślenia zastępuje odpowiedź; mowa, gdy ta miała zagrać, przerywa", async () => {
    const r = rig();
    r.s.start();
    await r.say();
    r.hear("jednak inaczej");
    await r.say();
    expect(r.stops()).toBe(1);
    expect(r.asked[1].map((e) => e.user)).toEqual(["cześć", "jednak inaczej"]);
    r.s.speechStart();
    r.send({ type: "text", text: "Zaraz. " });
    await flush();
    expect(r.log).toEqual([]);
    expect(r.stops()).toBe(2);
    expect(r.s.state.history[1].interrupted).toBe(true);
  });

  it("bez silnika mowy odpowiedź jest tylko tekstem i wraca do słuchania", async () => {
    const r = rig({ tts: false });
    r.s.start();
    await r.say();
    r.send({ type: "text", text: "Tylko tekst. Bez głosu." });
    r.send({ type: "done" });
    await flush();
    expect(r.log).toEqual([]);
    expect(r.s.state.phase).toBe("listening");
    expect(r.s.state.history[0].reply).toBe("Tylko tekst. Bez głosu.");
  });

  it("błąd mózgu i błąd transkrypcji wracają do słuchania z powodem", async () => {
    const r = rig();
    r.s.start();
    await r.say();
    r.send({ type: "error", message: "401 zły klucz" });
    expect(r.s.state).toMatchObject({ phase: "listening", error: "401 zły klucz" });
    const t = rig({ transcript: new Error("brak sieci") });
    t.s.start();
    await t.say();
    expect(t.s.state).toMatchObject({ phase: "listening", error: "transkrypcja: brak sieci" });
  });

  it("błąd syntezy przerywa odpowiedź i mówi dlaczego", async () => {
    const r = rig();
    r.s.start();
    await r.say();
    (r.s as unknown as { deps: VoiceDeps }).deps.speak = async () => {
      throw new Error("Piper zakończył się (1)");
    };
    r.send({ type: "text", text: "Zdanie. " });
    await flush();
    expect(r.s.state).toMatchObject({ phase: "listening", error: "mowa: Piper zakończył się (1)" });
    expect(r.stops()).toBe(1);
  });

  it("stop w trakcie transkrypcji: spóźniony tekst nie trafia do nowej rozmowy", async () => {
    const r = rig();
    r.s.start();
    r.s.speechStart();
    const pending = r.s.speechEnd(new Uint8Array([1]));
    r.s.stop();
    r.s.start();
    await pending;
    await flush();
    expect(r.s.state).toMatchObject({ phase: "listening", history: [], carry: "" });
    expect(r.asked).toHaveLength(0);
  });

  it("klik w trakcie mowy przerywa bez nowej wypowiedzi", async () => {
    const r = rig();
    r.s.start();
    await r.say();
    r.send({ type: "text", text: "Długa odpowiedź. " });
    await flush();
    r.s.interrupt();
    expect(r.s.state.phase).toBe("listening");
    expect(r.stops()).toBe(1);
  });

  it("narzędzie: wywołanie → wynik → drugi krok mózgu z wynikiem → odpowiedź", async () => {
    const calls: string[] = [];
    const r = rig({ tts: false, tool: async (name) => (calls.push(name), { ok: true, text: "a1b2c3: claude, „testy”, pracuje" }) });
    r.s.start();
    await r.say();
    r.send({ type: "text", text: "Sprawdzam." });
    r.send({ type: "tool_call", id: "t1", name: "overview", args: {} });
    r.send({ type: "done" });
    await flush();
    expect(calls).toEqual(["overview"]);
    expect(r.extras[1]).toEqual([
      { role: "assistant", content: "Sprawdzam.", calls: [{ id: "t1", name: "overview", args: {} }] },
      { role: "tool", id: "t1", content: "a1b2c3: claude, „testy”, pracuje" },
    ]);
    expect(r.s.state.phase).toBe("thinking");
    r.send({ type: "text", text: "Claude robi testy." });
    r.send({ type: "done" });
    await flush();
    expect(r.s.state.phase).toBe("listening");
    expect(r.s.state.history[0]).toMatchObject({ reply: "Sprawdzam. Claude robi testy.", done: true, tools: [{ label: "sprawdza projekty i panele", ok: true }] });
  });

  it("karta: „tak” głosem zatwierdza bez przerywania odpowiedzi", async () => {
    let decided: CardDecision | null = null;
    const r = rig({
      tts: false,
      tool: async (_n, _a, signal) => {
        decided = await r.s.confirm({ head: "Otworzyć panel?", action: "Uruchom", tasks: [{ agent: "claude", title: "testy", prompt: "napisz testy" }] }, signal);
        return { ok: decided.kind === "run", text: decided.kind };
      },
    });
    r.s.start();
    await r.say();
    r.send({ type: "tool_call", id: "t1", name: "open_panes", args: { tasks: [] } });
    r.send({ type: "done" });
    await flush();
    expect(r.s.state.card?.tasks[0].title).toBe("testy");
    r.hear("Tak, uruchom.");
    await r.say();
    expect(r.stops()).toBe(0);
    expect(decided).toEqual({ kind: "run" });
    expect(r.s.state.card).toBeUndefined();
    expect(r.asked).toHaveLength(2); // drugi krok mózgu z wynikiem, a nie nowe pytanie „tak”
    expect(r.s.state.history).toHaveLength(1);
  });

  it("karta: inna wypowiedź to poprawka z treścią, przerwanie to anulowanie", async () => {
    const decisions: CardDecision[] = [];
    const r = rig({
      tts: false,
      tool: async (_n, _a, signal) => {
        const d = await r.s.confirm({ head: "Wysłać?", action: "Wyślij", tasks: [{ agent: "pi", title: "x", prompt: "y" }] }, signal);
        decisions.push(d);
        return { ok: false, text: d.kind };
      },
    });
    r.s.start();
    await r.say();
    r.send({ type: "tool_call", id: "t1", name: "send_to_pane", args: {} });
    r.send({ type: "done" });
    await flush();
    r.hear("zamiast pi daj claude");
    await r.say();
    expect(decisions).toEqual([{ kind: "fix", note: "zamiast pi daj claude" }]);
    r.send({ type: "tool_call", id: "t2", name: "send_to_pane", args: {} });
    r.send({ type: "done" });
    await flush();
    expect(r.s.state.card).toBeDefined();
    r.s.interrupt();
    await flush();
    expect(decisions[1]).toEqual({ kind: "cancel" });
    expect(r.s.state.card).toBeUndefined();
  });

  it("komunikat aplikacji: w ciszy gra od razu, w trakcie odpowiedzi czeka; mowa go ucisza", async () => {
    const r = rig();
    r.s.start();
    r.s.note("Claude skończył pracę.");
    await flush();
    expect(r.log).toEqual(["play note-0:Claude skończył pracę."]);
    expect(r.s.speakingNote).toBe(true);
    r.s.speechStart();
    expect(r.s.speakingNote).toBe(false);
    expect(r.cancelled).toEqual(["note-0"]);
    await r.s.speechEnd(new Uint8Array([1]));
    await flush();
    r.s.note("pi skończył pracę.");
    await flush();
    expect(r.log).toHaveLength(1); // myśli: komunikat czeka
    r.send({ type: "text", text: "Hej." });
    r.send({ type: "done" });
    await flush();
    await r.finishPlaying(); // przerwany note-0 (atrapa trzyma go w kolejce)
    await r.finishPlaying(); // „Hej.”
    expect(r.log.at(-1)).toBe("play note-1:pi skończył pracę.");
    expect(r.s.state.notes?.map((n) => [n.text, n.after])).toEqual([
      ["Claude skończył pracę.", 0],
      ["pi skończył pracę.", 1],
    ]);
  });

  it("CLI: `tool_request` wykonuje narzędzie i odsyła wynik, odpowiedź płynie dalej w tym samym kroku", async () => {
    const results: [string, string][] = [];
    const r = rig({ tts: false, tool: async () => ({ ok: true, text: "2 panele" }), toolResult: (id, out) => void results.push([id, out.text]) });
    r.s.start();
    await r.say();
    r.send({ type: "text", text: "Sprawdzam." });
    r.send({ type: "tool_request", id: "q1", name: "overview", args: {} });
    await flush();
    expect(results).toEqual([["q1", "2 panele"]]);
    r.send({ type: "text", text: "Masz dwa panele." });
    r.send({ type: "done" });
    await flush();
    expect(r.asked).toHaveLength(1); // CLI sam prowadzi pętlę: bez drugiego kroku
    expect(r.s.state.history[0]).toMatchObject({ reply: "Sprawdzam. Masz dwa panele.", tools: [{ label: "sprawdza projekty i panele", ok: true }] });
  });
});
