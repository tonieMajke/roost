import { useCallback, useEffect, useRef, useState } from "react";
import { backend } from "./backend";
import { cleanTranscript, MAX_RECORDING_MS, micConstraints, MIN_RECORDING_MS, pickRecorderMime } from "./stt";
import { t } from "./i18n";

export type DictationPhase = "idle" | "recording" | "transcribing";

type Hooks = {
  /** Gotowy tekst (jedna linia, bez Entera): trafia do terminala jako wklejka. */
  onText(text: string): void;
  /** `deviceId` wybranego mikrofonu przy starcie nagrania; pusty = domyślny. */
  getMic(): string;
  /** Błąd po polsku: mikrofon, sieć, klucz. */
  onError(message: string): void;
};

/** Powód, dla którego `getUserMedia` odmówiło, po ludzku. */
function micError(e: unknown): string {
  const name = (e as { name?: string })?.name;
  if (name === "NotAllowedError" || name === "SecurityError") return t("voice.mic.denied");
  if (name === "NotFoundError" || name === "OverconstrainedError") return t("voice.mic.notFound");
  if (name === "NotReadableError") return t("voice.mic.busy");
  return t("voice.mic.other", { msg: e instanceof Error ? e.message : String(e) });
}

/**
 * Jedno nagranie na raz w jednym panelu: `toggle` zaczyna, a drugie wywołanie kończy i wysyła do
 * silnika z `stt.json`. Strumień mikrofonu żyje tylko w trakcie nagrania (świeci kontrolka systemu
 * dokładnie wtedy, gdy słuchamy). `cancel` i odmontowanie panelu wyrzucają nagranie bez wysyłki.
 */
export function useDictation({ onText, onError, getMic }: Hooks) {
  const [phase, setPhase] = useState<DictationPhase>("idle");
  const hooks = useRef({ onText, onError, getMic });
  hooks.current = { onText, onError, getMic };
  const rec = useRef<{ recorder: MediaRecorder; stream: MediaStream; started: number; discard: boolean; limit: ReturnType<typeof setTimeout> } | null>(null);
  const alive = useRef(true);
  const starting = useRef(false); // `getUserMedia` może czekać na zgodę: drugie kliknięcie nie startuje drugiego nagrania
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      const r = rec.current;
      if (r) {
        r.discard = true;
        if (r.recorder.state !== "inactive") r.recorder.stop();
        else r.stream.getTracks().forEach((t) => t.stop());
      }
    };
  }, []);

  const finish = useCallback(async (chunks: Blob[], mime: string, ms: number) => {
    if (ms < MIN_RECORDING_MS) return void (alive.current && setPhase("idle"));
    try {
      const blob = new Blob(chunks, { type: mime });
      const text = cleanTranscript(await backend.sttTranscribe(new Uint8Array(await blob.arrayBuffer()), mime));
      if (!alive.current) return;
      setPhase("idle");
      if (text) hooks.current.onText(text);
      else hooks.current.onError(t("voice.dictation.nothing"));
    } catch (e) {
      if (!alive.current) return;
      setPhase("idle");
      hooks.current.onError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  const start = useCallback(async () => {
    if (starting.current || rec.current) return;
    starting.current = true;
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: micConstraints(hooks.current.getMic()) });
    } catch (e) {
      return void hooks.current.onError(micError(e));
    } finally {
      starting.current = false;
    }
    if (!alive.current) return void stream.getTracks().forEach((t) => t.stop());
    const mimeType = pickRecorderMime((m) => MediaRecorder.isTypeSupported(m));
    const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
    const chunks: Blob[] = [];
    const state = {
      recorder,
      stream,
      started: Date.now(),
      discard: false,
      limit: setTimeout(() => recorder.state === "recording" && recorder.stop(), MAX_RECORDING_MS),
    };
    rec.current = state;
    recorder.ondataavailable = (e) => e.data.size > 0 && chunks.push(e.data);
    recorder.onerror = () => {
      state.discard = true;
      hooks.current.onError(t("voice.dictation.recError"));
      if (recorder.state !== "inactive") recorder.stop();
    };
    recorder.onstop = () => {
      clearTimeout(state.limit);
      stream.getTracks().forEach((t) => t.stop());
      if (rec.current === state) rec.current = null;
      if (state.discard) return void (alive.current && setPhase("idle"));
      setPhase("transcribing");
      void finish(chunks, recorder.mimeType || mimeType || "audio/webm", Date.now() - state.started);
    };
    recorder.start();
    setPhase("recording");
  }, [finish]);

  const stop = useCallback(() => {
    if (rec.current?.recorder.state === "recording") rec.current.recorder.stop();
  }, []);

  const cancel = useCallback(() => {
    const r = rec.current;
    if (!r) return;
    r.discard = true;
    if (r.recorder.state === "recording") r.recorder.stop();
  }, []);

  return {
    phase,
    /** Zaczyna nagranie; w trakcie nagrania kończy je. W trakcie transkrypcji nic nie robi. */
    toggle: () => (phase === "idle" ? void start() : phase === "recording" ? stop() : undefined),
    cancel,
  };
}
