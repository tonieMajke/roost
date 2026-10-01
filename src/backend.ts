import { mockBackend } from "./backend-mock";
import { electronBackend } from "./backend-electron";
import type { AgentDef } from "./agents";
import type { ContextKind, SessionContext } from "./context";
import type { ClaudeLimits } from "./limits";
import type { Handoff } from "./handoff";
import type { Chat, ChatConfig, ChatEvent, ChatMeta, ChatRequest, ProviderDef } from "./chat";
import type { ApprovalDecision, ApprovalRequest, BotChat, BotDef, Routine } from "./bot";
import type { SttConfig, SttProvider } from "./stt";

export type KeyState = "stored" | "env" | null;

export type ExitInfo = { code: number; signal: string | null };

export type SpawnSpec = { command: string; args?: string[]; cwd?: string; cols: number; rows: number };

export const ALL_EDGES: readonly ResizeEdge[] = ["North", "South", "East", "West", "NorthWest", "NorthEast", "SouthWest", "SouthEast"];

export type ResizeEdge = "North" | "South" | "East" | "West" | "NorthEast" | "NorthWest" | "SouthEast" | "SouthWest";

/** Okno bez dekoracji systemowych: pasek tytułu i uchwyty krawędzi są w UI (`TitleBar.tsx`). */
export interface WindowControls {
  /** Tytuł okna systemu (pasek zadań, Alt+Tab). */
  setTitle(title: string): void;
  isMaximized(): Promise<boolean>;
  /** `cb` po każdej zmianie rozmiaru albo maksymalizacji; zwraca wyrejestrowanie. */
  onResized(cb: () => void): () => void;
  minimize(): void;
  toggleMaximize(): void;
  close(): void;
  /** Krawędzie z uchwytem w UI; pozostałe zostają oknu (np. Electron na Wayland nie przesuwa okna). */
  edges: readonly ResizeEdge[];
  /** Zmiana rozmiaru od krawędzi, zaczęta wciśnięciem przycisku na uchwycie. */
  startResize(edge: ResizeEdge, e: PointerEvent): void;
}

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
  /** Jak `claudeSummary`, ale streszcza lokalny model przez program pi. */
  piSummary(command: string, system: string, input: string): Promise<string>;
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
  /** Zakładka Czat (M3): dostawcy z `chat.json` + dostawcy pi. */
  chatConfig(): Promise<ChatConfig>;
  /** Modele wykryte u dostawcy (`/models`, pamięć podręczna codex); błąd = serwer nie odpowiada. */
  chatModels(provider: ProviderDef): Promise<string[]>;
  /** Zapis własnych dostawców (`configJson`) do `chat.json`. */
  chatSaveConfig(json: string): Promise<void>;
  /** Czy dostawca ma klucz: zapisany w sejfie, ze zmiennej środowiskowej, brak. */
  chatKeyStatus(providers: ProviderDef[]): Promise<Record<string, KeyState>>;
  /** Zapis klucza w sejfie systemowym; `null` usuwa. Odrzuca, gdy sejfu nie ma. */
  chatSetKey(providerId: string, key: string | null): Promise<void>;
  chatList(): Promise<ChatMeta[]>;
  chatLoad(id: string): Promise<Chat | null>;
  chatSave(chat: Chat): Promise<void>;
  chatDelete(id: string): Promise<void>;
  /** Link z odpowiedzi w przeglądarce systemowej (tylko http/https). */
  openExternal(url: string): Promise<void>;
  /** Odpowiedź modelu strumieniem; ostatnie zdarzenie to `done` albo `error`. Zwraca Stop. */
  chatSend(req: ChatRequest, onEvent: (e: ChatEvent) => void): () => void;
  /** Zakładka Bot (M5). Lista tworzy Kreatora przy pierwszym odczycie. */
  botList(): Promise<{ bots: BotDef[]; errors: string[] }>;
  /** Nowy bot; zajęte id = odrzucenie (wolne id: `botId`). */
  botCreate(bot: BotDef): Promise<BotDef>;
  /** Zmiana bota; `builtin` i `created` zostają z dysku. */
  botSave(bot: BotDef): Promise<BotDef>;
  /** Do kosza (`bots-trash/`); Kreatora nie da się usunąć. */
  botDelete(id: string): Promise<void>;
  botMemory(id: string): Promise<Record<BotMemoryTarget, string>>;
  /** Ponad limit znaków = odrzucenie. */
  botMemorySave(id: string, target: BotMemoryTarget, text: string): Promise<void>;
  botSkills(id: string): Promise<BotSkillMeta[]>;
  /** Treść `SKILL.md`; `null` = nie ma. */
  botSkill(id: string, name: string): Promise<string | null>;
  /** Zapis `SKILL.md`; zwraca nazwę z frontmattera. */
  botSkillSave(id: string, md: string): Promise<string>;
  botSkillDelete(id: string, name: string): Promise<void>;
  botRoutines(id: string): Promise<{ routines: Routine[]; errors: string[] }>;
  botRoutinesSave(id: string, routines: Routine[]): Promise<void>;
  /** Rozmowy (`chats`) albo przebiegi z harmonogramu (`runs`). */
  botChatList(id: string, kind: BotChatKind): Promise<ChatMeta[]>;
  botChatLoad(id: string, kind: BotChatKind, chatId: string): Promise<BotChat | null>;
  /** Katalog z `chat.bot`, rodzaj z `chat.routine`. */
  botChatSave(chat: BotChat): Promise<void>;
  botChatDelete(id: string, kind: BotChatKind, chatId: string): Promise<void>;
  /** Odpowiedź bota: `chat` z ostatnim pytaniem, `req` jak w Czacie (dostawca, model, sesja CLI,
   *  `prompt`); prompt systemowy i narzędzia dokłada proces główny. Zwraca Stop. */
  botSend(chat: BotChat, req: ChatRequest, onEvent: (e: ChatEvent) => void): () => void;
  /** Czekające prośby o zgodę (po przeładowaniu strony). */
  botApprovals(): Promise<ApprovalRequest[]>;
  botApprove(id: string, decision: ApprovalDecision): Promise<void>;
  /** Nowa prośba o zgodę albo rozstrzygnięta; zwraca wyrejestrowanie. */
  onBotApproval(cb: (e: BotApprovalChange) => void): () => void;
  /** Dyktowanie (mikrofon w panelu): silniki transkrypcji z `stt.json`. Błędy pliku w `errors`. */
  sttConfig(): Promise<{ config: SttConfig; errors: string[] }>;
  sttSaveConfig(config: SttConfig): Promise<void>;
  /** Klucz silnika (sejf systemowy / zmienna środowiskowa) po id silnika. */
  sttKeyStatus(providers: SttProvider[]): Promise<Record<string, KeyState>>;
  /** `null` usuwa klucz; odrzuca, gdy sejfu nie ma. */
  sttSetKey(providerId: string, key: string | null): Promise<void>;
  /** Nagranie → tekst z wybranego silnika; odrzuca z powodem po polsku. */
  sttTranscribe(audio: Uint8Array, mime: string): Promise<string>;
  /** Własny pasek tytułu; brak = podgląd w przeglądarce, bez okna. */
  window?: WindowControls;
}

export type BotMemoryTarget = "memory" | "user";
export type BotApprovalChange = { type: "request"; req: ApprovalRequest } | { type: "resolved"; id: string; decision: ApprovalDecision };
export type BotChatKind = "chats" | "runs";
export type BotSkillMeta = { name: string; description: string; updated: number; error?: string };

export const inElectron = typeof window !== "undefined" && "agentsElectron" in window;

/** In the browser (`pnpm dev`) the UI runs against the mock, so it is reviewable without a window. */
export const backend: Backend = inElectron ? electronBackend : mockBackend;
