// Wykrywanie mowy (VAD) po energii ramek 20 ms z progiem nad szumem tła, które sam się uczy.
// Zamiast Silero (`@ricky0123/vad-web`): tamten ładuje `.onnx`/`.wasm` przez `fetch`, a strona
// Electrona stoi na `file://`. Do mikrofonu z `echoCancellation` i `noiseSuppression` wystarcza;
// gdy nie wystarczy, wymiana dotyczy tylko tego pliku.

export const SAMPLE_RATE = 16_000;
export const FRAME = 320; // 20 ms przy 16 kHz

export type VadParams = {
  /** Mowa = energia ≥ szum × `ratio` i ≥ `minRms`. */
  ratio: number;
  minRms: number;
  /** Tyle ramek nad progiem pod rząd zaczyna mowę (krótkie stuknięcia odpadają). */
  startFrames: number;
  /** Tyle ciszy kończy wypowiedź. */
  endFrames: number;
  /** Krótsza wypowiedź to szum (kaszel, klawiatura): `misfire` zamiast `end`. */
  minSpeechFrames: number;
};

export const VAD_DEFAULT: VadParams = { ratio: 3, minRms: 0.012, startFrames: 3, endFrames: 30, minSpeechFrames: 12 };
/** Gdy gra odpowiedź przez głośniki: wyższy próg i dłuższy start, żeby echo nie przerywało. */
export const VAD_PLAYING: VadParams = { ratio: 6, minRms: 0.03, startFrames: 8, endFrames: 30, minSpeechFrames: 12 };

export type VadState = {
  speaking: boolean;
  /** Ramki nad progiem pod rząd (przed startem) albo ramki ciszy pod rząd (w trakcie mowy). */
  run: number;
  /** Długość bieżącej wypowiedzi w ramkach. */
  length: number;
  /** Szum tła (RMS), średnia krocząca z ramek ciszy. */
  noise: number;
  /** Ramki kalibracji na starcie: tylko uczą szumu (rozmowa zaczęta przy wentylatorze). */
  calib: number;
};

/** 300 ms na start: średnia z tych ramek to pierwszy szum tła. */
export const CALIB_FRAMES = 15;
export const VAD_INIT: VadState = { speaking: false, run: 0, length: 0, noise: 0.004, calib: 0 };

export type VadEvent = "start" | "end" | "misfire" | null;

export function rms(frame: Float32Array): number {
  let sum = 0;
  for (let i = 0; i < frame.length; i++) sum += frame[i] * frame[i];
  return frame.length ? Math.sqrt(sum / frame.length) : 0;
}

/** Jedna ramka. `start` przychodzi po `startFrames` ramkach mowy (te ramki należą już do wypowiedzi). */
export function vadStep(s: VadState, level: number, p: VadParams = VAD_DEFAULT): { state: VadState; event: VadEvent } {
  if (s.calib < CALIB_FRAMES) {
    const calib = s.calib + 1;
    const noise = s.calib === 0 ? level : s.noise + (level - s.noise) / calib;
    return { state: { ...s, calib, noise: Math.max(noise, 1e-4) }, event: null };
  }
  const threshold = Math.max(p.minRms, s.noise * p.ratio);
  // Histereza: w trakcie mowy cisza zaczyna się dopiero wyraźnie niżej (końcówki słów są ciche).
  const loud = level >= (s.speaking ? threshold * 0.6 : threshold);
  if (!s.speaking) {
    // Szum uczy się tylko z ciszy; szybko w dół (ktoś wyłączył wentylator), wolno w górę.
    const noise = loud ? s.noise : level < s.noise ? s.noise * 0.9 + level * 0.1 : s.noise * 0.995 + level * 0.005;
    const run = loud ? s.run + 1 : 0;
    if (run >= p.startFrames) return { state: { ...s, speaking: true, run: 0, length: run, noise }, event: "start" };
    return { state: { ...s, run, noise: Math.max(noise, 1e-4) }, event: null };
  }
  const run = loud ? 0 : s.run + 1;
  const length = s.length + 1;
  if (run >= p.endFrames) {
    const spoken = length - run;
    return { state: { ...s, speaking: false, run: 0, length: 0 }, event: spoken >= p.minSpeechFrames ? "end" : "misfire" };
  }
  return { state: { ...s, run, length }, event: null };
}

/** Mono float [-1, 1] → WAV 16-bit PCM (to przyjmuje każdy silnik `/audio/transcriptions`). */
export function encodeWav(samples: Float32Array, rate = SAMPLE_RATE): Uint8Array {
  const out = new Uint8Array(44 + samples.length * 2);
  const v = new DataView(out.buffer);
  const text = (at: number, s: string) => [...s].forEach((c, i) => v.setUint8(at + i, c.charCodeAt(0)));
  text(0, "RIFF");
  v.setUint32(4, 36 + samples.length * 2, true);
  text(8, "WAVE");
  text(12, "fmt ");
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true); // PCM
  v.setUint16(22, 1, true); // mono
  v.setUint32(24, rate, true);
  v.setUint32(28, rate * 2, true);
  v.setUint16(32, 2, true);
  v.setUint16(34, 16, true);
  text(36, "data");
  v.setUint32(40, samples.length * 2, true);
  for (let i = 0; i < samples.length; i++) {
    const x = Math.max(-1, Math.min(1, samples[i]));
    v.setInt16(44 + i * 2, x < 0 ? x * 0x8000 : x * 0x7fff, true);
  }
  return out;
}

/** Ile ciszy przed startem dołączamy do nagrania: VAD zaczyna z opóźnieniem, a pierwsza sylaba
 *  bywa cicha. */
export const PREROLL_FRAMES = 15;
/** Twardy limit jednej wypowiedzi (60 s): dłuższa idzie do transkrypcji w kawałkach. */
export const MAX_UTTERANCE_FRAMES = 3000;

/**
 * Zbiera ramki mikrofonu w wypowiedzi: przed mową trzyma `PREROLL_FRAMES` ostatnich, w trakcie
 * mowy wszystkie. Ramki ciszy na końcu (czekanie na koniec) zostają: whisper ich nie potrzebuje,
 * ale ucięcie w złym miejscu kosztuje ostatnie słowo.
 */
export class Utterances {
  private s: VadState = VAD_INIT;
  private pre: Float32Array[] = [];
  private cur: Float32Array[] | null = null;

  constructor(
    private on: {
      start(): void;
      end(audio: Float32Array): void;
      misfire?(): void;
    },
  ) {}

  get speaking() {
    return this.s.speaking;
  }

  get noise() {
    return this.s.noise;
  }

  /** Mikrofon wyciszony / nowa rozmowa: bez zdarzeń, szum i kalibracja zostają. */
  reset() {
    this.s = { ...VAD_INIT, noise: this.s.noise, calib: this.s.calib };
    this.pre = [];
    this.cur = null;
  }

  push(frame: Float32Array, params: VadParams = VAD_DEFAULT): number {
    const level = rms(frame);
    const { state, event } = vadStep(this.s, level, params);
    this.s = state;
    if (this.cur) this.cur.push(frame);
    else {
      this.pre.push(frame);
      if (this.pre.length > PREROLL_FRAMES) this.pre.shift();
    }
    if (event === "start") {
      this.cur = this.pre;
      this.pre = [];
      this.on.start();
    } else if (event === "end" || event === "misfire" || (this.cur && this.cur.length >= MAX_UTTERANCE_FRAMES)) {
      const frames = this.cur ?? [];
      this.cur = null;
      if (event === "misfire") this.on.misfire?.();
      else {
        if (!event) this.s = { ...this.s, speaking: false, run: 0, length: 0 };
        this.on.end(concat(frames));
      }
    }
    return level;
  }
}

function concat(frames: Float32Array[]): Float32Array {
  const out = new Float32Array(frames.reduce((n, f) => n + f.length, 0));
  let at = 0;
  for (const f of frames) {
    out.set(f, at);
    at += f.length;
  }
  return out;
}
