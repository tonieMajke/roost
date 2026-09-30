import { useEffect, useRef, useState } from "react";
import { backend, type ExitInfo } from "./backend";
import { buildArgs, type AgentDef } from "./agents";
import { CONFIRM_MS, confirmClick, isArmed, type Arm } from "./confirm";
import type { Pane as PaneModel } from "./workspace";
import type { PaneActions } from "./handlers";
import { Terminal } from "./Terminal";

type Props = {
  pane: PaneModel;
  path: string; // folder of the project: cwd of the process
  agent?: AgentDef;
  focused: boolean;
  maximized: boolean;
  exited?: ExitInfo;
  actions: PaneActions;
};

const exitLabel = (info: ExitInfo) => (info.signal ? `sygnał ${info.signal}` : `kod ${info.code}`);

/** Frame around one terminal: header with agent, state and controls. */
export function Pane({ pane, path, agent, focused, maximized, exited, actions }: Props) {
  const key = `x:${pane.id}`;
  const armRef = useRef<Arm>(null);
  const [armed, setArmed] = useState(false);
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
        ? backend.claudeSessionExists(pane.sessionId).catch(() => false)
        : Promise.resolve(false);
    void known.then((exists) => {
      if (live) setArgsFor({ run: pane.run, sessionId: pane.sessionId, args: buildArgs(agent, pane.sessionId, exists) });
    });
    return () => {
      live = false;
    };
  }, [agent, pane.sessionId, pane.run]);

  const args =
    argsFor && argsFor.run === pane.run && argsFor.sessionId === pane.sessionId ? argsFor.args : null;

  // "Na pewno?" lasts CONFIRM_MS, then the button goes back to ✕.
  useEffect(() => {
    if (!armed) return;
    const t = setTimeout(() => setArmed(false), CONFIRM_MS);
    return () => clearTimeout(t);
  }, [armed]);

  const close = () => {
    const r = confirmClick(armRef.current, key, Date.now());
    armRef.current = r.arm;
    setArmed(r.fire ? false : isArmed(r.arm, key, Date.now()));
    if (r.fire) actions.close(pane.id);
  };

  return (
    <section
      className={`pane${focused ? " is-focused" : ""}`}
      onPointerDown={() => actions.focus(pane.id)}
    >
      <header className="pane-head">
        <span className="pane-name">{agent?.name ?? pane.agentId}</span>
        <span className={`dot ${exited ? "dot--off" : "dot--on"}`} title={exited ? exitLabel(exited) : "działa"} />
        <span className="pane-tools">
          {agent?.session && (
            <button type="button" title="Nowa rozmowa" onClick={() => actions.newConversation(pane.id)}>
              +
            </button>
          )}
          <button type="button" title="Uruchom ponownie" onClick={() => actions.restart(pane.id)}>
            ⟳
          </button>
          <button
            type="button"
            className={maximized ? "is-on" : undefined}
            title={maximized ? "Przywróć" : "Maksymalizuj"}
            onClick={() => actions.toggleMaximize(pane.id)}
          >
            ⤢
          </button>
          <button
            type="button"
            className={armed ? "is-confirm" : undefined}
            title="Zamknij panel"
            onClick={close}
          >
            {armed ? "Na pewno?" : "✕"}
          </button>
        </span>
      </header>
      <div className="pane-body">
        {args && agent && (
          <Terminal
            key={`${pane.id}:${pane.run}`}
            command={agent.command}
            args={args}
            cwd={path}
            focused={focused}
            onExit={(info) => actions.exit(pane.id, info)}
            onFocus={() => actions.focus(pane.id)}
          />
        )}
      </div>
    </section>
  );
}
