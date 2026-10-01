import { describe, expect, it } from "vitest";
import type { ChatEvent } from "../chat";
import { VoiceSession, type VoiceDeps } from "./session";
import type { VoiceExchange, VoiceState } from "./voice";

const tick = () => new Promise((r) => setTimeout(r, 0));
const flush = async () => {
  for (let i = 0; i < 20; i++) await tick();
};

/** Atrapy z ręcznym sterowaniem: odpowiedź mózgu, synteza i odtwarzanie kończą się na żądanie. */
function rig(opts: { tts?: boolean; transcript?: string | Error } = {}) {
  const log: string[] = [];
  const asked: VoiceExchange[][] = [];
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
    ask: (history, onEvent) => {
      asked.push(history);
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
  };
  const states: VoiceState[] = [];
  const s = new VoiceSession(deps, (st) => states.push(st));
  return {
    s,
    log,
    asked,
    cancelled,
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
});
