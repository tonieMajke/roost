import { useCallback, useEffect, useRef, useState } from "react";
import { backend } from "../backend";
import { activeStt, cleanTranscript } from "../stt";
import { Mic, micError, Player } from "./audio";
import { VoiceSession } from "./session";
import type { VoiceTab } from "./TalkSettings";
import { encodeWav, Utterances, VAD_DEFAULT, VAD_PLAYING } from "./vad";
import { activeTts, resolveBrain, VOICE_IDLE, voicePrompt, voiceRequest, type VoiceState } from "./voice";

export type VoiceSetup =
  | { status: "loading" }
  | { status: "error"; message: string; /** brak ustawień: przycisk otwiera tę zakładkę okna głosu */ settings: VoiceTab | null }
  | { status: "ready"; brain: string; tts: string | null };

/** Bieżąca głośność: mikrofonu i tego, co gra. Ref, nie stan: zmienia się co ramkę. */
export type VoiceLevels = { mic: number; out: number };

/**
 * Rozmowa na żywo, póki kuleczka jest otwarta: mikrofon cały czas, VAD tnie wypowiedzi, sesja
 * prowadzi resztę. Ustawienia czyta raz na start; zmiana wymaga ponownego otwarcia.
 */
export function useVoiceSession() {
  const [setup, setSetup] = useState<VoiceSetup>({ status: "loading" });
  const [state, setState] = useState<VoiceState>(VOICE_IDLE);
  const [muted, setMutedState] = useState(false);
  const levels = useRef<VoiceLevels>({ mic: 0, out: 0 });
  const live = useRef<{ session: VoiceSession; mic: Mic; player: Player; utt: Utterances } | null>(null);
  const mutedRef = useRef(false);

  useEffect(() => {
    let closed = false;
    let raf = 0;
    const cleanup: (() => void)[] = [];
    void (async () => {
      const fail = (message: string, settings: VoiceTab | null = null) => !closed && setSetup({ status: "error", message, settings });
      let stt, voice, tts, chat;
      try {
        [stt, voice, tts, chat] = await Promise.all([backend.sttConfig(), backend.voiceConfig(), backend.ttsConfig(), backend.chatConfig()]);
      } catch (e) {
        return fail(`ustawienia: ${e instanceof Error ? e.message : String(e)}`);
      }
      if (closed) return;
      if (!activeStt(stt.config)) return fail("Wybierz silnik transkrypcji (Dyktowanie).", "dictation");
      const found = resolveBrain(chat.providers, voice.config.brain);
      if (!found) {
        const ref = voice.config.brain;
        return fail(ref ? `Nie ma modelu ${ref.provider}/${ref.model} w Czacie.` : "Brak modeli w Czacie.", "talk");
      }
      const ttsP = activeTts(tts.config, voice.config);
      const headphones = voice.config.headphones;

      const player = new Player();
      cleanup.push(() => player.close());
      const session = new VoiceSession(
        {
          transcribe: async (wav) => cleanTranscript(await backend.sttTranscribe(wav, "audio/wav")),
          ask: (history, onEvent) =>
            backend.chatSend(voiceRequest(found.provider, found.model.id, history, voicePrompt(new Date())), onEvent),
          speak: ttsP ? (id, text) => backend.voiceSpeak(id, text) : null,
          cancelSpeak: (id) => backend.voiceCancel(id),
          play: (audio, signal) => player.play(audio, signal),
          now: () => performance.now(),
        },
        (s) => !closed && setState(s),
      );
      cleanup.push(() => {
        session.stop();
        backend.voiceEnd();
      });
      const utt = new Utterances({
        start: () => session.speechStart(),
        end: (audio) => void session.speechEnd(encodeWav(audio)),
      });
      let mic: Mic;
      try {
        mic = await Mic.open(stt.config.mic, (frame) => {
          if (mutedRef.current) return;
          // Echo z głośników nie może przerywać: w trakcie mowy wyższy próg (chyba że słuchawki).
          const playing = !headphones && session.state.phase === "speaking";
          levels.current.mic = utt.push(frame, playing ? VAD_PLAYING : VAD_DEFAULT);
        });
      } catch (e) {
        cleanup.splice(0).reverse().forEach((f) => f());
        return fail(micError(e));
      }
      if (closed) return void mic.close();
      cleanup.push(() => mic.close());
      live.current = { session, mic, player, utt };
      const loop = () => {
        levels.current.out = player.level();
        raf = requestAnimationFrame(loop);
      };
      raf = requestAnimationFrame(loop);
      session.start();
      setSetup({ status: "ready", brain: `${found.provider.name} · ${found.model.name}`, tts: ttsP?.name ?? null });
    })();
    return () => {
      closed = true;
      cancelAnimationFrame(raf);
      live.current = null;
      cleanup.splice(0).reverse().forEach((f) => f());
    };
  }, []);

  const setMuted = useCallback((on: boolean) => {
    mutedRef.current = on;
    setMutedState(on);
    const l = live.current;
    if (!l) return;
    l.mic.enabled = !on;
    l.utt.reset();
    levels.current.mic = 0;
  }, []);

  const interrupt = useCallback(() => live.current?.session.interrupt(), []);

  return { setup, state, muted, setMuted, interrupt, levels };
}

