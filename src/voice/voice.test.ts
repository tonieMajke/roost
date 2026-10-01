import { describe, expect, it } from "vitest";
import {
  activeTts, resolveBrain, DEFAULT_TTS, exchangeTimes, fmtMs, DEFAULT_VOICE, INTERRUPTED, MAX_SENTENCE, parseTtsConfig, parseVoiceConfig, speakable, splitSentences,
  TTS_PRESETS, VOICE_IDLE, voiceCliPrompt, voicePrompt, voiceReducer, voiceTurns, type VoiceEvent, type VoiceExchange, type VoiceState,
} from "./voice";

describe("parseTtsConfig", () => {
  it("brak pliku i zepsuty JSON = brak silników", () => {
    expect(parseTtsConfig(null)).toEqual({ config: DEFAULT_TTS, errors: [] });
    expect(parseTtsConfig("{ nie").errors).toHaveLength(1);
    expect(parseTtsConfig("[]").errors).toEqual(["tts.json: to nie jest obiekt"]);
  });

  it("wczytuje szablony bez zmian", () => {
    const { config, errors } = parseTtsConfig(JSON.stringify({ providers: TTS_PRESETS }));
    expect(errors).toEqual([]);
    expect(config.providers).toEqual(TTS_PRESETS);
  });

  it("pomija złe wpisy i opisuje je", () => {
    const { config, errors } = parseTtsConfig(JSON.stringify({
      providers: [
        { id: "a", kind: "speech", baseUrl: "https://x.example/v1//", model: "tts-1" },
        { id: "a", kind: "speech", baseUrl: "https://y.example", model: "m" },
        { id: "b", kind: "speech", baseUrl: "ftp://x", model: "m" },
        { id: "c", kind: "glos", model: "m" },
        { id: "d", kind: "piper", model: " " },
        { id: "e", kind: "piper", model: "/m.onnx", key: true, command: " /opt/piper/piper " },
      ],
    }));
    expect(errors).toHaveLength(4);
    expect(config.providers.map((p) => p.id)).toEqual(["a", "e"]);
    expect(config.providers[0]).toMatchObject({ baseUrl: "https://x.example/v1", key: true, voice: "" });
    expect(config.providers[1]).toMatchObject({ key: false, command: "/opt/piper/piper" });
    expect(config.providers[1].baseUrl).toBeUndefined();
  });
});

describe("parseVoiceConfig", () => {
  it("domyślne i złe pola", () => {
    expect(parseVoiceConfig(null)).toEqual({ config: DEFAULT_VOICE, errors: [] });
    const r = parseVoiceConfig(JSON.stringify({ brain: { provider: "x" }, tts: "z ł", voice: 3, headphones: "tak" }));
    expect(r.config).toEqual(DEFAULT_VOICE);
    expect(r.errors).toHaveLength(2);
  });

  it("Piper ma szablon na każdy język, z unikalnymi id i modelami", () => {
    const piper = TTS_PRESETS.filter((p) => p.kind === "piper");
    expect(piper.map((p) => p.model)).toEqual([
      expect.stringContaining("pl_PL-"),
      expect.stringContaining("en_US-"),
    ]);
    expect(new Set(TTS_PRESETS.map((p) => p.id)).size).toBe(TTS_PRESETS.length);
  });

  it("dobre pola i wybrany silnik", () => {
    const { config, errors } = parseVoiceConfig(JSON.stringify({ brain: { provider: "anthropic", model: "claude-sonnet-5-5" }, tts: "piper", voice: " nova ", headphones: true }));
    expect(errors).toEqual([]);
    expect(config).toEqual({ brain: { provider: "anthropic", model: "claude-sonnet-5-5" }, tts: "piper", voice: "nova", headphones: true });
    expect(activeTts({ providers: TTS_PRESETS }, config)?.kind).toBe("piper");
    expect(activeTts({ providers: TTS_PRESETS }, DEFAULT_VOICE)).toBeNull();
  });
});

describe("splitSentences", () => {
  it("granica wymaga białego znaku po niej", () => {
    expect(splitSentences("Dobra. Robimy to")).toEqual({ ready: ["Dobra."], rest: " Robimy to" });
    expect(splitSentences("Wersja 3.5 jest")).toEqual({ ready: [], rest: "Wersja 3.5 jest" });
    expect(splitSentences("Naprawdę?! Tak… no")).toEqual({ ready: ["Naprawdę?!", "Tak…"], rest: " no" });
    // Kropka na końcu kawałka: nie wiadomo jeszcze, czy to koniec („3.” → „3.5”).
    expect(splitSentences("Mamy 3.")).toEqual({ ready: [], rest: "Mamy 3." });
  });

  it("skróty, inicjały i liczebniki nie tną", () => {
    expect(splitSentences("Weź np. Rusta, itd. Potem").ready).toEqual(["Weź np. Rusta, itd."]);
    expect(splitSentences("To m.in. testy. Dalej").ready).toEqual(["To m.in. testy."]);
    expect(splitSentences("Pisał J. Kowalski. I tyle").ready).toEqual(["Pisał J. Kowalski."]);
    expect(splitSentences("Krok 3. sprawdza dane. Ok").ready).toEqual(["Krok 3. sprawdza dane."]);
  });

  it("pusta linia tnie, blok kodu nie", () => {
    expect(splitSentences("Nagłówek\n\nTreść").ready).toEqual(["Nagłówek"]);
    const r = splitSentences("Kod:\n```\na. b. c\n");
    expect(r.ready).toEqual([]);
    expect(splitSentences("```\na. b\n``` Koniec. X").ready).toEqual(["```\na. b\n``` Koniec."]);
  });

  it("final oddaje resztę", () => {
    expect(splitSentences("Raz. Dwa", true)).toEqual({ ready: ["Raz.", "Dwa"], rest: "" });
    expect(splitSentences("  ", true)).toEqual({ ready: [], rest: "" });
  });

  it("długie zdanie tnie na przecinku przed limitem", () => {
    const long = `${"słowo ".repeat(20)}tutaj, ${"inne ".repeat(40)}`;
    const { ready, rest } = splitSentences(long);
    expect(ready[0].endsWith("tutaj,")).toBe(true);
    for (const s of ready) expect(s.length).toBeLessThanOrEqual(MAX_SENTENCE);
    expect(rest.trim().length).toBeLessThanOrEqual(MAX_SENTENCE);
  });

  it("strumień kawałkami daje te same zdania co całość", () => {
    const text = "Jasne. Zrobimy to w dwóch krokach, np. backend i testy. Pasuje? Super!";
    const out: string[] = [];
    let buf = "";
    for (const ch of text.match(/.{1,4}/gsu)!) {
      const r = splitSentences(buf + ch);
      out.push(...r.ready);
      buf = r.rest;
    }
    out.push(...splitSentences(buf, true).ready);
    expect(out).toEqual(splitSentences(text, true).ready);
    expect(out).toEqual(["Jasne.", "Zrobimy to w dwóch krokach, np. backend i testy.", "Pasuje?", "Super!"]);
  });
});

describe("speakable", () => {
  it("usuwa markdown, kod i emoji", () => {
    expect(speakable("## Plan\n- **pierwszy** krok\n- `cargo test` 🚀")).toBe("Plan pierwszy krok cargo test");
    expect(speakable("Patrz [dokumentacja](https://x.dev) i https://y.dev/a")).toBe("Patrz dokumentacja i link");
    expect(speakable("Tak:\n```ts\nconst a = 1;\n```\nGotowe.")).toBe("Tak: (kod pominięty) Gotowe.");
    expect(speakable("1. raz\n2) dwa")).toBe("raz dwa");
    expect(speakable("snake_case i 2*3*4")).toBe("snake_case i 2*3*4");
  });
});

const run = (events: VoiceEvent[], from: VoiceState = VOICE_IDLE) => events.reduce(voiceReducer, from);
/** Pytanie zamienione na wymianę `n`, model w trakcie odpowiedzi. */
const asked = (text = "cześć") =>
  run([{ type: "start" }, { type: "speech_start" }, { type: "speech_end", at: 100 }, { type: "transcript", text, at: 400 }]);

describe("voiceReducer", () => {
  it("pełna wymiana z czasami", () => {
    let s = asked();
    expect(s.phase).toBe("thinking");
    s = run([
      { type: "delta", n: 0, text: "Hej. ", at: 700 },
      { type: "audio_start", n: 0, text: "Hej.", at: 900 },
      { type: "delta", n: 0, text: "Co tam?", at: 950 },
      { type: "reply_done", n: 0 },
    ], s);
    expect(s.phase).toBe("speaking");
    s = run([{ type: "audio_start", n: 0, text: "Co tam?", at: 1500 }, { type: "audio_idle", n: 0 }], s);
    expect(s.phase).toBe("listening");
    expect(s.history[0]).toEqual({ user: "cześć", reply: "Hej. Co tam?", spoken: ["Hej.", "Co tam?"], done: true, t: { heard: 100, text: 400, first: 700, audio: 900 } });
  });

  it("kolejka pusta przed końcem odpowiedzi nie kończy tury", () => {
    const s = run([{ type: "audio_start", n: 0, text: "A.", at: 1 }, { type: "audio_idle", n: 0 }], asked());
    expect(s.phase).toBe("speaking");
  });

  it("pusty transkrypt wraca do słuchania", () => {
    const s = run([{ type: "start" }, { type: "speech_start" }, { type: "speech_end", at: 1 }, { type: "transcript", text: "  ", at: 2 }]);
    expect(s).toMatchObject({ phase: "listening", history: [] });
  });

  it("przerwanie w każdym stanie daje słuchanie i spójną historię", () => {
    const states: Record<string, VoiceState> = {
      idle: VOICE_IDLE,
      listening: run([{ type: "start" }]),
      transcribing: run([{ type: "start" }, { type: "speech_start" }, { type: "speech_end", at: 1 }]),
      thinking: asked(),
      speaking: run([{ type: "delta", n: 0, text: "Raz. Dwa.", at: 1 }, { type: "audio_start", n: 0, text: "Raz.", at: 2 }], asked()),
    };
    for (const [name, s0] of Object.entries(states)) {
      const s = voiceReducer(s0, { type: "speech_start" });
      expect(s.phase, name).toBe(name === "idle" ? "idle" : name === "transcribing" || name === "thinking" ? name : "listening");
      if (name === "speaking") expect(s.history[0]).toMatchObject({ interrupted: true, done: true, spoken: ["Raz."] });
      // Myśli dalej: przerwie dopiero niepusty transkrypt.
      if (name === "thinking") expect(s.history[0].interrupted).toBeUndefined();
      expect(voiceReducer(s0, { type: "interrupt" }).phase, name).toBe(name === "thinking" || name === "speaking" ? "listening" : s0.phase);
    }
  });

  it("spóźnione zdarzenia z przerwanej odpowiedzi nie trafiają do nowej", () => {
    let s = run([{ type: "speech_start" }, { type: "speech_end", at: 5 }, { type: "transcript", text: "drugie", at: 6 }], asked());
    expect(s.history).toHaveLength(2);
    s = run([
      { type: "delta", n: 0, text: "stare", at: 7 },
      { type: "audio_start", n: 0, text: "stare", at: 7 },
      { type: "error", n: 0, message: "przerwane" },
      { type: "delta", n: 1, text: "nowe", at: 8 },
    ], s);
    expect(s.history[0].reply).toBe("");
    expect(s.history[1].reply).toBe("nowe");
    expect(s.phase).toBe("thinking");
    expect(s.error).toBeUndefined();
  });

  it("mowa w trakcie myślenia: pusty transkrypt (szum) nie przerywa, niepusty zaczyna nowe pytanie", () => {
    let s = run([{ type: "speech_start" }, { type: "speech_end", at: 5 }, { type: "transcript", text: " ", at: 6 }], asked());
    expect(s).toMatchObject({ phase: "thinking", hearing: false });
    expect(s.history).toHaveLength(1);
    expect(s.history[0].interrupted).toBeUndefined();
    s = run([{ type: "delta", n: 0, text: "Odpowiedź", at: 7 }], s);
    expect(s.history[0].reply).toBe("Odpowiedź");
    s = run([{ type: "speech_start" }, { type: "speech_end", at: 8 }, { type: "transcript", text: "jednak inaczej", at: 9 }], s);
    expect(s.phase).toBe("thinking");
    expect(s.history).toHaveLength(2);
    expect(s.history[0]).toMatchObject({ interrupted: true, done: true });
    expect(s.history[1].user).toBe("jednak inaczej");
  });

  it("transkrypt w trakcie dalszego mówienia dokleja się do następnego", () => {
    let s = run([{ type: "start" }, { type: "speech_start" }, { type: "speech_end", at: 1 }, { type: "speech_start" }]);
    s = voiceReducer(s, { type: "transcript", text: "zróbmy", at: 2 });
    expect(s).toMatchObject({ carry: "zróbmy", history: [] });
    s = run([{ type: "speech_end", at: 3 }, { type: "transcript", text: "aplikację", at: 4 }], s);
    expect(s.history[0].user).toBe("zróbmy aplikację");
    expect(s.carry).toBe("");
  });

  it("błąd odpowiedzi zapisuje się przy wymianie i wraca do słuchania", () => {
    const s = voiceReducer(asked(), { type: "error", n: 0, message: "401" });
    expect(s).toMatchObject({ phase: "listening", error: "401" });
    expect(s.history[0]).toMatchObject({ error: "401", done: true });
  });

  it("stop kończy wszystko, zdarzenia po stopie nic nie zmieniają", () => {
    const s = voiceReducer(asked(), { type: "stop" });
    expect(s.phase).toBe("idle");
    expect(run([{ type: "speech_start" }, { type: "transcript", text: "x", at: 1 }], s)).toEqual(s);
  });
});

const ex = (user: string, reply: string, more: Partial<VoiceExchange> = {}): VoiceExchange =>
  ({ user, reply, spoken: [], done: true, t: {}, ...more });

describe("voiceTurns", () => {
  it("przerwana odpowiedź = to, co zagrało, z dopiskiem", () => {
    const turns = voiceTurns([
      ex("a", "Raz. Dwa. Trzy.", { spoken: ["Raz."], interrupted: true }),
      ex("b", "", { interrupted: true }),
      ex("c", "", { done: false }),
    ]);
    expect(turns).toEqual([
      { role: "user", content: "a" },
      { role: "assistant", content: `Raz. ${INTERRUPTED}` },
      { role: "user", content: "b" },
      { role: "assistant", content: INTERRUPTED },
      { role: "user", content: "c" },
    ]);
  });

  it("pytania bez odpowiedzi łączą się, stare wymiany odpadają", () => {
    expect(voiceTurns([ex("a", "", { error: "x" }), ex("b", "", { done: false })])).toEqual([{ role: "user", content: "a\nb" }]);
    const many = Array.from({ length: 40 }, (_, i) => ex(`q${i}`, `r${i}`));
    const turns = voiceTurns(many);
    expect(turns).toHaveLength(60);
    expect(turns[0].content).toBe("q10");
  });

  it("prompt dla CLI", () => {
    expect(voiceCliPrompt([ex("tylko to", "", { done: false })])).toBe("tylko to");
    expect(voiceCliPrompt([ex("a", "b"), ex("c", "", { done: false })])).toBe("Użytkownik: a\n\nAsystent: b\n\nUżytkownik: c");
  });
});

describe("voicePrompt", () => {
  const now = new Date("2026-10-01T10:15:30Z");
  it("stały dla tego samego wejścia, z polską datą", () => {
    const p = voicePrompt(now);
    expect(p).toBe(voicePrompt(new Date("2026-10-01T10:15:59Z")));
    expect(p).toContain("1 października 2026");
    expect(p).toContain("12:15");
    expect(p).not.toContain("open_panes");
  });

  it("z przeglądem opisuje narzędzia i stan aplikacji", () => {
    const p = voicePrompt(now, "Projekt abc „demo” (aktywny): 0 panel(i), pracuje 0");
    expect(p).toContain("open_panes");
    expect(p).toContain("ask_bot");
    expect(p).toContain("Projekt abc „demo” (aktywny)");
  });
});

describe("exchangeTimes", () => {
  it("różnice znaczników, brakujące pomija", () => {
    expect(exchangeTimes(ex("a", "b", { t: { heard: 1000, text: 1400, first: 2100, audio: 2350.6 } }))).toEqual({ stt: 400, model: 700, voice: 251, total: 1351 });
    expect(exchangeTimes(ex("a", "b", { t: { heard: 1000, text: 1400 } }))).toEqual({ stt: 400, model: undefined, voice: undefined, total: undefined });
    expect([fmtMs(350), fmtMs(1351)]).toEqual(["350 ms", "1,4 s"]);
  });
});

describe("resolveBrain", () => {
  const providers = [
    { id: "cl", name: "Claude", kind: "claude-cli" as const, group: "sub" as const, models: [{ id: "opus", name: "Opus" }] },
    { id: "loc", name: "Lokalny", kind: "openai" as const, group: "local" as const, baseUrl: "http://x", discover: true, models: [] },
  ];
  it("wybrany, pierwszy z listy, wykryty i nieznany", () => {
    expect(resolveBrain(providers, { provider: "cl", model: "opus" })?.model.name).toBe("Opus");
    expect(resolveBrain(providers, null)?.provider.id).toBe("cl");
    expect(resolveBrain(providers, { provider: "loc", model: "qwen" })).toMatchObject({ provider: { id: "loc" }, model: { id: "qwen", name: "qwen" } });
    expect(resolveBrain(providers, { provider: "cl", model: "brak" })).toBeNull();
    expect(resolveBrain([], null)).toBeNull();
  });
});
