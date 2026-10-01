import { describe, expect, it } from "vitest";
import { CALIB_FRAMES, encodeWav, FRAME, MAX_UTTERANCE_FRAMES, PREROLL_FRAMES, rms, Utterances, VAD_DEFAULT, VAD_INIT, VAD_PLAYING, vadStep, type VadEvent, type VadState } from "./vad";

/** Ramka o zadanym RMS (sinus ma RMS = amplituda / √2). */
const frame = (level: number) => {
  const f = new Float32Array(FRAME);
  for (let i = 0; i < FRAME; i++) f[i] = level * Math.SQRT2 * Math.sin((i / FRAME) * Math.PI * 16);
  return f;
};
const QUIET = 0.003;
const VOICE = 0.08;

function feed(levels: number[], params = VAD_DEFAULT, from: VadState = VAD_INIT) {
  let s = from;
  const events: [number, VadEvent][] = [];
  levels.forEach((l, i) => {
    const r = vadStep(s, l, params);
    s = r.state;
    if (r.event) events.push([i, r.event]);
  });
  return { s, events };
}
const times = (n: number, l: number) => Array<number>(n).fill(l);

describe("vadStep", () => {
  it("rms ramki", () => {
    expect(rms(frame(0.1))).toBeCloseTo(0.1, 3);
    expect(rms(new Float32Array(0))).toBe(0);
  });

  it("mowa po ciszy: start po 3 ramkach, koniec po 30 ramkach ciszy", () => {
    const { events } = feed([...times(50, QUIET), ...times(40, VOICE), ...times(40, QUIET)]);
    expect(events).toEqual([[52, "start"], [119, "end"]]);
  });

  it("kalibracja: szum od pierwszej ramki nie jest mową", () => {
    const { s, events } = feed(times(CALIB_FRAMES, 0.03));
    expect(events).toEqual([]);
    expect(s.noise).toBeCloseTo(0.03, 5);
  });

  it("krótkie stuknięcie nie startuje, krótki dźwięk to misfire", () => {
    expect(feed([...times(50, QUIET), VOICE, VOICE, ...times(40, QUIET)]).events).toEqual([]);
    expect(feed([...times(50, QUIET), ...times(5, VOICE), ...times(40, QUIET)]).events.map((e) => e[1])).toEqual(["start", "misfire"]);
  });

  it("krótka pauza w środku zdania nie kończy wypowiedzi", () => {
    const { events } = feed([...times(30, QUIET), ...times(20, VOICE), ...times(15, QUIET), ...times(20, VOICE), ...times(40, QUIET)]);
    expect(events.map((e) => e[1])).toEqual(["start", "end"]);
  });

  it("próg idzie za szumem tła: stały szum nie jest mową, głos nad nim jest", () => {
    const hum = 0.02;
    const { s, events } = feed(times(300, hum));
    expect(events).toEqual([]);
    expect(s.noise).toBeGreaterThan(0.015);
    expect(feed(times(10, 0.05), VAD_DEFAULT, s).events).toEqual([]);
    expect(feed(times(10, 0.1), VAD_DEFAULT, s).events.map((e) => e[1])).toEqual(["start"]);
  });

  it("w trakcie odtwarzania próg jest wyższy (echo nie przerywa)", () => {
    const echo = 0.025;
    expect(feed([...times(50, QUIET), ...times(20, echo)], VAD_PLAYING).events).toEqual([]);
    expect(feed([...times(50, QUIET), ...times(20, echo)]).events.map((e) => e[1])).toEqual(["start"]);
    expect(feed([...times(50, QUIET), ...times(20, VOICE)], VAD_PLAYING).events).toEqual([[57, "start"]]);
  });
});

describe("Utterances", () => {
  it("wypowiedź = preroll + mowa + cisza do końca", () => {
    const got: Float32Array[] = [];
    let started = 0;
    const u = new Utterances({ start: () => started++, end: (a) => got.push(a) });
    for (let i = 0; i < 50; i++) u.push(frame(QUIET));
    for (let i = 0; i < 40; i++) u.push(frame(VOICE));
    expect(u.speaking).toBe(true);
    for (let i = 0; i < 40; i++) u.push(frame(QUIET));
    expect(started).toBe(1);
    expect(got).toHaveLength(1);
    // preroll (15) + 3 ramki startu są w środku prerollu: 15 + 37 pozostałych ramek mowy + 30 ramek ciszy
    expect(got[0].length).toBe((PREROLL_FRAMES + 37 + 30) * FRAME);
    expect(u.speaking).toBe(false);
  });

  it("misfire nie oddaje nagrania, reset zapomina bieżącą wypowiedź", () => {
    let ends = 0;
    let misfires = 0;
    const u = new Utterances({ start: () => undefined, end: () => ends++, misfire: () => misfires++ });
    for (let i = 0; i < 30; i++) u.push(frame(QUIET));
    for (let i = 0; i < 5; i++) u.push(frame(VOICE));
    for (let i = 0; i < 40; i++) u.push(frame(QUIET));
    expect([ends, misfires]).toEqual([0, 1]);
    for (let i = 0; i < 10; i++) u.push(frame(VOICE));
    u.reset();
    for (let i = 0; i < 40; i++) u.push(frame(QUIET));
    expect(ends).toBe(0);
  });

  it("bardzo długa wypowiedź jest oddawana kawałkami", () => {
    const got: number[] = [];
    const u = new Utterances({ start: () => undefined, end: (a) => got.push(a.length) });
    for (let i = 0; i < 20; i++) u.push(frame(QUIET));
    for (let i = 0; i < MAX_UTTERANCE_FRAMES + 100; i++) u.push(frame(VOICE));
    expect(got).toHaveLength(1);
    expect(got[0]).toBe(MAX_UTTERANCE_FRAMES * FRAME);
  });
});

describe("encodeWav", () => {
  it("nagłówek PCM 16 kHz mono i próbki z przycięciem", () => {
    const wav = encodeWav(new Float32Array([0, 1, -1, 2]));
    const v = new DataView(wav.buffer);
    const ascii = (a: number, n: number) => String.fromCharCode(...wav.subarray(a, a + n));
    expect([ascii(0, 4), ascii(8, 4), ascii(12, 4), ascii(36, 4)]).toEqual(["RIFF", "WAVE", "fmt ", "data"]);
    expect(v.getUint32(4, true)).toBe(36 + 8);
    expect([v.getUint16(22, true), v.getUint32(24, true), v.getUint16(34, true), v.getUint32(40, true)]).toEqual([1, 16000, 16, 8]);
    expect([0, 1, 2, 3].map((i) => v.getInt16(44 + i * 2, true))).toEqual([0, 32767, -32768, 32767]);
  });
});
