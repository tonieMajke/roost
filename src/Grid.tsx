import { gridShape, type Project } from "./workspace";
import type { AgentDef } from "./agents";
import type { PaneState } from "./activity";
import type { PaneActions, ProjectActions } from "./handlers";
import { Pane } from "./Pane";

type Props = {
  projects: Project[];
  activeId: string | null;
  agents: AgentDef[];
  state: Record<string, PaneState>; // stan ulotny (exit + aktywność), patrz src/activity.ts
  /** Panel, dla którego skrót z klawiatury uzbroił „Na pewno?” (etap 8). */
  armedPane: string | null;
  paneActions: PaneActions;
  projectActions: ProjectActions;
};

const agentById = (agents: AgentDef[], id: string) => agents.find((a) => a.id === id);

/**
 * One grid per project, all of them mounted: switching projects hides a grid with
 * `display: none`, it never unmounts (unmounting would kill the processes).
 */
export function Grid({ projects, activeId, agents, state, armedPane, paneActions, projectActions }: Props) {
  return (
    <>
      {projects.map((project) => {
        const active = project.id === activeId;
        const { cols, rows } = gridShape(project.panes.length);
        const maximized = active && project.maximized !== null;
        return (
          <div
            key={project.id}
            className="project-grid"
            style={{
              display: active ? "grid" : "none",
              gridTemplateColumns: `repeat(${maximized ? 1 : cols}, 1fr)`,
              gridTemplateRows: `repeat(${maximized ? 1 : rows}, 1fr)`,
            }}
          >
            {project.panes.length === 0 ? (
              <div className="empty">
                <p>Brak paneli</p>
                <button type="button" onClick={projectActions.openPaneDialog}>
                  + Panel
                </button>
              </div>
            ) : (
              project.panes.map((pane) => (
                <div
                  key={pane.id}
                  className="pane-cell"
                  style={{ display: project.maximized && project.maximized !== pane.id ? "none" : "flex" }}
                >
                  <Pane
                    pane={pane}
                    path={project.path}
                    agent={agentById(agents, pane.agentId)}
                    focused={active && pane.id === project.focused}
                    maximized={project.maximized === pane.id}
                    exited={state[pane.id]?.exited}
                    working={state[pane.id]?.working}
                    unread={state[pane.id]?.unread}
                    armed={pane.id === armedPane}
                    actions={paneActions}
                  />
                </div>
              ))
            )}
          </div>
        );
      })}
    </>
  );
}
