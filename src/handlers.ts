import type { ExitInfo } from "./backend";

/** Callbacks the grid/panes call. App builds them around the workspace reducer. */
export type PaneActions = {
  focus(paneId: string): void;
  restart(paneId: string): void;
  toggleMaximize(paneId: string): void;
  newConversation(paneId: string): void; // nowa rozmowa: nowe sessionId + run + 1 (tylko agenci z `session`)
  close(paneId: string): void;
  exit(paneId: string, info: ExitInfo): void;
};

export type ProjectActions = {
  select(projectId: string): void;
  rename(projectId: string, name: string): void;
  remove(projectId: string): void;
  addProject(): void; // etap 6: pyta o katalog przez backend.pickDir()
  openPaneDialog(): void; // otwiera okno wyboru agenta (etap 6)
  addPane(agentId: string): void; // dodaje panel z tym agentem do aktywnego projektu
};
