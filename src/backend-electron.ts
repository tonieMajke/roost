import { NO_ACCOUNTS, parseAccounts } from "./accounts";
import { DEFAULT_AGENTS, parseAgents } from "./agents";
import type { Backend, BotApprovalChange, BotSkillMeta, BotSkillSource, ExitInfo, KeyState, ResizeEdge, SpawnSpec, WindowControls } from "./backend";
import type { SessionContext } from "./context";
import type { ClaudeLimits } from "./limits";
import type { Handoff } from "./handoff";
import { buildChatConfig, parseChat, type ChatEvent, type ChatMeta, type ChatRequest } from "./chat";
import { parseSttConfig, sttConfigJson, sttKeyId } from "./stt";
import { parseBotChat, parseRoutines, serializeBot, type ApprovalRequest, type BotDef } from "./bot";

/** Most wystawiony przez `electron/src/preload.ts`. */
type ElectronBridge = {
  invoke<T>(name: string, ...args: unknown[]): Promise<T>;
  spawnPty(spec: SpawnSpec, onData: (bytes: Uint8Array) => void, onExit: (info: ExitInfo) => void): Promise<number>;
  onResized(cb: () => void): () => void;
  /** Bez odpowiedzi (kolejne wywołania w kolejności); do zdarzeń co klatkę. */
  send(name: string, ...args: unknown[]): void;
  chatSend(reqId: string, req: ChatRequest, onEvent: (e: ChatEvent) => void): void;
  botSend(reqId: string, chatJson: string, req: ChatRequest, onEvent: (e: ChatEvent) => void): void;
  onBotApproval(cb: (e: BotApprovalChange) => void): () => void;
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

  async loadAccounts() {
    try {
      const raw = await call<string | null>("accounts_load");
      return parseAccounts(raw === null ? {} : JSON.parse(raw));
    } catch (e) {
      return { value: NO_ACCOUNTS, errors: [`accounts.json: ${String(e)}`] };
    }
  },
  saveAccounts: (value) => call<void>("accounts_save", JSON.stringify(value, null, 2)),

  claudeSessionExists: (id, dir) => call<boolean>("claude_session_exists", id, dir),
  sessionContext: (kind, sessionId, dir) => call<SessionContext | null>("session_context", kind, sessionId, dir),
  sessionHandoff: (kind, sessionId, dir) => call<Handoff | null>("session_handoff", kind, sessionId, dir),
  claudeSummary: (command, system, input) => call<string>("claude_summary", command, system, input),
  piSummary: (command, system, input) => call<string>("pi_summary", command, system, input),
  claudeSettingsArg: (account) => call<string | null>("claude_settings_arg", account),
  claudeLimits: (accountId) => call<ClaudeLimits | null>("claude_limits", accountId),
  dirExists: (path) => call<boolean>("dir_exists", path),
  pickDir: () => call<string | null>("pick_dir"),
  pickImage: () => call<string | null>("pick_image"),
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
  chatSaveConfig: (json) => call<void>("chat_config_save", json),
  chatKeyStatus: (ps) => call<Record<string, KeyState>>("chat_key_status", ps),
  chatSetKey: (id, key) => call<void>("chat_set_key", id, key),
  async sttConfig() {
    return parseSttConfig(await call<string | null>("stt_config"));
  },
  sttSaveConfig: (config) => call<void>("stt_config_save", sttConfigJson(config)),
  async sttKeyStatus(ps) {
    const raw = await call<Record<string, KeyState>>("stt_key_status", ps);
    return Object.fromEntries(ps.map((p) => [p.id, raw[sttKeyId(p.id)] ?? null]));
  },
  sttSetKey: (id, key) => call<void>("stt_set_key", id, key),
  sttTranscribe: (audio, mime) => call<string>("stt_transcribe", audio, mime),
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
  botList: () => call<{ bots: BotDef[]; errors: string[] }>("bot_list"),
  botCreate: (bot) => call<BotDef>("bot_create", serializeBot(bot)),
  botSave: (bot) => call<BotDef>("bot_save", serializeBot(bot)),
  botDelete: (id) => call<void>("bot_delete", id),
  botMemory: (id) => call<{ memory: string; user: string }>("bot_memory", id),
  botMemorySave: (id, target, text) => call<void>("bot_memory_save", id, target, text),
  botSkills: (id) => call<BotSkillMeta[]>("bot_skills", id),
  botSkill: (id, name) => call<string | null>("bot_skill", id, name),
  botSkillSave: (id, md) => call<string>("bot_skill_save", id, md),
  botSkillDelete: (id, name) => call<void>("bot_skill_delete", id, name),
  botSkillSources: () => call<BotSkillSource[]>("bot_skill_sources"),
  botSkillImport: (id, name) => call<string>("bot_skill_import", id, name),
  botAvatarImport: (id, file) => call<string>("bot_avatar_import", id, file),
  botAvatar: (id, name) => call<string | null>("bot_avatar", id, name),
  async botRoutines(id) {
    return parseRoutines(JSON.parse(await call<string>("bot_routines", id)));
  },
  botRoutinesSave: (id, routines) => call<void>("bot_routines_save", id, JSON.stringify({ routines }, null, 2)),
  botChatList: (id, kind) => call<ChatMeta[]>("bot_chat_list", id, kind),
  async botChatLoad(id, kind, chatId) {
    const text = await call<string | null>("bot_chat_load", id, kind, chatId);
    return text === null ? null : parseBotChat(text);
  },
  botChatSave: (chat) => call<void>("bot_chat_save", JSON.stringify(chat)),
  botChatDelete: (id, kind, chatId) => call<void>("bot_chat_delete", id, kind, chatId),
  botSend(chat, req, onEvent) {
    const reqId = crypto.randomUUID();
    bridge().botSend(reqId, JSON.stringify(chat), req, (e) => onEvent(e.type === "error" ? { ...e, message: remoteMessage(e.message) } : e));
    return () => void call("bot_abort", reqId).catch(ignore);
  },
  botApprovals: () => call<ApprovalRequest[]>("bot_approvals"),
  botApprove: (id, decision) => call<void>("bot_approve", id, decision).then(ignore),
  onBotApproval: (cb) => bridge().onBotApproval(cb),
  window: electronWindow,
};
