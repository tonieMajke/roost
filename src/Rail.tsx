import { useEffect, useRef, useState } from "react";
import { CONFIRM_MS, confirmClick, isArmed, type Arm } from "./confirm";
import type { AgentDef } from "./agents";
import { dotClass, type PaneState } from "./activity";
import type { Workspace } from "./workspace";

type Props = {
  ws: Workspace;
  agents: AgentDef[];
  state: Record<string, PaneState>;
  onSelect(projectId: string): void;
  onFocusPane(paneId: string): void;
  onAddProject(): void;
  onRename(projectId: string, name: string): void;
  onRemove(projectId: string): void;
};

/** Left rail: projects with their panes, so you see where work is running. */
export function Rail({ ws, agents, state, onSelect, onFocusPane, onAddProject, onRename, onRemove }: Props) {
  const keyOf = (id: string) => `p:${id}`;
  const armRef = useRef<Arm>(null);
  const [armedId, setArmedId] = useState<string | null>(null);
  const [editing, setEditing] = useState<{ id: string; value: string } | null>(null);

  // "Na pewno?" lasts CONFIRM_MS, then the button goes back to ✕.
  useEffect(() => {
    if (armedId === null) return;
    const t = setTimeout(() => setArmedId(null), CONFIRM_MS);
    return () => clearTimeout(t);
  }, [armedId]);

  const remove = (id: string) => {
    const r = confirmClick(armRef.current, keyOf(id), Date.now());
    armRef.current = r.arm;
    setArmedId(r.fire ? null : isArmed(r.arm, keyOf(id), Date.now()) ? id : null);
    if (r.fire) onRemove(id);
  };

  const name = (agentId: string) => agents.find((a) => a.id === agentId)?.name ?? agentId;

  return (
    <aside className="rail">
      <header className="rail-head">
        <span>Projekty</span>
        <button type="button" title="Dodaj projekt" onClick={onAddProject}>
          +
        </button>
      </header>
      <ul className="rail-list">
        {ws.projects.map((project, i) => (
          <li key={project.id} className={`rail-project${project.id === ws.active ? " is-active" : ""}`}>
            <div
              className="rail-row"
              onClick={() => onSelect(project.id)}
              onDoubleClick={() => setEditing({ id: project.id, value: project.name })}
            >
              {editing?.id === project.id ? (
                <input
                  className="rail-edit"
                  autoFocus
                  value={editing.value}
                  spellCheck={false}
                  onClick={(e) => e.stopPropagation()}
                  onChange={(e) => setEditing({ id: project.id, value: e.target.value })}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      const value = editing.value.trim();
                      if (value !== "") onRename(project.id, value);
                      setEditing(null);
                    } else if (e.key === "Escape") {
                      setEditing(null);
                    }
                  }}
                  onBlur={() => setEditing(null)}
                />
              ) : (
                <>
                  {/* Ctrl+Alt+1…9 przełącza projekt – numer widać przy nazwie (powyżej 9 nie ma skrótu) */}
                  {i < 9 && (
                    <span className="rail-key" title={`Ctrl+Alt+${i + 1}`}>
                      {i + 1}
                    </span>
                  )}
                  {/* Kropka przy projekcie: praca w panelach, których siatka jest schowana. */}
                  <span
                    className={`dot ${project.panes.some((p) => state[p.id]?.unread) ? "dot--unread" : "dot--hidden"}`}
                    title={project.panes.some((p) => state[p.id]?.unread) ? "nowe wyjście w panelu" : ""}
                  />
                  <span className="rail-name">{project.name}</span>
                  <span className="rail-count">{project.panes.length}</span>
                  <button
                    type="button"
                    className={`rail-close${armedId === project.id ? " is-confirm" : ""}`}
                    aria-label={`Usuń projekt ${project.name}`}
                    title={isArmed(armRef.current, keyOf(project.id), Date.now()) ? "Kliknij ponownie, aby usunąć" : "Usuń projekt"}
                    onClick={(e) => {
                      e.stopPropagation();
                      remove(project.id);
                    }}
                    // two quick clicks on ✕ are also a dblclick; it must not open renaming
                    onDoubleClick={(e) => e.stopPropagation()}
                  >
                    {armedId === project.id ? "Na pewno?" : "✕"}
                  </button>
                </>
              )}
            </div>
            <ul className="rail-panes">
              {project.panes.map((pane) => (
                <li
                  key={pane.id}
                  className={`rail-pane${pane.id === project.focused ? " is-focused" : ""}`}
                  title={project.path}
                  onClick={() => onFocusPane(pane.id)}
                >
                  <span className={`dot ${dotClass(state[pane.id] ?? {})}`} />
                  <span>{name(pane.agentId)}</span>
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ul>
    </aside>
  );
}
