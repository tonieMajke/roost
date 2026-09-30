import { mockBackend } from "./backend-mock";
import { tauriBackend } from "./backend-tauri";
import type { AgentDef } from "./agents";
import type { ContextKind, SessionContext } from "./context";
import type { ClaudeLimits } from "./limits";
import type { Handoff } from "./handoff";

export type ExitInfo = { code: number; signal: string | null };

export type SpawnSpec = { command: string; args?: string[]; cwd?: string; cols: number; rows: number };

export type PtyHandle = {
  id: number;
  write(data: string): void;
  resize(cols: number, rows: number): void;
  kill(): void;
};

/** Everything a component may ask the backend for. Every call goes through this interface. */
export interface Backend {
  spawnPty(spec: SpawnSpec, onData: (bytes: Uint8Array) => void, onExit: (info: ExitInfo) => void): Promise<PtyHandle>;
  loadAgents(): Promise<{ agents: AgentDef[]; errors: string[] }>;
  claudeSessionExists(id: string): Promise<boolean>;
  /** Rozmiar kontekstu z pliku sesji agenta (tylko odczyt); `null` = brak pliku albo danych. */
  sessionContext(kind: ContextKind, sessionId: string): Promise<SessionContext | null>;
  /** Wyciąg rozmowy do przekazania innemu panelowi (M4); `null` = brak pliku albo pusta rozmowa. */
  sessionHandoff(kind: ContextKind, sessionId: string): Promise<Handoff | null>;
  /** Streszczenie `input` przez jednorazowe `claude -p --model haiku` (`command` = program claude); odrzuca z powodem. */
  claudeSummary(command: string, system: string, input: string): Promise<string>;
  /** JSON dla `claude --settings` (linia statusu zapisuje limity); `null` = użytkownik ma własną linię statusu. */
  claudeSettingsArg(): Promise<string | null>;
  /** Ostatnie limity subskrypcji z linii statusu claude; `null` = jeszcze żadnych. */
  claudeLimits(): Promise<ClaudeLimits | null>;
  dirExists(path: string): Promise<boolean>;
  /** Folder wybrany przez użytkownika; `null` = anulowanie. */
  pickDir(): Promise<string | null>;
  /** Katalog domowy, żeby zapisywać ścieżki jako `~/...` (patrz `src/paths.ts`). */
  homeDir(): Promise<string>;
  /** Treść `workspace.json`; `null` = pierwszy start aplikacji. */
  loadWorkspace(): Promise<string | null>;
  saveWorkspace(json: string): Promise<void>;
  /** Kopia `workspace.json` → `workspace.<date>.bak` (`RRRR-MM-DD`); istniejącej kopii nie nadpisuje. */
  backupWorkspace(date: string): Promise<void>;
  /** Tekst do schowka (Ctrl+Shift+C). */
  copyText(text: string): Promise<void>;
  /** Tekst ze schowka (Ctrl+Shift+V); `null` = pusty schowek. */
  pasteText(): Promise<string | null>;
  /** Powiadomienie na pulpicie, gdy panel bez fokusu skończył pracę. */
  notify(title: string, body: string): Promise<void>;
}

export const inTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

/** In the browser (`pnpm dev`) the UI runs against the mock, so it is reviewable without a window. */
export const backend: Backend = inTauri ? tauriBackend : mockBackend;
