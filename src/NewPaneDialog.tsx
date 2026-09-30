import { useState, type CSSProperties } from "react";
import { agentColor, type AgentDef } from "./agents";
import { Dialog } from "./Dialog";
import { dialogKey, tileDelayMs } from "./new-pane";

type Props = {
  projectName: string;
  agents: AgentDef[];
  /** Zaznaczony na starcie: ostatnio użyty agent (stan ulotny, nie plik). */
  startIndex: number;
  onPick(index: number): void;
  onClose(): void;
};

/** Okno „Nowy panel” (wzór D): kafelki agentów, 1–9 / strzałki / Enter / Esc. */
export function NewPaneDialog({ projectName, agents, startIndex, onPick, onClose }: Props) {
  const [index, setIndex] = useState(Math.min(Math.max(startIndex, 0), Math.max(agents.length - 1, 0)));

  return (
    <Dialog label={`Nowy panel w ${projectName}`} onClose={onClose} onKey={(e, cancel) => {
      const action = dialogKey(e.key, index, agents.length);
      if (!action) return;
      e.preventDefault();
      if (action.type === "close") cancel();
      else if (action.type === "move") setIndex(action.index);
      else onPick(action.index);
    }}>
      {(cancel) => (
        <>
          <h2>Nowy panel w {projectName}</h2>
          <p>Agent startuje w folderze projektu.</p>
          {agents.length === 0 ? (
            <p className="tile-cmd">Brak agentów w agents.json</p>
          ) : (
            <div className="tiles">
              {agents.map((agent, i) => (
                <button
                  key={agent.id}
                  type="button"
                  className={`tile${i === index ? " is-active" : ""}`}
                  // opóźnienie wjazdu kafelka (80 + 55·i ms) i kolor agenta dla ramki
                  style={{ "--ag": agentColor(agent), animationDelay: `${tileDelayMs(i)}ms` } as CSSProperties}
                  onClick={() => onPick(i)}
                >
                  <span className="tile-top">
                    <span className="ag-badge" aria-hidden>
                      {agent.name.charAt(0).toUpperCase()}
                    </span>
                    <kbd>{i < 9 ? i + 1 : ""}</kbd>
                  </span>
                  <span className="tile-name">{agent.name}</span>
                  <span className="tile-cmd">{agent.command}</span>
                </button>
              ))}
            </div>
          )}
          <div className="dialog-foot">
            <span>
              <kbd>1</kbd>–<kbd>{Math.min(agents.length, 9)}</kbd> wybór
            </span>
            <span>
              <kbd>↑</kbd>
              <kbd>↓</kbd> ruch
            </span>
            <span>
              <kbd>Esc</kbd> zamknij
            </span>
          </div>
        </>
      )}
    </Dialog>
  );
}
