import { DEFAULT_AGENTS, parseAgents } from "./agents";
import type { Backend, ExitInfo, ResizeEdge, SpawnSpec, WindowControls } from "./backend";
import type { SessionContext } from "./context";
import type { ClaudeLimits } from "./limits";
import type { Handoff } from "./handoff";
import { buildChatConfig, parseChat, type ChatEvent, type ChatMeta, type ChatRequest } from "./chat";

/** Most wystawiony przez `electron/src/preload.ts`. */
type ElectronBridge = {
  invoke<T>(name: string, ...args: unknown[]): Promise<T>;
  spawnPty(spec: SpawnSpec, onData: (bytes: Uint8Array) => void, onExit: (info: ExitInfo) => void): Promise<number>;
  onResized(cb: () => void): () => void;
  /** Bez odpowiedzi (kolejne wywołania w kolejności); do zdarzeń co klatkę. */
  send(name: string, ...args: unknown[]): void;
  chatSend(reqId: string, req: ChatRequest, onEvent: (e: ChatEvent) => void): void;
  /** Krawędzie, które proces główny umie przesunąć (Wayland: tylko te bez przesuwania okna). */
  edges: ResizeEdge[];
};

const bridge = () => (window as unknown as { agentsElectron: ElectronBridge }).agentsElectron;
/** Electron opakowuje błąd z procesu głównego w „Error invoking remote method 'x': Error: …”;
 *  UI pokazuje powód (np. streszczenia), więc zostaje sam komunikat, jak w wersji Tauri. */
export const remoteMessage = (e: unknown) =>
  String(e instanceof Error ? e.message : e).replace(/^Error invoking remote method '[^']*': (?:\w*Error: )?/, "");

const call = <T>(name: string, ...args: unknown[]) =>
  bridge()
    .invoke<T>(name, ...args)
    .catch((e: unknown) => {
      throw new Error(remoteMessage(e));
    });

const ignore = () => undefined;

const electronWindow: WindowControls = {
  setTitle: (title) => void call("win_set_title", title).catch(ignore),
  isMaximized: () => call<boolean>("win_is_maximized"),
  onResized: (cb) => bridge().onResized(cb),
  minimize: () => void call("win_minimize").catch(ignore),
  toggleMaximize: () => void call("win_toggle_maximize").catch(ignore),
  close: () => void call("win_close").catch(ignore),
  get edges() {
    return bridge().edges;
  },
  startResize(edge, e) {
    // Electron nie ma startResizeDragging: uchwyt łapie wskaźnik, proces główny liczy granice
    // od przesunięcia względem wciśnięcia (raz na klatkę).
    const el = e.target as HTMLElement;
    el.setPointerCapture(e.pointerId);
    const x0 = e.screenX;
    const y0 = e.screenY;
    bridge().send("win_resize_start");
    let frame = 0;
    let delta: [number, number] = [0, 0];
    const move = (m: PointerEvent) => {
      delta = [m.screenX - x0, m.screenY - y0];
      frame ||= requestAnimationFrame(() => {
        frame = 0;
        bridge().send("win_resize_move", edge, ...delta);
      });
    };
    const end = () => {
      cancelAnimationFrame(frame);
      bridge().send("win_resize_move", edge, ...delta);
      el.removeEventListener("pointermove", move);
      el.removeEventListener("lostpointercapture", end);
    };
    el.addEventListener("pointermove", move);
    el.addEventListener("lostpointercapture", end);
  },
};

/** Backend w procesie głównym Electrona (`electron/src/main.ts`), przez most z `preload.ts`. */
export const electronBackend: Backend = {
  async spawnPty(spec, onData, onExit) {
    const id = await bridge().spawnPty(spec, onData, onExit);
    const report = (e: unknown) => console.warn(`[pty ${id}]`, e);
    return {
      id,
      write: (text) => void call("pty_write", id, text).catch(report),
      resize: (cols, rows) => void call("pty_resize", id, cols, rows).catch(report),
      kill: () => void call("pty_kill", id).catch(report),
    };
  },

  async loadAgents() {
    try {
      return parseAgents(JSON.parse(await call<string>("agents_load")));
    } catch (e) {
      return { agents: DEFAULT_AGENTS, errors: [`agents.json: ${String(e)}`] };
    }
  },

  claudeSessionExists: (id) => call<boolean>("claude_session_exists", id),
  sessionContext: (kind, sessionId) => call<SessionContext | null>("session_context", kind, sessionId),
  sessionHandoff: (kind, sessionId) => call<Handoff | null>("session_handoff", kind, sessionId),
  claudeSummary: (command, system, input) => call<string>("claude_summary", command, system, input),
  piSummary: (command, system, input) => call<string>("pi_summary", command, system, input),
  claudeSettingsArg: () => call<string | null>("claude_settings_arg"),
  claudeLimits: () => call<ClaudeLimits | null>("claude_limits"),
  dirExists: (path) => call<boolean>("dir_exists", path),
  pickDir: () => call<string | null>("pick_dir"),
  homeDir: () => call<string>("home_dir"),

  loadWorkspace: () => call<string | null>("workspace_load"),
  saveWorkspace: (json) => call<void>("workspace_save", json),
  backupWorkspace: (date) => call<void>("workspace_backup", date),

  copyText: (text) => call<void>("copy_text", text),
  async pasteText() {
    const text = await call<string>("paste_text");
    return text === "" ? null : text;
  },

  notify: (title, body) => call<void>("notify", title, body),

  async chatConfig() {
    const raw = await call<{ chat: string; pi: string | null }>("chat_config");
    return buildChatConfig(raw.chat, raw.pi);
  },
  openExternal: (url) => call<void>("open_external", url),
  chatModels: (p) => call<string[]>("chat_models", p),
  chatList: () => call<ChatMeta[]>("chat_list"),
  async chatLoad(id) {
    const text = await call<string | null>("chat_load", id);
    return text === null ? null : parseChat(text);
  },
  chatSave: (chat) => call<void>("chat_save", JSON.stringify(chat)),
  chatDelete: (id) => call<void>("chat_delete", id),
  chatSend(req, onEvent) {
    const reqId = crypto.randomUUID();
    bridge().chatSend(reqId, req, (e) => onEvent(e.type === "error" ? { ...e, message: remoteMessage(e.message) } : e));
    return () => void call("chat_abort", reqId).catch(ignore);
  },
  window: electronWindow,
};
