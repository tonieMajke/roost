// Mikrofon i głośnik rozmowy głosowej (Web Audio). Logika jest w `vad.ts` i `session.ts`;
// tu tylko przepływ próbek.

import { micConstraints } from "../stt";
import { FRAME, SAMPLE_RATE } from "./vad";

/** Ramki po FRAME próbek z wątku audio. Moduł z adresu blob: strona Electrona stoi na `file://`. */
const TAP = `
class Tap extends AudioWorkletProcessor {
  constructor() { super(); this.buf = new Float32Array(${FRAME}); this.n = 0; }
  process(inputs) {
    const ch = inputs[0] && inputs[0][0];
    if (ch) for (let i = 0; i < ch.length; i++) {
      this.buf[this.n++] = ch[i];
      if (this.n === ${FRAME}) { this.port.postMessage(this.buf, [this.buf.buffer]); this.buf = new Float32Array(${FRAME}); this.n = 0; }
    }
    return true;
  }
}
registerProcessor("aw-tap", Tap);
`;

/** Powód, dla którego `getUserMedia` odmówiło, po ludzku (jak w dyktowaniu). */
export function micError(e: unknown): string {
  const name = (e as { name?: string })?.name;
  if (name === "NotAllowedError" || name === "SecurityError") return "brak zgody na mikrofon";
  if (name === "NotFoundError" || name === "OverconstrainedError") return "nie znaleziono mikrofonu";
  if (name === "NotReadableError") return "mikrofon zajęty przez inny program";
  return `mikrofon: ${e instanceof Error ? e.message : String(e)}`;
}

/** Otwarty mikrofon: 16 kHz mono (Chromium sam przelicza), z tłumieniem echa i szumu. */
export class Mic {
  private constructor(
    private ctx: AudioContext,
    private stream: MediaStream,
  ) {}

  static async open(deviceId: string, onFrame: (frame: Float32Array) => void): Promise<Mic> {
    const base = micConstraints(deviceId);
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: { ...(base === true ? {} : base), channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    });
    const ctx = new AudioContext({ sampleRate: SAMPLE_RATE });
    try {
      const url = URL.createObjectURL(new Blob([TAP], { type: "text/javascript" }));
      try {
        await ctx.audioWorklet.addModule(url);
      } finally {
        URL.revokeObjectURL(url);
      }
      const node = new AudioWorkletNode(ctx, "aw-tap");
      node.port.onmessage = (e: MessageEvent<Float32Array>) => onFrame(e.data);
      ctx.createMediaStreamSource(stream).connect(node);
      // Węzeł musi być w grafie, który ciągnie wyjście; sam nic nie wydaje (cisza).
      node.connect(ctx.destination);
      await ctx.resume();
    } catch (e) {
      stream.getTracks().forEach((t) => t.stop());
      void ctx.close();
      throw e;
    }
    return new Mic(ctx, stream);
  }

  /** Wyciszony mikrofon gaśnie też w systemie (kontrolka). */
  set enabled(on: boolean) {
    this.stream.getAudioTracks().forEach((t) => (t.enabled = on));
  }

  close() {
    this.stream.getTracks().forEach((t) => t.stop());
    void this.ctx.close();
  }
}

/** Głośnik: zdania po kolei przez jeden `AnalyserNode` (głośność do animacji kuleczki). */
export class Player {
  private ctx = new AudioContext();
  private analyser = this.ctx.createAnalyser();
  private buf = new Float32Array(1024);

  constructor() {
    this.analyser.fftSize = 1024;
    this.analyser.connect(this.ctx.destination);
  }

  async play(audio: Uint8Array, signal: AbortSignal): Promise<void> {
    if (signal.aborted) return;
    if (this.ctx.state === "suspended") await this.ctx.resume();
    // decodeAudioData zabiera bufor: kopia, bo bajty mogą być widokiem na większy bufor IPC.
    const data = await this.ctx.decodeAudioData(audio.slice().buffer);
    if (signal.aborted) return;
    const src = this.ctx.createBufferSource();
    src.buffer = data;
    src.connect(this.analyser);
    await new Promise<void>((resolve) => {
      const stop = () => {
        try {
          src.stop();
        } catch {
          // już zatrzymane
        }
        resolve();
      };
      src.onended = () => {
        signal.removeEventListener("abort", stop);
        resolve();
      };
      signal.addEventListener("abort", stop, { once: true });
      src.start();
    });
  }

  /** RMS tego, co właśnie gra (0…~0,5). */
  level(): number {
    this.analyser.getFloatTimeDomainData(this.buf);
    let sum = 0;
    for (const x of this.buf) sum += x * x;
    return Math.sqrt(sum / this.buf.length);
  }

  close() {
    void this.ctx.close();
  }
}
