import { useEffect, useMemo, useReducer, useState } from "react";
import { backend, inTauri, type ExitInfo } from "./backend";
import type { AgentDef } from "./agents";
import {
  MAX_PANES,
  activeProject,
  emptyWorkspace,
  projectName,
  reduce,
  type Pane,
  type Project,
} from "./workspace";
import { Rail } from "./Rail";
import { Grid } from "./Grid";
import type { PaneActions, ProjectActions } from "./handlers";

/** Stage 5: no persisted state yet, so the app starts empty and "+ Projekt" adds "~". */
const START_PATH = "~";

export function App() {
  const [ws, dispatch] = useReducer(reduce, emptyWorkspace);
  const [agents, setAgents] = useState<AgentDef[]>([]);
  const [errors, setErrors] = useState<string[]>([]);
  // Ephemeral only: never written to disk (stage 9 adds activity/unread here).
  const [ephemeral, setEphemeral] = useState<Record<string, { exited?: ExitInfo }>>({});

  useEffect(() => {
    let live = true;
    void backend
      .loadAgents()
      .then((r) => {
        if (!live) return;
        setAgents(r.agents);
        setErrors(r.errors);
      })
      .catch((e: unknown) => setErrors([`agents: ${String(e)}`]));
    return () => {
      live = false;
    };
  }, []);

  const defaultAgent = useMemo(
    () => agents.find((a) => a.id === "claude") ?? agents[0],
    [agents],
  );
  const active = activeProject(ws);
  const paneCount = active?.panes.length ?? 0;

  const forget = (ids: string[]) =>
    setEphemeral((prev) => {
      if (!ids.some((id) => id in prev)) return prev;
      const next = { ...prev };
      for (const id of ids) delete next[id];
      return next;
    });

  const paneActions: PaneActions = {
    focus: (paneId) => dispatch({ type: "focus", id: paneId }),
    restart: (paneId) => {
      forget([paneId]);
      dispatch({ type: "restart", id: paneId });
    },
    toggleMaximize: (paneId) => dispatch({ type: "toggleMaximize", id: paneId }),
    close: (paneId) => {
      forget([paneId]);
      dispatch({ type: "close", id: paneId });
    },
    exit: (paneId, info) => setEphemeral((prev) => ({ ...prev, [paneId]: { ...prev[paneId], exited: info } })),
  };

  const projectActions: ProjectActions = {
    select: (projectId) => dispatch({ type: "selectProject", id: projectId }),
    rename: (projectId, name) => dispatch({ type: "renameProject", id: projectId, name }),
    remove: (projectId) => {
      const project = ws.projects.find((p) => p.id === projectId);
      forget(project ? project.panes.map((p) => p.id) : []);
      dispatch({ type: "removeProject", id: projectId });
    },
    addProject: () => {
      const project: Project = {
        id: crypto.randomUUID(),
        name: projectName(START_PATH),
        path: START_PATH,
        panes: [],
        focused: null,
        maximized: null,
      };
      dispatch({ type: "addProject", project });
    },
    addPane: () => {
      if (!defaultAgent || paneCount >= MAX_PANES) return;
      const pane: Pane = { id: crypto.randomUUID(), agentId: defaultAgent.id, run: 1 };
      if (defaultAgent.session) pane.sessionId = crypto.randomUUID();
      dispatch({ type: "add", pane });
    },
  };

  const exited = useMemo(() => {
    const map: Record<string, ExitInfo> = {};
    for (const [id, state] of Object.entries(ephemeral)) if (state.exited) map[id] = state.exited;
    return map;
  }, [ephemeral]);

  return (
    <div className="app">
      <Rail
        ws={ws}
        agents={agents}
        exited={exited}
        onSelect={(id) => dispatch({ type: "selectProject", id })}
        onFocusPane={(id) => dispatch({ type: "focus", id })}
        onAddProject={projectActions.addProject}
        onRename={projectActions.rename}
        onRemove={projectActions.remove}
      />
      <main className="area">
        {errors.length > 0 && <div className="config-errors">{errors.join(" · ")}</div>}
        {ws.projects.length === 0 ? (
          <div className="empty">
            <p>Dodaj folder projektu</p>
            <button type="button" onClick={projectActions.addProject}>
              + Projekt
            </button>
          </div>
        ) : (
          <>
            <header className="area-head">
              <div className="area-id">
                <span className="area-name">{active?.name}</span>
                <span className="area-path" title={active?.path}>
                  {active?.path}
                </span>
              </div>
              <div className="area-tools">
                <span className="area-count">
                  {paneCount}/{MAX_PANES}
                </span>
                <button type="button" onClick={projectActions.addPane} disabled={paneCount >= MAX_PANES}>
                  + Panel
                </button>
              </div>
            </header>
            <div className="grids">
              <Grid
                projects={ws.projects}
                activeId={ws.active}
                agents={agents}
                exited={exited}
                paneActions={paneActions}
                projectActions={projectActions}
              />
            </div>
          </>
        )}
        {!inTauri && <div className="preview-badge">podgląd – bez prawdziwych procesów</div>}
      </main>
    </div>
  );
}
