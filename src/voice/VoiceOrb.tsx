import { Fragment, useEffect, useRef, useState, type MutableRefObject } from "react";
import { MessageSquareText, Mic, MicOff, PhoneOff, Settings } from "lucide-react";
import { IconButton } from "../IconButton";
import { useT } from "../i18n/useT";
import type { VoiceTab } from "./TalkSettings";
import type { CardDecision, DeployCard, PaneHost } from "./tools";
import { useVoiceSession } from "./useVoiceSession";
import { exchangeTimes, fmtMs, type VoiceExchange, type VoiceState } from "./voice";
import "./voice.css";

type Props = {
  onClose(): void;
  /** Okno głosu na zakładce: rozmowa (mózg, mowa) albo dyktowanie (silnik transkrypcji, mikrofon). */
  onOpenSettings(tab: VoiceTab): void;
  /** Projekty i panele dla narzędzi rozmówcy (etapy 5 i 7). */
  host?: PaneHost;
  /** Aplikacja wpisuje tu funkcję, którą mówi komunikaty („claude skończył pracę”). */
  noteRef?: MutableRefObject<((text: string) => void) | null>;
};

function statusText(t: ReturnType<typeof useT>["t"], s: VoiceState, muted: boolean): string {
  if (muted) return t("voice.orb.muted");
  if (s.hearing) return t("voice.orb.hearing");
  switch (s.phase) {
    case "transcribing":
      return t("voice.orb.transcribing");
    case "thinking":
      return t("voice.orb.thinking");
    case "speaking":
      return t("voice.orb.speaking");
    case "listening":
      return t("voice.orb.listening");
    default:
      return "";
  }
}

/** Głośność → 0…1 do animacji (mowa ma RMS rzędu 0,02–0,2). */
const norm = (rms: number) => Math.min(1, Math.sqrt(rms * 8));

/** Kuleczka rozmowy na żywo w prawym dolnym rogu; transkrypt z czasami kroków po rozwinięciu. */
export function VoiceOrb({ onClose, onOpenSettings, host, noteRef }: Props) {
  const { t } = useT();
  const { setup, state, muted, setMuted, interrupt, decide, levels } = useVoiceSession(host, noteRef);
  const [showLog, setShowLog] = useState(false);
  const orb = useRef<HTMLButtonElement>(null);
  const phaseRef = useRef(state);
  phaseRef.current = state;

  // Skala kuleczki co klatkę przez zmienną CSS, bez renderu Reacta.
  useEffect(() => {
    let raf = 0;
    let smooth = 0;
    const loop = () => {
      const s = phaseRef.current;
      const target = s.hearing ? norm(levels.current.mic) : s.phase === "speaking" ? norm(levels.current.out) : 0;
      smooth += (target - smooth) * (target > smooth ? 0.5 : 0.15);
      orb.current?.style.setProperty("--lvl", smooth.toFixed(3));
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [levels]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && !e.defaultPrevented && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const busy = state.phase === "thinking" || state.phase === "speaking";
  const orbLabel = busy ? t("voice.orb.interrupt") : muted ? t("voice.orb.unmute") : t("voice.orb.mute");
  const cls = [
    "vorb",
    `is-${setup.status === "ready" ? state.phase : setup.status}`,
    state.hearing ? "is-hearing" : "",
    muted ? "is-muted" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div className="vorb-wrap" role="region" aria-label={t("voice.orb.region")}>
      {showLog && setup.status === "ready" && <Transcript state={state} />}
      {state.card && <Card card={state.card} onDecide={decide} />}
      <div className="vorb-bar">
        <div className="vorb-info">
          {setup.status === "loading" && <span className="vorb-status">{t("voice.orb.starting")}</span>}
          {setup.status === "error" && (
            <>
              <span className="vorb-status is-error">{setup.message}</span>
              {setup.settings && (
                <button type="button" className="vorb-link" onClick={() => onOpenSettings(setup.settings!)}>
                  {t("voice.orb.settingsLink")}
                </button>
              )}
            </>
          )}
          {setup.status === "ready" && (
            <>
              <span className="vorb-status" aria-live="polite">
                {statusText(t, state, muted)}
              </span>
              <span className="vorb-meta" title={t("voice.orb.brainVoice")}>
                {setup.brain} · {setup.tts ?? t("voice.orb.noVoice")}
                {!setup.tools && host && t("voice.orb.noPanes")}
              </span>
              {state.error && <span className="vorb-status is-error">{state.error}</span>}
            </>
          )}
        </div>
        <div className="vorb-tools">
          <IconButton
            icon={muted ? MicOff : Mic}
            label={muted ? t("voice.orb.unmute") : t("voice.orb.mute")}
            className={muted ? "is-on" : undefined}
            disabled={setup.status !== "ready"}
            onClick={() => setMuted(!muted)}
          />
          <IconButton
            icon={MessageSquareText}
            label={showLog ? t("voice.orb.hideLog") : t("voice.orb.showLog")}
            className={showLog ? "is-on" : undefined}
            disabled={setup.status !== "ready"}
            onClick={() => setShowLog(!showLog)}
          />
          <IconButton icon={Settings} label={t("voice.orb.talkSettings")} onClick={() => onOpenSettings("talk")} />
          <IconButton icon={PhoneOff} label={t("voice.orb.end")} shortcut="Esc" onClick={onClose} />
        </div>
        <button
          ref={orb}
          type="button"
          className={cls}
          aria-label={orbLabel}
          title={orbLabel}
          disabled={setup.status !== "ready"}
          onClick={() => (busy ? interrupt() : setMuted(!muted))}
        >
          <span className="vorb-core" />
        </button>
      </div>
    </div>
  );
}

function Transcript({ state }: { state: VoiceState }) {
  const { t } = useT();
  const end = useRef<HTMLDivElement>(null);
  const last = state.history[state.history.length - 1];
  useEffect(() => {
    end.current?.scrollIntoView({ block: "end" });
  }, [state.history.length, last?.reply, last?.spoken.length]);
  return (
    <div className="vorb-log">
      {state.history.length === 0 && <p className="vorb-empty">{t("voice.orb.logEmpty")}</p>}
      {state.history.map((e, i) => (
        <Fragment key={i}>
          {notes(state, i)}
          <Exchange e={e} />
        </Fragment>
      ))}
      {notes(state, state.history.length)}
      {state.carry && <p className="vorb-user is-pending">{state.carry}…</p>}
      <div ref={end} />
    </div>
  );
}

/** Komunikaty aplikacji, które przyszły przed wymianą `i`. */
const notes = (s: VoiceState, i: number) =>
  s.notes
    ?.filter((n) => n.after === i)
    .map((n, k) => (
      <p key={`n${k}`} className="vorb-note">
        {n.text}
      </p>
    ));

function Exchange({ e }: { e: VoiceExchange }) {
  const { t: tr } = useT();
  const t = exchangeTimes(e);
  const said = e.interrupted ? e.spoken.join(" ") : e.reply;
  const unsaid = e.interrupted ? e.reply.slice(said.length) : "";
  const parts = [
    t.stt !== undefined && tr("voice.orb.tStt", { t: fmtMs(t.stt) }),
    t.model !== undefined && tr("voice.orb.tModel", { t: fmtMs(t.model) }),
    t.voice !== undefined && tr("voice.orb.tVoice", { t: fmtMs(t.voice) }),
    t.total !== undefined && tr("voice.orb.tTotal", { t: fmtMs(t.total) }),
  ].filter(Boolean);
  return (
    <div className="vorb-ex">
      <p className="vorb-user">{e.user}</p>
      {(said || e.interrupted) && (
        <p className="vorb-reply">
          {said}
          {e.interrupted && <span className="vorb-cut"> {tr("voice.interrupted")}</span>}
          {unsaid && <span className="vorb-unsaid">{unsaid}</span>}
        </p>
      )}
      {e.tools?.map((t, i) => (
        <p key={i} className={`vorb-tool${t.ok ? "" : " is-fail"}`}>
          {t.label}
          {t.ok ? "" : tr("voice.orb.tFail")}
        </p>
      ))}
      {e.error && <p className="vorb-status is-error">{e.error}</p>}
      {parts.length > 0 && <p className="vorb-times">{parts.join(" · ")}</p>}
    </div>
  );
}

/** Pierwsze linie polecenia dla agenta: pełne jest w panelu po uruchomieniu. */
const preview = (text: string) => {
  const lines = text.split("\n").filter((l) => l.trim());
  const head = lines.slice(0, 3).join("\n");
  return lines.length > 3 || head.length > 280 ? `${head.slice(0, 280)}…` : head;
};

/** Karta deploy: zadania czekają na klik albo „tak” / „nie” / „popraw…” głosem. */
function Card({ card, onDecide }: { card: DeployCard; onDecide(d: CardDecision): void }) {
  const { t: tr } = useT();
  const run = useRef<HTMLButtonElement>(null);
  useEffect(() => run.current?.focus(), [card]);
  const head = card.head;
  return (
    <div className="vorb-card" role="alertdialog" aria-label={head}>
      <p className="vorb-card-head">{head}</p>
      <ol className="vorb-tasks">
        {card.tasks.map((t, i) => (
          <li key={i}>
            <span className="vorb-agent">
              {t.agent}
              {t.account && ` · ${t.account}`}
              {t.model && ` · ${t.model}`}
            </span>{" "}
            <b>{t.title}</b>
            {t.prompt && <pre>{preview(t.prompt)}</pre>}
          </li>
        ))}
      </ol>
      <div className="vorb-card-actions">
        <span className="vorb-hint">{tr("voice.orb.cardHint")}</span>
        <button type="button" className="btn" onClick={() => onDecide({ kind: "cancel" })}>
          {tr("voice.orb.cancel")}
        </button>
        <button type="button" className="btn" onClick={() => onDecide({ kind: "fix" })}>
          {tr("voice.orb.fix")}
        </button>
        <button ref={run} type="button" className="btn primary" onClick={() => onDecide({ kind: "run" })}>
          {card.action}
        </button>
      </div>
    </div>
  );
}
