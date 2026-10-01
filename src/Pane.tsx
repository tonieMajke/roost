import { useEffect, useRef, useState, type CSSProperties } from "react";
import { backend } from "./backend";
import { agentColor, buildArgs, withModel, type AgentDef } from "./agents";
import { exitText, paneStatus, type PaneState } from "./activity";
import type { ContextMeter } from "./context";
import { withClaudeSettings } from "./limits";
import { accountEnv, type AccountDef } from "./accounts";
import { CONFIRM_MS, confirmClick, isArmed, type Arm } from "./confirm";
import type { Pane as PaneModel } from "./workspace";
import type { PaneActions } from "./handlers";
import { Terminal, type TermLook, type TerminalHandle } from "./Terminal";
import { IconButton } from "./IconButton";
import { useDictation } from "./useDictation";
import { useT } from "./i18n/useT";
import { ArrowRightLeft, Loader2, Maximize2, MessageSquarePlus, Mic, Minimize2, RotateCw, Square, X } from "lucide-react";

type Props = {
  pane: PaneModel;
  path: string; // folder of the project: cwd of the process
  agent?: AgentDef;
  /** Konto agenta panelu (`pane.account`); `undefined` = jego własny folder logowania. */
  account?: AccountDef;
  /** Plakietka z nazwą konta w nagłówku (gdy użytkownik ma więcej niż jedno). */
  showAccount?: boolean;
  /** Konto panelu wyczerpało okno limitu (pasek z propozycją kontynuacji); `null` = nic. */
  limitHit?: { text: string; resetsAt: number } | null;
  /** Można przenieść rozmowę: panel ma sesję i czytnik wyciągu. */
  canContinue?: boolean;
  /** Kolory i font xtermu (motyw + akcent). */
  look: TermLook;
  /** Rozmiar czcionki terminala (px). */
  fontSize: number;
  focused: boolean;
  maximized: boolean;
  state: PaneState; // stan ulotny: proces + aktywność
  /** Miernik kontekstu w nagłówku; `null` = agent bez miernika. */
  meter: ContextMeter | null;
  /** Tytuł rozmowy (terminal albo plik sesji); brak = sama nazwa agenta. */
  title?: string;
  /** Trwa animacja `paneOut`; reduktor zamknie panel po PANE_OUT_MS. */
  closing: boolean;
  /** true gdy skrót z klawiatury uzbroił „Na pewno?” na zamknięciu tego panelu. */
  armed?: boolean;
  actions: PaneActions;
};

// Jedno pytanie na całą aplikację: odpowiedź się nie zmienia, a paneli jest do 16 na projekt.
// Odpowiedź zależy tylko od konta (własny plik limitów), więc pamiętamy ją per konto.
const settingsArgs = new Map<string, Promise<string | null>>();
const claudeSettingsArg = (account?: AccountDef) => {
  const key = account?.id ?? "";
  let hit = settingsArgs.get(key);
  if (!hit) {
    hit = backend.claudeSettingsArg(account && { id: account.id, dir: account.dir }).catch(() => null);
    settingsArgs.set(key, hit);
  }
  return hit;
};

/** Czas animacji `paneOut` w styles.css — tyle App czeka z `close` w reduktorze. */
export const PANE_OUT_MS = 190;

/** Frame around one terminal: header with agent, state and controls. */
export function Pane({ pane, path, agent, account, showAccount, limitHit, canContinue, look, fontSize, focused, maximized, state, meter, title, closing, armed, actions }: Props) {
  const { t } = useT();
  const key = `x:${pane.id}`;
  const armRef = useRef<Arm>(null);
  const [armedClick, setArmedClick] = useState(false);
  // Odrzucony pasek limitu wraca dopiero przy nowym czasie resetu (nowe okno).
  const [dismissedReset, setDismissedReset] = useState(0);
  const actionsRef = useRef(actions);
  actionsRef.current = actions;
  // Stable ref callback: App keeps the terminal handle of this pane for Ctrl+Shift+C/V.
  const register = useRef((h: TerminalHandle | null) => actionsRef.current.registerTerminal(pane.id, h));
  // Args stamped with the pane state they were computed for: the new Conversation
  // changes sessionId + run in one dispatch, and Terminal must never mount with
  // args from the previous conversation (its spawn effect runs once, at mount).
  const [argsFor, setArgsFor] = useState<{ run: number; sessionId?: string; args: string[] } | null>(null);

  // Resume vs. new conversation needs a backend answer; until then the panel stays empty
  // (mounting Terminal earlier would start the process with the wrong arguments).
  useEffect(() => {
    let live = true;
    setArgsFor(null);
    if (!agent) return;
    const known: Promise<boolean> =
      agent.session?.check === "claude" && pane.sessionId
        ? backend.claudeSessionExists(pane.sessionId, account?.dir).catch(() => false)
        : Promise.resolve(false);
    void Promise.all([known, claudeSettingsArg(account)]).then(([exists, settings]) => {
      if (!live) return;
      // claude: linia statusu z limitami subskrypcji dla pulpitu (Rust `limits.rs`).
      const args = withClaudeSettings(agent, withModel(buildArgs(agent, pane.sessionId, exists), pane.model), settings);
      setArgsFor({ run: pane.run, sessionId: pane.sessionId, args });
    });
    return () => {
      live = false;
    };
  }, [agent, pane.sessionId, pane.run, account?.dir]);

  const args =
    argsFor && argsFor.run === pane.run && argsFor.sessionId === pane.sessionId ? argsFor.args : null;

  // "Na pewno?" lasts CONFIRM_MS, then the button goes back to ✕.
  useEffect(() => {
    if (!armedClick) return;
    const timer = setTimeout(() => setArmedClick(false), CONFIRM_MS);
    return () => clearTimeout(timer);
  }, [armedClick]);

  const close = () => {
    const r = confirmClick(armRef.current, key, Date.now());
    armRef.current = r.arm;
    setArmedClick(r.fire ? false : isArmed(r.arm, key, Date.now()));
    if (r.fire) actions.close(pane.id);
  };

  const showArmed = armed === true || armedClick;
  const voice = useDictation({
    onText: (text) => actions.dictated(pane.id, text),
    onError: (message) => actions.voiceError(message),
    getMic: () => actions.voiceMic(),
  });
  const mic = () => (actions.voiceReady() ? voice.toggle() : actions.openVoice());
  const status = paneStatus(state);
  const name = agent?.name ?? pane.agentId;

  return (
    <section
      className={`pane ${status.cls}${focused ? " is-focused" : ""}${closing ? " is-closing" : ""}`}
      data-ag={pane.agentId} // motywy rozróżniają agentów też kształtem (Bauhaus, E-papier)
      // Kolor agenta dla CSS (--ag): poświata, ramka, nagłówek (wzór D).
      style={{ "--ag": agentColor(agent) } as CSSProperties}
      onPointerDown={() => actions.focus(pane.id)}
    >
      {/* poświata pracy / fala po skończeniu (st-working, st-done) */}
      <div className="glow" />
      <header className="pane-head">
        <span className="ag-badge" aria-hidden>
          {name.charAt(0).toUpperCase()}
        </span>
        <span className={`pane-name${title ? " has-title" : ""}`}>{name}</span>
        {title && (
          <span className="pane-title" title={title}>
            {title}
          </span>
        )}
        {account && showAccount && (
          <span className="pane-account" title={t("pane.account", { name: account.name, dir: account.dir })}>
            {account.name}
          </span>
        )}
        <span className="pane-state">{status.text}</span>
        {meter && (
          <span
            className={`ctx${meter.warn ? " is-warn" : ""}`}
            title={meter.known ? t("pane.ctx.known", { used: meter.used, limit: meter.limit }) : t("pane.ctx.unknown", { limit: meter.limit })}
          >
            <span className="ctx-bar">
              <span style={{ width: `${meter.pct}%` }} />
            </span>
            {meter.known ? `${meter.pct}%` : "–"}
          </span>
        )}
        <span className={`tools${voice.phase !== "idle" ? " has-rec" : ""}`}>
          {state.exited ? null : voice.phase === "transcribing" ? (
            <IconButton icon={Loader2} label={t("pane.transcribing")} className="is-busy" disabled />
          ) : (
            <IconButton
              icon={voice.phase === "recording" ? Square : Mic}
              label={voice.phase === "recording" ? t("pane.dictStop") : t("pane.dict")}
              className={voice.phase === "recording" ? "is-rec" : undefined}
              onClick={mic}
            />
          )}
          {canContinue && (
            <IconButton icon={ArrowRightLeft} label={t("pane.continue")} onClick={() => actions.continueFrom(pane.id)} />
          )}
          {agent?.session && (
            <IconButton icon={MessageSquarePlus} label={t("pane.newConv")} onClick={() => actions.newConversation(pane.id)} />
          )}
          <IconButton icon={RotateCw} label={t("pane.restart")} shortcut="Ctrl+Alt+R" onClick={() => actions.restart(pane.id)} />
          <IconButton
            icon={maximized ? Minimize2 : Maximize2}
            label={maximized ? t("ui2.win.restore") : t("ui2.win.maximize")}
            shortcut="Ctrl+Alt+Enter"
            className={maximized ? "is-on" : undefined}
            onClick={() => actions.toggleMaximize(pane.id)}
          />
          <IconButton
            icon={X}
            label={t("pane.closePane")}
            shortcut="Ctrl+Alt+W"
            className={showArmed ? "is-confirm" : undefined}
            onClick={close}
          >
            {showArmed ? t("ui2.rail.sure") : undefined}
          </IconButton>
        </span>
      </header>
      <div className="pane-body">
        {args && agent && (
          <Terminal
            key={`${pane.id}:${pane.run}`}
            command={agent.command}
            args={args}
            cwd={path}
            env={accountEnv(account)}
            look={look}
            fontSize={fontSize}
            focused={focused}
            apiRef={register.current}
            onExit={(info) => actions.exit(pane.id, info)}
            onStart={() => actions.started(pane.id)}
            onFocus={() => actions.focus(pane.id)}
            onOutput={() => actions.output(pane.id)}
            onRedraw={() => actions.redraw(pane.id)}
            onTitle={(text) => actions.title(pane.id, text)}
          />
        )}
      </div>
      {canContinue && limitHit && limitHit.resetsAt !== dismissedReset && (
        <div className="pane-exit pane-limit">
          {limitHit.text} ·{" "}
          <button type="button" className="link" onClick={() => actions.continueFrom(pane.id)}>
            {t("pane.continue")}
          </button>{" "}
          ·{" "}
          <button type="button" className="link" onClick={() => setDismissedReset(limitHit.resetsAt)}>
            {t("pane.wait")}
          </button>
        </div>
      )}
      {state.exited && (
        <div className="pane-exit">
          {t("pane.exited", { text: exitText(state.exited) })} ·{" "}
          <button type="button" className="link" onClick={() => actions.restart(pane.id)}>
            {t("pane.restart")}
          </button>{" "}
          <kbd>Ctrl+Alt+R</kbd>
        </div>
      )}
    </section>
  );
}
