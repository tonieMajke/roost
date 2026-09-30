import type { ExitInfo } from "./backend";

/** Callbacks the grid/panes call. App builds them around the workspace reducer. */
export type PaneActions = {
  focus(paneId: string): void;
  restart(paneId: string): void;
  toggleMaximize(paneId: string): void;
  close(paneId: string): void;
  exit(paneId: string, info: ExitInfo): void;
};

export type ProjectActions = {
  select(projectId: string): void;
  rename(projectId: string, name: string): void;
  remove(projectId: string): void;
  addProject(): void; // stage 5: adds "~", the folder picker comes in stage 6
  addPane(): void; // stage 5: adds a pane for the default agent
};
