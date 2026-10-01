// Przebieg rozmowy głosowej bez DOM: wypowiedź → transkrypcja → mózg (strumień) → zdania → mowa →
// odtwarzanie, z przerywaniem. Mikrofon, VAD i głośnik podaje hook (`useVoiceSession`), więc
// tutaj wszystko da się sprawdzić atrapami.

import type { ChatEvent, ToolCall, Turn } from "../chat";
import { cardAnswer, VOICE_MAX_STEPS, voiceToolLabel, type CardDecision, type DeployCard, type VoiceToolResult } from "./tools";
import { speakable, splitSentences, VOICE_IDLE, voiceReducer, type VoiceEvent, type VoiceExchange, type VoiceState } from "./voice";

export type VoiceDeps = {
  transcribe(wav: Uint8Array): Promise<string>;
  /** Jeden krok mózgu na całą historię (ostatnia wymiana bez odpowiedzi) plus `extra`: wywołania
   *  narzędzi i ich wyniki z poprzednich kroków tej odpowiedzi. Zwraca Stop. */
  ask(history: VoiceExchange[], extra: Turn[], onEvent: (e: ChatEvent) => void): () => void;
  /** Narzędzia rozmówcy (etap 5); brak = mózg bez narzędzi (CLI). `signal`: odpowiedź przerwana. */
  tool?: (name: string, args: Record<string, unknown>, signal: AbortSignal) => Promise<VoiceToolResult>;
  /** claude/codex CLI: wynik narzędzia z `tool_request` wraca do procesu głównego (CLI czeka). */
  toolResult?: (id: string, r: VoiceToolResult) => void;
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
  /** Karta deploy czekająca na decyzję. */
  private card: { resolve: (d: CardDecision) => void } | null = null;
  /** Komunikaty czekające na ciszę (w trakcie odpowiedzi nie wchodzimy w słowo) i ten, który gra. */
  private queued: string[] = [];
  private notePlaying: { ac: AbortController; id: string } | null = null;
  private noteSeq = 0;

  constructor(
    private deps: VoiceDeps,
    private onChange: (s: VoiceState) => void,
  ) {}

  private emit(ev: VoiceEvent) {
    const next = voiceReducer(this.state, ev);
    if (next === this.state) return;
    this.state = next;
    this.onChange(next);
    if (this.queued.length && next.phase === "listening" && !next.hearing && !this.card) this.flushNotes();
  }

  /** Gra komunikat aplikacji (np. agent skończył pracę) — gdy jest cisza; jak odpowiedź, przerywa go mowa. */
  get speakingNote(): boolean {
    return this.notePlaying !== null;
  }

  note(text: string) {
    if (this.state.phase === "idle") return;
    this.emit({ type: "note", text });
    this.queued.push(text);
    if (this.state.phase === "listening" && !this.state.hearing && !this.card) this.flushNotes();
  }

  private flushNotes() {
    const speak = this.deps.speak;
    const text = speakable(this.queued.splice(0).join(" "));
    if (!speak || !text || this.notePlaying) return;
    const ac = new AbortController();
    const id = `note-${this.noteSeq++}`;
    const playing = { ac, id };
    this.notePlaying = playing;
    const done = () => {
      if (this.notePlaying === playing) this.notePlaying = null;
    };
    speak(id, text)
      .then((bytes) => (ac.signal.aborted || this.state.phase !== "listening" ? undefined : this.deps.play(bytes, ac.signal)))
      .catch(() => undefined) // komunikat to dodatek: błąd mowy widać przy następnej odpowiedzi
      .finally(done);
  }

  private stopNote() {
    this.queued = [];
    const n = this.notePlaying;
    if (!n) return;
    this.notePlaying = null;
    n.ac.abort();
    this.deps.cancelSpeak(n.id);
  }

  start() {
    this.emit({ type: "start" });
  }

  stop() {
    this.epoch++;
    this.stopNote();
    this.cancelReply();
    this.emit({ type: "stop" });
  }

  /** VAD: użytkownik zaczął mówić — w trakcie odpowiedzi to przerwanie. */
  speechStart() {
    // Komunikat milknie, ale nie przepada z zapisu; nie ponawiamy go.
    const n = this.notePlaying;
    if (n) {
      this.notePlaying = null;
      n.ac.abort();
      this.deps.cancelSpeak(n.id);
    }
    if (this.card) return this.emit({ type: "speech_start" }); // odpowiedź na kartę, nie przerwanie
    // W trakcie „myśli” odpowiedź czeka: przerwie ją dopiero niepusty transkrypt (`answer`).
    if (this.state.phase === "speaking") this.cancelReply();
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
    if (this.card) {
      const d = cardAnswer(text);
      if (d) this.decide(d);
      return;
    }
    const before = this.state.history.length;
    this.emit({ type: "transcript", text, at: this.deps.now() });
    if (this.state.history.length > before) this.answer(this.state.history.length - 1);
  }

  /** Karta nad kuleczką; rozstrzyga ją klik (`decide`), głos albo przerwanie odpowiedzi (= anuluj). */
  confirm(card: DeployCard, signal: AbortSignal): Promise<CardDecision> {
    this.card?.resolve({ kind: "cancel" });
    if (signal.aborted) return Promise.resolve({ kind: "cancel" });
    return new Promise((resolve) => {
      const entry = {
        resolve: (d: CardDecision) => {
          if (this.card !== entry) return;
          this.card = null;
          signal.removeEventListener("abort", onAbort);
          this.emit({ type: "card", card: null });
          resolve(d);
        },
      };
      const onAbort = () => entry.resolve({ kind: "cancel" });
      signal.addEventListener("abort", onAbort, { once: true });
      this.card = entry;
      this.emit({ type: "card", card });
    });
  }

  decide(d: CardDecision) {
    this.card?.resolve(d);
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
        // Użytkownik mówi, a odpowiedź właśnie miałaby zagrać: to przerwanie, nie gramy na niego.
        if (this.state.hearing) {
          this.cancelReply();
          return this.emit({ type: "interrupt" });
        }
        this.emit({ type: "audio_start", n, text: sentence, at: this.deps.now() });
        await this.deps.play(bytes, ac.signal).catch((e: unknown) => fail(`odtwarzanie: ${message(e)}`));
      });
    };

    const feed = (final: boolean) => {
      const { ready, rest } = splitSentences(buffer, final);
      buffer = rest;
      ready.forEach(say);
    };

    const extra: Turn[] = [];
    let steps = 0;

    const finish = () => {
      feed(true);
      this.emit({ type: "reply_done", n });
      void played.then(() => {
        if (!live()) return;
        this.reply = null;
        this.emit({ type: "audio_idle", n });
      });
    };

    const runTools = async (text: string, calls: ToolCall[]) => {
      extra.push({ role: "assistant", content: text, calls });
      for (const c of calls) {
        const out: VoiceToolResult =
          c.bad !== undefined
            ? { ok: false, text: `argumenty nie są poprawnym obiektem JSON: ${c.bad.slice(0, 200)}` }
            : await this.deps.tool!(c.name, c.args, ac.signal).catch((e: unknown) => ({ ok: false, text: message(e) }));
        if (!live()) return;
        this.emit({ type: "tool", n, label: voiceToolLabel(c.name, c.args), ok: out.ok });
        extra.push({ role: "tool", id: c.id, content: out.text, ...(out.ok ? {} : { error: true }) });
      }
      step();
    };

    const step = () => {
      if (steps++ >= VOICE_MAX_STEPS) {
        this.emit({ type: "delta", n, text: " Przerwałem, za dużo kroków z panelami.", at: this.deps.now() });
        buffer += " Przerwałem, za dużo kroków z panelami.";
        return finish();
      }
      let text = "";
      let afterTool = false;
      const calls: ToolCall[] = [];
      r.stop = this.deps.ask(this.state.history, extra, (e) => {
        if (!live()) return;
        if (e.type === "text") {
          // Tekst kolejnego kroku (po narzędziach) to nowe zdanie, nie ciąg poprzedniego.
          const fresh = (text === "" && extra.length > 0) || afterTool;
          const chunk = fresh && this.state.history[n]?.reply ? ` ${e.text}` : e.text;
          afterTool = false;
          text += e.text;
          this.emit({ type: "delta", n, text: chunk, at: this.deps.now() });
          buffer += chunk;
          feed(false);
        } else if (e.type === "tool_request") {
          // CLI prowadzi pętlę sam: narzędzie tutaj, wynik wraca do niego, odpowiedź płynie dalej.
          feed(true);
          afterTool = true;
          const run = this.deps.tool
            ? this.deps.tool(e.name, e.args, ac.signal).catch((err: unknown) => ({ ok: false, text: message(err) }))
            : Promise.resolve({ ok: false, text: "narzędzia niedostępne" });
          void run.then((out) => {
            this.deps.toolResult?.(e.id, out);
            if (live()) this.emit({ type: "tool", n, label: voiceToolLabel(e.name, e.args), ok: out.ok });
          });
        } else if (e.type === "tool_call") {
          calls.push({ id: e.id, name: e.name, args: e.args, ...(e.bad !== undefined ? { bad: e.bad } : {}) });
        } else if (e.type === "done") {
          if (calls.length === 0 || !this.deps.tool) return finish();
          feed(true); // to, co powiedział przed narzędziem, gra, zanim pojawi się karta
          void runTools(text, calls);
        } else if (e.type === "error") {
          fail(e.message);
        }
      });
    };

    step();
  }
}

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));
