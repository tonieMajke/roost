import { useCallback, useEffect, useRef, useState, type MutableRefObject } from "react";
import type { ChatRequest } from "../chat";
import { backend } from "../backend";
import { activeStt, cleanTranscript } from "../stt";
import { Mic, micError, Player } from "./audio";
import { VoiceSession } from "./session";
import type { VoiceTab } from "./TalkSettings";
import { overviewText, runVoiceTool, voiceTools, type CardDecision, type PaneHost } from "./tools";
import { encodeWav, Utterances, VAD_DEFAULT, VAD_PLAYING } from "./vad";
import { activeTts, resolveBrain, VOICE_IDLE, voicePrompt, voiceRequest, voiceTurns, type VoiceState } from "./voice";
import { t } from "../i18n";

export type VoiceSetup =
  | { status: "loading" }
  | { status: "error"; message: string; /** brak ustawień: przycisk otwiera tę zakładkę okna głosu */ settings: VoiceTab | null }
  | { status: "ready"; brain: string; tts: string | null; /** mózg z narzędziami do paneli (dostawca HTTP) */ tools: boolean };

/** Bieżąca głośność: mikrofonu i tego, co gra. Ref, nie stan: zmienia się co ramkę. */
export type VoiceLevels = { mic: number; out: number };

/**
 * Rozmowa na żywo, póki kuleczka jest otwarta: mikrofon cały czas, VAD tnie wypowiedzi, sesja
 * prowadzi resztę. Ustawienia czyta raz na start; zmiana wymaga ponownego otwarcia.
 */
export function useVoiceSession(host?: PaneHost, noteRef?: MutableRefObject<((text: string) => void) | null>) {
  const hostRef = useRef(host);
  hostRef.current = host;
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
        return fail(t("voice.setup.settings", { msg: e instanceof Error ? e.message : String(e) }));
      }
      if (closed) return;
      if (!activeStt(stt.config)) return fail(t("voice.setup.noStt"), "dictation");
      const found = resolveBrain(chat.providers, voice.config.brain);
      if (!found) {
        const ref = voice.config.brain;
        return fail(ref ? t("voice.setup.noModel", { model: `${ref.provider}/${ref.model}` }) : t("voice.setup.noModels"), "talk");
      }
      const ttsP = activeTts(tts.config, voice.config);
      const headphones = voice.config.headphones;
      // HTTP: pętla narzędzi tutaj; claude/codex CLI: przez serwer MCP z procesu głównego (`tool_request`).
      const tools = hostRef.current !== undefined;

      const player = new Player();
      cleanup.push(() => player.close());
      const session = new VoiceSession(
        {
          transcribe: async (wav) => cleanTranscript(await backend.sttTranscribe(wav, "audio/wav")),
          ask: (history, extra, onEvent) => {
            const h = hostRef.current;
            if (!tools || !h) return backend.chatSend(voiceRequest(found.provider, found.model.id, history, voicePrompt(new Date())), onEvent);
            const req: ChatRequest = {
              ...voiceRequest(found.provider, found.model.id, history, voicePrompt(new Date(), overviewText(h.projects()))),
              turns: [...voiceTurns(history), ...extra],
              tools: voiceTools(h.agents().map((a) => a.id)),
            };
            return backend.chatSend(req, onEvent);
          },
          ...(tools
            ? {
                tool: (name: string, args: Record<string, unknown>, signal: AbortSignal) => {
                  const h = hostRef.current;
                  if (!h) return Promise.resolve({ ok: false, text: "panele niedostępne" });
                  return runVoiceTool(name, args, { ...h, confirm: (card, sig) => session.confirm(card, sig) }, signal);
                },
                toolResult: (id: string, r: { ok: boolean; text: string }) => void backend.chatToolResult(id, r.ok, r.text).catch(() => undefined),
              }
            : {}),
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
          const playing = !headphones && (session.state.phase === "speaking" || session.speakingNote);
          levels.current.mic = utt.push(frame, playing ? VAD_PLAYING : VAD_DEFAULT);
        });
      } catch (e) {
        cleanup.splice(0).reverse().forEach((f) => f());
        return fail(micError(e));
      }
      if (closed) return void mic.close();
      cleanup.push(() => mic.close());
      live.current = { session, mic, player, utt };
      if (noteRef) {
        noteRef.current = (text) => session.note(text);
        cleanup.push(() => {
          if (noteRef.current) noteRef.current = null;
        });
      }
      const loop = () => {
        levels.current.out = player.level();
        raf = requestAnimationFrame(loop);
      };
      raf = requestAnimationFrame(loop);
      session.start();
      setSetup({ status: "ready", brain: `${found.provider.name} · ${found.model.name}`, tts: ttsP?.name ?? null, tools });
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
  const decide = useCallback((d: CardDecision) => live.current?.session.decide(d), []);

  return { setup, state, muted, setMuted, interrupt, decide, levels };
}

