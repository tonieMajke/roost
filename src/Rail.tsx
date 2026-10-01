import { useEffect, useRef, useState, type CSSProperties } from "react";
import { CONFIRM_MS, confirmClick, isArmed, type Arm } from "./confirm";
import { agentColor, type AgentDef } from "./agents";
import { IconButton } from "./IconButton";
import { FolderPlus, Mic, PanelLeft, SlidersHorizontal, X } from "lucide-react";
import { paneStatus, projectState, type PaneState } from "./activity";
import type { Workspace } from "./workspace";
import { ModeTabs, type Mode } from "./chat/ModeTabs";

type Props = {
  mode: Mode;
  onMode(m: Mode): void;
  ws: Workspace;
  agents: AgentDef[];
  state: Record<string, PaneState>;
  /** Tytuł rozmowy według id panelu: odróżnia kilka paneli tego samego agenta. */
  titles: Record<string, string>;
  /** Projekt, którego panel skończył pracę, gdy patrzono gdzie indziej — jednorazowy `ping`. */
  pingId: string | null;
  onSelect(projectId: string): void;
  onFocusPane(paneId: string): void;
  onAddProject(): void;
  onRename(projectId: string, name: string): void;
  onRemove(projectId: string): void;
  onToggleRail(): void;
  /** Okno „Wygląd” (etap 5). */
  onOpenAppearance(): void;
  /** Okno „Dyktowanie”: silnik transkrypcji dla mikrofonu w panelach. */
  onOpenVoice(): void;
};

/** Treść title dla kropki projektu — sama kropka nie mówi, który panel. */
const projDotTitle = (cls: string) =>
  cls === "has-unread" ? "nowe wyjście w panelu" : cls === "has-work" ? "pracuje w panelu" : "";

/** Left rail (wzór D): marka, projekty z ich panelami, stopka z akcjami. */
export function Rail({
  mode,
  onMode,
  ws,
  agents,
  state,
  titles,
  pingId,
  onSelect,
  onFocusPane,
  onAddProject,
  onRename,
  onRemove,
  onToggleRail,
  onOpenAppearance,
  onOpenVoice,
}: Props) {
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
        <ModeTabs mode={mode} onMode={onMode} />
        <IconButton
          icon={PanelLeft}
          label={ws.ui.rail === "closed" ? "Rozwiń szynę" : "Zwiń szynę"}
          shortcut="Ctrl+Alt+B"
          onClick={onToggleRail}
        />
      </header>
      <div className="rail-label">Projekty</div>
      <div className="rail-list">
        {ws.projects.map((project, i) => {
          const st = (paneId: string) => state[paneId] ?? {};
          const dot = projectState(project.panes.map((p) => st(p.id)));
          // Ctrl+Alt+1…9 przełącza projekt – numer widać w <kbd> (powyżej 9 nie ma skrótu).
          const projCls = [
            project.id === ws.active ? "is-active" : "",
            dot,
            pingId === project.id ? "ping" : "",
          ]
            .filter(Boolean)
            .join(" ");
          return (
            <div key={project.id} className={`proj${projCls ? " " + projCls : ""}`}>
              <div
                className="proj-row"
                onClick={() => onSelect(project.id)}
                onDoubleClick={() => setEditing({ id: project.id, value: project.name })}
              >
                {editing?.id === project.id ? (
                  <input
                    className="proj-edit"
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
                    <kbd title={i < 9 ? `Ctrl+Alt+${i + 1}` : undefined}>{i + 1}</kbd>
                    <span className="proj-text">
                      <span className="proj-name">{project.name}</span>
                      <span className="proj-path" title={project.path}>
                        {project.path}
                      </span>
                    </span>
                    <span className="proj-dot" title={projDotTitle(dot)} />
                    <IconButton
                      icon={X}
                      label={`Usuń projekt ${project.name}`}
                      className={`proj-close${armedId === project.id ? " is-confirm" : ""}`}
                      title={
                        isArmed(armRef.current, keyOf(project.id), Date.now())
                          ? "Kliknij ponownie, aby usunąć"
                          : "Usuń projekt"
                      }
                      onClick={(e) => {
                        e.stopPropagation();
                        remove(project.id);
                      }}
                      // two quick clicks on ✕ are also a dblclick; it must not open renaming
                      onDoubleClick={(e) => e.stopPropagation()}
                    >
                      {armedId === project.id ? "Na pewno?" : undefined}
                    </IconButton>
                  </>
                )}
              </div>
              {/* Panele tylko pod aktywnym projektem (animacja `fold`), stan panelu tekstem po prawej. */}
              {project.id === ws.active && project.panes.length > 0 && (
                <div className="proj-panes">
                  {project.panes.map((pane) => {
                    const r = paneStatus(st(pane.id));
                    return (
                      <div
                        key={pane.id}
                        className={`pane-row ${r.cls}${pane.id === project.focused ? " is-focused" : ""}`}
                        // kropka wiersza w kolorze agenta (--ag stemplowany przez Rail)
                        style={{ "--ag": agentColor(agents.find((a) => a.id === pane.agentId)) } as CSSProperties}
                        onClick={() => onFocusPane(pane.id)}
                      >
                        <span className="ag-dot" />
                        <span className="pane-row-name" title={titles[pane.id]}>
                          {titles[pane.id] ?? name(pane.agentId)}
                        </span>
                        <span className="pane-row-state">{r.text}</span>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>
      <footer className="rail-foot">
        <IconButton icon={FolderPlus} label="Dodaj projekt" shortcut="Ctrl+Alt+P" onClick={onAddProject} />
        <IconButton icon={Mic} label="Dyktowanie" onClick={onOpenVoice} />
        <IconButton icon={SlidersHorizontal} label="Wygląd" onClick={onOpenAppearance} />
      </footer>
    </aside>
  );
}
