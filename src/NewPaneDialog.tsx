import { useEffect, useRef, useState } from "react";
import type { AgentDef } from "./agents";
import { dialogKey } from "./new-pane";

type Props = {
  projectName: string;
  agents: AgentDef[];
  /** Zaznaczony na starcie: ostatnio użyty agent (stan ulotny, nie plik). */
  startIndex: number;
  onPick(index: number): void;
  onClose(): void;
};

/** Nakładka „Nowy panel”: kafelki agentów, klawiatura 1–9 / strzałki / Enter / Esc. */
export function NewPaneDialog({ projectName, agents, startIndex, onPick, onClose }: Props) {
  const [index, setIndex] = useState(Math.min(Math.max(startIndex, 0), Math.max(agents.length - 1, 0)));
  const box = useRef<HTMLDivElement>(null);

  // The window owns the keyboard while it is open.
  useEffect(() => {
    box.current?.focus();
  }, []);

  const onKeyDown = (e: React.KeyboardEvent) => {
    const action = dialogKey(e.key, index, agents.length);
    if (!action) return;
    e.preventDefault();
    e.stopPropagation();
    if (action.type === "close") onClose();
    else if (action.type === "move") setIndex(action.index);
    else onPick(action.index);
  };

  return (
    <div className="dialog-backdrop" onMouseDown={onClose}>
      <div
        className="dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="np-title"
        tabIndex={-1}
        ref={box}
        onKeyDown={onKeyDown}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <h2 id="np-title">Nowy panel w {projectName}</h2>
        {agents.length === 0 ? (
          <p className="np-hint">Brak agentów w agents.json</p>
        ) : (
          <ul className="np-list">
            {agents.map((agent, i) => (
              <li key={agent.id}>
                <button
                  type="button"
                  className={`np-tile${i === index ? " is-active" : ""}`}
                  onClick={() => onPick(i)}
                >
                  <span className="np-key">{i < 9 ? i + 1 : ""}</span>
                  <span className="np-name">{agent.name}</span>
                  <span className="np-command">{agent.command}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
        <p className="np-hint">1–{Math.min(agents.length, 9)} lub Enter wybiera · ↑↓ przechodzą · Esc zamyka</p>
      </div>
    </div>
  );
}
