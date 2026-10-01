import { useEffect, useRef, useState } from "react";
import { MessageSquareText, Mic, MicOff, PhoneOff, Settings } from "lucide-react";
import { IconButton } from "../IconButton";
import type { VoiceTab } from "./TalkSettings";
import type { CardDecision, DeployCard, PaneHost } from "./tools";
import { useVoiceSession } from "./useVoiceSession";
import { exchangeTimes, fmtMs, INTERRUPTED, type VoiceExchange, type VoiceState } from "./voice";
import "./voice.css";

type Props = {
  onClose(): void;
  /** Okno głosu na zakładce: rozmowa (mózg, mowa) albo dyktowanie (silnik transkrypcji, mikrofon). */
  onOpenSettings(tab: VoiceTab): void;
  /** Panele aktywnego projektu dla narzędzi rozmówcy (etap 5). */
  host?: PaneHost;
};

function statusText(s: VoiceState, muted: boolean): string {
  if (muted) return "Wyciszony";
  if (s.hearing) return "Słucham…";
  switch (s.phase) {
    case "transcribing":
      return "Rozpoznaję…";
    case "thinking":
      return "Myślę…";
    case "speaking":
      return "Mówię — wejdź mi w słowo";
    case "listening":
      return "Mów";
    default:
      return "";
  }
}

/** Głośność → 0…1 do animacji (mowa ma RMS rzędu 0,02–0,2). */
const norm = (rms: number) => Math.min(1, Math.sqrt(rms * 8));

/** Kuleczka rozmowy na żywo w prawym dolnym rogu; transkrypt z czasami kroków po rozwinięciu. */
export function VoiceOrb({ onClose, onOpenSettings, host }: Props) {
  const { setup, state, muted, setMuted, interrupt, decide, levels } = useVoiceSession(host);
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
    // Esc przy karcie zamyka całą rozmowę (karta anuluje się razem z odpowiedzią).
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const busy = state.phase === "thinking" || state.phase === "speaking";
  const cls = [
    "vorb",
    `is-${setup.status === "ready" ? state.phase : setup.status}`,
    state.hearing ? "is-hearing" : "",
    muted ? "is-muted" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div className="vorb-wrap" role="region" aria-label="Rozmowa głosowa">
      {showLog && setup.status === "ready" && <Transcript state={state} />}
      {state.card && <Card card={state.card} onDecide={decide} />}
      <div className="vorb-bar">
        <div className="vorb-info">
          {setup.status === "loading" && <span className="vorb-status">Uruchamiam…</span>}
          {setup.status === "error" && (
            <>
              <span className="vorb-status is-error">{setup.message}</span>
              {setup.settings && (
                <button type="button" className="vorb-link" onClick={() => onOpenSettings(setup.settings!)}>
                  Ustawienia głosu
                </button>
              )}
            </>
          )}
          {setup.status === "ready" && (
            <>
              <span className="vorb-status" aria-live="polite">
                {statusText(state, muted)}
              </span>
              <span className="vorb-meta" title="Mózg · głos">
                {setup.brain} · {setup.tts ?? "bez głosu"}
                {!setup.tools && host && " · bez paneli"}
              </span>
              {state.error && <span className="vorb-status is-error">{state.error}</span>}
            </>
          )}
        </div>
        <div className="vorb-tools">
          <IconButton
            icon={muted ? MicOff : Mic}
            label={muted ? "Włącz mikrofon" : "Wycisz mikrofon"}
            className={muted ? "is-on" : undefined}
            disabled={setup.status !== "ready"}
            onClick={() => setMuted(!muted)}
          />
          <IconButton
            icon={MessageSquareText}
            label={showLog ? "Schowaj zapis rozmowy" : "Pokaż zapis rozmowy"}
            className={showLog ? "is-on" : undefined}
            disabled={setup.status !== "ready"}
            onClick={() => setShowLog(!showLog)}
          />
          <IconButton icon={Settings} label="Ustawienia rozmowy" onClick={() => onOpenSettings("talk")} />
          <IconButton icon={PhoneOff} label="Zakończ rozmowę" shortcut="Esc" onClick={onClose} />
        </div>
        <button
          ref={orb}
          type="button"
          className={cls}
          aria-label={busy ? "Przerwij odpowiedź" : muted ? "Włącz mikrofon" : "Wycisz mikrofon"}
          title={busy ? "Przerwij odpowiedź" : muted ? "Włącz mikrofon" : "Wycisz mikrofon"}
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
  const end = useRef<HTMLDivElement>(null);
  const last = state.history[state.history.length - 1];
  useEffect(() => {
    end.current?.scrollIntoView({ block: "end" });
  }, [state.history.length, last?.reply, last?.spoken.length]);
  return (
    <div className="vorb-log">
      {state.history.length === 0 && <p className="vorb-empty">Zapis pojawi się po pierwszej wypowiedzi.</p>}
      {state.history.map((e, i) => (
        <Exchange key={i} e={e} />
      ))}
      {state.carry && <p className="vorb-user is-pending">{state.carry}…</p>}
      <div ref={end} />
    </div>
  );
}

function Exchange({ e }: { e: VoiceExchange }) {
  const t = exchangeTimes(e);
  const said = e.interrupted ? e.spoken.join(" ") : e.reply;
  const unsaid = e.interrupted ? e.reply.slice(said.length) : "";
  const parts = [
    t.stt !== undefined && `mowa→tekst ${fmtMs(t.stt)}`,
    t.model !== undefined && `model ${fmtMs(t.model)}`,
    t.voice !== undefined && `głos ${fmtMs(t.voice)}`,
    t.total !== undefined && `razem ${fmtMs(t.total)}`,
  ].filter(Boolean);
  return (
    <div className="vorb-ex">
      <p className="vorb-user">{e.user}</p>
      {(said || e.interrupted) && (
        <p className="vorb-reply">
          {said}
          {e.interrupted && <span className="vorb-cut"> {INTERRUPTED}</span>}
          {unsaid && <span className="vorb-unsaid">{unsaid}</span>}
        </p>
      )}
      {e.tools?.map((t, i) => (
        <p key={i} className={`vorb-tool${t.ok ? "" : " is-fail"}`}>
          {t.label}
          {t.ok ? "" : " – nie wyszło"}
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
  const run = useRef<HTMLButtonElement>(null);
  useEffect(() => run.current?.focus(), [card]);
  const head =
    card.kind === "open" ? `Otworzyć ${card.tasks.length === 1 ? "panel" : `${card.tasks.length} panele`} z zadaniami?` : "Wysłać do panelu?";
  return (
    <div className="vorb-card" role="alertdialog" aria-label={head}>
      <p className="vorb-card-head">{head}</p>
      <ol className="vorb-tasks">
        {card.tasks.map((t, i) => (
          <li key={i}>
            <span className="vorb-agent">{t.agent}</span> <b>{t.title}</b>
            <pre>{preview(t.prompt)}</pre>
          </li>
        ))}
      </ol>
      <div className="vorb-card-actions">
        <span className="vorb-hint">albo powiedz „tak”, „nie” lub co zmienić</span>
        <button type="button" className="btn" onClick={() => onDecide({ kind: "cancel" })}>
          Anuluj
        </button>
        <button type="button" className="btn" onClick={() => onDecide({ kind: "fix" })}>
          Popraw
        </button>
        <button ref={run} type="button" className="btn primary" onClick={() => onDecide({ kind: "run" })}>
          {card.kind === "open" ? "Uruchom" : "Wyślij"}
        </button>
      </div>
    </div>
  );
}
