// Przebieg rozmowy głosowej bez DOM: wypowiedź → transkrypcja → mózg (strumień) → zdania → mowa →
// odtwarzanie, z przerywaniem. Mikrofon, VAD i głośnik podaje hook (`useVoiceSession`), więc
// tutaj wszystko da się sprawdzić atrapami.

import type { ChatEvent } from "../chat";
import { speakable, splitSentences, VOICE_IDLE, voiceReducer, type VoiceEvent, type VoiceExchange, type VoiceState } from "./voice";

export type VoiceDeps = {
  transcribe(wav: Uint8Array): Promise<string>;
  /** Odpowiedź mózgu na całą historię (ostatnia wymiana bez odpowiedzi); zwraca Stop. */
  ask(history: VoiceExchange[], onEvent: (e: ChatEvent) => void): () => void;
  /** `null` = bez silnika mowy: odpowiedź tylko tekstem w transkrypcie. */
  speak: ((id: string, text: string) => Promise<Uint8Array>) | null;
  cancelSpeak(id: string): void;
  /** Gra jedno zdanie; kończy się po zagraniu albo po `signal`. */
  play(audio: Uint8Array, signal: AbortSignal): Promise<void>;
  now(): number;
};

type Reply = { n: number; stop: () => void; ids: string[]; ac: AbortController };

export class VoiceSession {
  state: VoiceState = VOICE_IDLE;
  private reply: Reply | null = null;
  /** Rośnie przy `stop`: spóźniona transkrypcja ze starej rozmowy nie trafia do nowej. */
  private epoch = 0;

  constructor(
    private deps: VoiceDeps,
    private onChange: (s: VoiceState) => void,
  ) {}

  private emit(ev: VoiceEvent) {
    const next = voiceReducer(this.state, ev);
    if (next === this.state) return;
    this.state = next;
    this.onChange(next);
  }

  start() {
    this.emit({ type: "start" });
  }

  stop() {
    this.epoch++;
    this.cancelReply();
    this.emit({ type: "stop" });
  }

  /** VAD: użytkownik zaczął mówić — w trakcie odpowiedzi to przerwanie. */
  speechStart() {
    if (this.state.phase === "thinking" || this.state.phase === "speaking") this.cancelReply();
    this.emit({ type: "speech_start" });
  }

  /** Przerwanie bez mówienia (klik w kuleczkę). */
  interrupt() {
    this.cancelReply();
    this.emit({ type: "interrupt" });
  }

  async speechEnd(wav: Uint8Array) {
    if (this.state.phase === "idle") return;
    this.emit({ type: "speech_end", at: this.deps.now() });
    const epoch = this.epoch;
    let text: string;
    try {
      text = await this.deps.transcribe(wav);
    } catch (e) {
      if (epoch === this.epoch) this.emit({ type: "error", message: `transkrypcja: ${message(e)}` });
      return;
    }
    if (epoch !== this.epoch) return;
    const before = this.state.history.length;
    this.emit({ type: "transcript", text, at: this.deps.now() });
    if (this.state.history.length > before) this.answer(this.state.history.length - 1);
  }

  private cancelReply() {
    const r = this.reply;
    if (!r) return;
    this.reply = null;
    r.ac.abort();
    r.stop();
    for (const id of r.ids) this.deps.cancelSpeak(id);
  }

  private answer(n: number) {
    this.cancelReply();
    const ac = new AbortController();
    const r: Reply = { n, stop: () => undefined, ids: [], ac };
    this.reply = r;
    const live = () => this.reply === r && !ac.signal.aborted;
    let buffer = "";
    let played = Promise.resolve();
    let k = 0;

    const fail = (msg: string) => {
      if (!live()) return;
      this.cancelReply();
      this.emit({ type: "error", n, message: msg });
    };

    const say = (sentence: string) => {
      const speak = this.deps.speak;
      const text = speakable(sentence);
      if (!speak || !text) return;
      const id = `${n}-${k++}`;
      r.ids.push(id);
      // Synteza rusza od razu (następne zdania liczą się, gdy gra bieżące), gra po kolei.
      const audio = speak(id, text);
      audio.catch(() => undefined);
      played = played.then(async () => {
        if (!live()) return;
        let bytes: Uint8Array;
        try {
          bytes = await audio;
        } catch (e) {
          return fail(`mowa: ${message(e)}`);
        }
        if (!live()) return;
        this.emit({ type: "audio_start", n, text: sentence, at: this.deps.now() });
        await this.deps.play(bytes, ac.signal).catch((e: unknown) => fail(`odtwarzanie: ${message(e)}`));
      });
    };

    const feed = (final: boolean) => {
      const { ready, rest } = splitSentences(buffer, final);
      buffer = rest;
      ready.forEach(say);
    };

    r.stop = this.deps.ask(this.state.history, (e) => {
      if (!live()) return;
      if (e.type === "text") {
        this.emit({ type: "delta", n, text: e.text, at: this.deps.now() });
        buffer += e.text;
        feed(false);
      } else if (e.type === "done") {
        feed(true);
        this.emit({ type: "reply_done", n });
        void played.then(() => {
          if (!live()) return;
          this.reply = null;
          this.emit({ type: "audio_idle", n });
        });
      } else if (e.type === "error") {
        fail(e.message);
      }
    });
  }
}

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));
