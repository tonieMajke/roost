import { useEffect, useMemo, useReducer, useRef, useState } from "react";
import { backend, inTauri, type ExitInfo } from "./backend";
import type { AgentDef } from "./agents";
import { tildify } from "./paths";
import {
  MAX_PANES,
  activeProject,
  emptyWorkspace,
  parseWorkspace,
  projectName,
  reduce,
  type Pane,
  type Project,
} from "./workspace";
import { Rail } from "./Rail";
import { Grid } from "./Grid";
import { NewPaneDialog } from "./NewPaneDialog";
import type { PaneActions, ProjectActions } from "./handlers";

export function App() {
  const [ws, dispatch] = useReducer(reduce, emptyWorkspace);
  const [agents, setAgents] = useState<AgentDef[]>([]);
  const [errors, setErrors] = useState<string[]>([]);
  // Ephemeral only: never written to disk (stage 9 adds activity/unread here).
  const [ephemeral, setEphemeral] = useState<Record<string, { exited?: ExitInfo }>>({});
  const [notice, setNotice] = useState<string | null>(null);
  const [dialog, setDialog] = useState(false);
  const [lastAgentId, setLastAgentId] = useState<string | null>(null);
  // false do końca startu: zapis `ws` na dysk musi ruszyć dopiero po wczytaniu pliku.
  const [loaded, setLoaded] = useState(false);
  // Home is fetched once: paths are stored as `~/...` (Rust expands them at spawn).
  const home = useRef<string>("");

  // Start: agents first (parseWorkspace needs their ids), then the saved layout.
  useEffect(() => {
    let live = true;
    const backup = () => backend.backupWorkspace(new Date().toISOString().slice(0, 10)).catch(() => undefined);
    void (async () => {
      try {
        const r = await backend.loadAgents();
        if (!live) return;
        setAgents(r.agents);
        setErrors(r.errors);
        const raw = await backend.loadWorkspace();
        if (!live || raw === null) return; // pierwszy start: zostaje emptyWorkspace
        let parsed: ReturnType<typeof parseWorkspace>;
        try {
          parsed = parseWorkspace(JSON.parse(raw) as unknown, r.agents.map((a) => a.id));
        } catch (e) {
          // Plik, który nie jest nawet JSON-em: zachowaj go, zanim nadpiszemy pusty stan.
          await backup();
          if (live) setErrors((prev) => [...prev, `workspace: ${String(e)}`]);
          return;
        }
        if (parsed.errors.length > 0) {
          await backup(); // zachowaj plik przed pierwszym zapisem, który go nadpisze
          if (live) setErrors((prev) => [...prev, ...parsed.errors]);
          if (!live) return;
        }
        dispatch({ type: "load", workspace: parsed.workspace });
      } catch (e) {
        if (live) setErrors((prev) => [...prev, `workspace: ${String(e)}`]);
      } finally {
        if (live) setLoaded(true);
      }
    })();
    return () => {
      live = false;
    };
  }, []);

  // Zapis przy każdej zmianie, bez debounce (zmiany rzadkie). Przed wczytaniem nie wolno
  // pisać — pusty stan startowy nadpisałby plik.
  useEffect(() => {
    if (!loaded) return;
    void backend.saveWorkspace(JSON.stringify(ws, null, 2)).catch((e: unknown) =>
      setErrors((prev) => [...prev, `zapis: ${String(e)}`]),
    );
  }, [ws, loaded]);

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

  useEffect(() => {
    void backend
      .homeDir()
      .then((dir) => {
        home.current = dir;
      })
      .catch((e: unknown) => setErrors((prev) => [...prev, `home: ${String(e)}`]));
  }, []);

  const defaultAgent = useMemo(
    () => agents.find((a) => a.id === "claude") ?? agents[0],
    [agents],
  );
  const active = activeProject(ws);
  const paneCount = active?.panes.length ?? 0;
  const lastIndex = useMemo(() => {
    const last = agents.findIndex((a) => a.id === lastAgentId);
    return last >= 0 ? last : Math.max(0, agents.findIndex((a) => a.id === defaultAgent?.id));
  }, [agents, lastAgentId, defaultAgent]);

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
    newConversation: (paneId) =>
      dispatch({ type: "newConversation", id: paneId, sessionId: crypto.randomUUID() }),
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
      void (async () => {
        let picked: string | null;
        try {
          picked = await backend.pickDir();
        } catch (e) {
          setNotice(`Wybór katalogu: ${String(e)}`);
          return;
        }
        if (picked === null) return; // anulowane
        // `home.current === ""` (brak HOME) zostawia pełną ścieżkę — Rust i tak ją rozumie.
        const path = tildify(picked, home.current);
        if (!(await backend.dirExists(path).catch(() => false))) {
          setNotice(`Katalog nie istnieje: ${path}`);
          return;
        }
        setNotice(null);
        const project: Project = {
          id: crypto.randomUUID(),
          name: projectName(path),
          path,
          panes: [],
          focused: null,
          maximized: null,
        };
        dispatch({ type: "addProject", project });
      })();
    },
    openPaneDialog: () => {
      if (active === null || paneCount >= MAX_PANES) return; // no project to add a pane to
      setDialog(true);
    },
    addPane: (agentId) => {
      const agent = agents.find((a) => a.id === agentId);
      if (!agent || paneCount >= MAX_PANES) return;
      setDialog(false);
      setLastAgentId(agent.id);
      const pane: Pane = { id: crypto.randomUUID(), agentId: agent.id, run: 1 };
      if (agent.session) pane.sessionId = crypto.randomUUID();
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
        {notice && (
          <div className="config-errors">
            <span>{notice}</span>
            <button type="button" aria-label="Zamknij komunikat" onClick={() => setNotice(null)}>
              ✕
            </button>
          </div>
        )}
        {!loaded ? (
          <div className="empty">
            <p>Wczytywanie…</p>
          </div>
        ) : ws.projects.length === 0 ? (
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
                <button
                  type="button"
                  onClick={projectActions.openPaneDialog}
                  disabled={active === null || paneCount >= MAX_PANES}
                >
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
        {dialog && active && (
          <NewPaneDialog
            projectName={active.name}
            agents={agents}
            startIndex={lastIndex}
            onPick={(i) => {
              const agent = agents[i];
              if (agent) projectActions.addPane(agent.id);
            }}
            onClose={() => setDialog(false)}
          />
        )}
      </main>
    </div>
  );
}
