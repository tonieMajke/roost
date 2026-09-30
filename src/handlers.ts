import type { ExitInfo } from "./backend";
import type { TerminalHandle } from "./Terminal";
import type { Preset } from "./workspace";

/** Callbacks the grid/panes call. App builds them around the workspace reducer. */
export type PaneActions = {
  focus(paneId: string): void;
  restart(paneId: string): void;
  toggleMaximize(paneId: string): void;
  newConversation(paneId: string): void; // nowa rozmowa: nowe sessionId + run + 1 (tylko agenci z `session`)
  close(paneId: string): void;
  exit(paneId: string, info: ExitInfo): void;
  /** Proces panelu wystartował (także po restarcie). */
  started(paneId: string): void;
  /** Uchwyt terminala panelu (kopiuj/wklej); `null` gdy terminal znika. */
  registerTerminal(paneId: string, handle: TerminalHandle | null): void;
  /** Bajty od procesu — aktywność panelu (patrz `src/activity.ts`). */
  output(paneId: string): void;
  /** Terminal przerysowany (resize): chwila ciszy, bo to nie praca agenta. */
  redraw(paneId: string): void;
};

export type ProjectActions = {
  select(projectId: string): void;
  rename(projectId: string, name: string): void;
  remove(projectId: string): void;
  addProject(): void; // etap 6: pyta o katalog przez backend.pickDir()
  openPaneDialog(): void; // otwiera okno wyboru agenta (etap 6)
  addPane(agentId: string, model?: string): void; // dodaje panel z tym agentem do aktywnego projektu
  /** Preset (etap 10): dodaje panele na koniec aktywnego projektu, maks. do MAX_PANES. */
  applyPreset(preset: Preset): void;
};
