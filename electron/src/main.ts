//! Proces główny: okno z frontendem z `src/` i backend dla `src/backend-electron.ts` przez IPC.

import fs from "node:fs";
import path from "node:path";
import { app, BrowserWindow, clipboard, dialog, ipcMain, powerMonitor, safeStorage, shell } from "electron";
import * as config from "./config";
import { sessionContext } from "./context";
import { sessionHandoff } from "./handoff";
import { claudeLimits, claudeSettingsArg } from "./limits";
import { notify } from "./notify";
import { Ptys, type SpawnSpec } from "./pty";
import { resizedBounds, usesWayland } from "./window";
import { claudeSummary, piSummary } from "./summary";
import { ChatStore } from "./chat/store";
import { chatConfigLoad, chatConfigSave, defaultChatService } from "./chat/service";
import { WindowTools } from "./chat/window-tools";
import { KeyStore, passwordStore } from "./chat/keys";
import { sttConfigLoad, sttConfigSave, transcribe } from "./stt";
import { activeStt, parseSttConfig, sttKeyId, type SttProvider } from "../../src/stt";
import { TtsService, ttsConfigLoad, ttsConfigSave, voiceConfigLoad, voiceConfigSave } from "./voice/tts";
import { ttsKeyId, type TtsProvider } from "../../src/voice/voice";
import { BotStore, type ChatKind, type MemoryTarget } from "./bot/store";
import { ApprovalBroker } from "./bot/approvals";
import { ToolBridge } from "./bot/bridge";
import { BotService } from "./bot/service";
import { RUN_PREFIX, Scheduler, type RunInfo } from "./bot/scheduler";
import { ensureFreeToken, freetokenInstance } from "./chat/freetoken";
import { isSkillName, parseBotChat, runNotice, type ApprovalDecision } from "../../src/bot";
import { buildChatConfig, isCli, type ChatEvent, type ChatRequest, type ProviderDef } from "../../src/chat";

// Przed `ready`: wybór sejfu kluczy API (wyłączony KWallet → Secret Service).
const store = passwordStore(readOrNull(path.join(app.getPath("home"), ".config", "kwalletrc")), process.env);
if (store) app.commandLine.appendSwitch("password-store", store);

function readOrNull(file: string): string | null {
  try {
    return fs.readFileSync(file, "utf8");
  } catch {
    return null;
  }
}

const ptys = new Ptys();
const chats = new ChatStore(path.join(config.configDir(), "chats"));
const bots = new BotStore(path.join(config.configDir(), "bots"), path.join(config.configDir(), "bots-trash"));
// Sejf systemowy: „basic_text” (brak KWallet/libsecret) to prawie jawny tekst – wtedy nie zapisujemy.
const keys = new KeyStore(config.configDir(), {
  available: () => safeStorage.isEncryptionAvailable() && safeStorage.getSelectedStorageBackend() !== "basic_text",
  encrypt: (s) => safeStorage.encryptString(s),
  decrypt: (b) => safeStorage.decryptString(b),
});
const chat = defaultChatService(path.join(config.configDir(), "chat-cwd"), path.join(config.configDir(), "pi-agent"), (p) =>
  keys.get(p.id, p.keyEnv),
);
const tts = new TtsService(() => config.configDir(), (id, env) => keys.get(id, env));
let win: BrowserWindow | null = null;
// Prośby botów o zgodę idą do okna (`bot_approval`); decyzja wraca przez `bot_approve`.
const approvals = new ApprovalBroker((e) => {
  scheduler.approvalChanged(e);
  if (win && !win.isDestroyed()) win.webContents.send("bot_approval", e);
});

// Most MCP dla claude/codex w trybie bota i w rozmowie głosowej: gniazdo powstaje przy pierwszej takiej rozmowie.
let bridge: Promise<ToolBridge> | null = null;
const windowTools = new WindowTools();
const botService = new BotService({
  store: bots,
  broker: approvals,
  bridge: () => (bridge ??= ToolBridge.start()),
  execPath: process.execPath,
  mcpScript: path.join(__dirname, "mcp-server.cjs"),
  key: (p) => keys.get(p.id, p.keyEnv),
  beforeOpenAI: async (req, signal, emit) => {
    const ft = freetokenInstance(req.provider.baseUrl, req.model);
    if (ft) await ensureFreeToken(req.model, ft, signal, (text) => emit({ type: "thinking", text: `${text}\n` }));
  },
});

// Harmonogram botów: działa przy otwartej aplikacji, przebiegi w `runs/`. Zmiana stanu idzie do okna
// (`bot_run`) i do powiadomienia.
const scheduler = new Scheduler({
  store: bots,
  service: botService,
  providers: () => {
    const raw = chatConfigLoad(config.configDir());
    return buildChatConfig(raw.chat, raw.pi).providers;
  },
  onRun: (r) => {
    if (win && !win.isDestroyed()) win.webContents.send("bot_run", r);
    runNotify(r);
  },
});

/** Po przebiegu, gdy okno nie ma fokusu; prośba o zgodę zawsze (nikt inny jej nie rozstrzygnie).
 *  Kliknięcie otwiera przebieg w zakładce Bot. */
function runNotify(r: RunInfo) {
  if (r.state === "running") return;
  if (r.state !== "waiting_approval" && win && !win.isDestroyed() && win.isFocused()) return;
  const bot = bots.load(r.bot);
  const run = bot ? parseBotChat(bots.chats(r.bot, "runs").load(r.chat) ?? "") : null;
  const n = bot && run ? runNotice(bot.name, run) : null;
  if (!n) return;
  notify(n.title, n.body, () => {
    if (!win || win.isDestroyed()) return;
    if (win.isMinimized()) win.restore();
    win.show();
    win.focus();
    win.webContents.send("bot_open_run", { bot: r.bot, chat: r.chat });
  });
}

/** Każde wywołanie z `backend-electron.ts` to `invoke(name, ...args)`; błąd wraca jako odrzucenie. */
function handle(name: string, fn: (...args: never[]) => unknown) {
  ipcMain.handle(name, (_event, ...args) => fn(...(args as never[])));
}

ipcMain.handle("pty_spawn", (event, spec: SpawnSpec) => {
  const sender = event.sender;
  const send = (channel: string, ...args: unknown[]) => {
    if (!sender.isDestroyed()) sender.send(channel, ...args);
  };
  const id: number = ptys.spawn(
    spec,
    (chunk) => send("pty_data", id, chunk),
    (info) => send("pty_exit", id, info),
  );
  return id;
});
handle("pty_write", (id: number, data: string) => ptys.write(id, data));
handle("pty_resize", (id: number, cols: number, rows: number) => ptys.resize(id, cols, rows));
handle("pty_kill", (id: number) => ptys.kill(id));

handle("agents_load", () => config.agentsLoad());
handle("accounts_load", () => config.accountsLoad());
handle("accounts_save", (json: string) => config.accountsSave(json));
handle("claude_session_exists", (id: string, dir?: string) => config.claudeSessionExists(id, dir));
handle("dir_exists", (p: string) => config.dirExists(p));
handle("home_dir", () => app.getPath("home"));
handle("workspace_load", () => config.workspaceLoad());
handle("workspace_save", (json: string) => config.workspaceSave(json));
handle("workspace_backup", (date: string) => config.workspaceBackup(date));
handle("session_context", (kind: string, id: string, dir?: string) => sessionContext(kind, id, undefined, dir));
handle("session_handoff", (kind: string, id: string, dir?: string) => sessionHandoff(kind, id, undefined, dir));
handle("claude_summary", (command: string, system: string, input: string) => claudeSummary(command, system, input));
handle("pi_summary", (command: string, system: string, input: string) => piSummary(command, system, input));
handle("claude_settings_arg", (account?: { id: string; dir: string }) =>
  claudeSettingsArg(process.execPath, path.join(__dirname, "statusline.cjs"), config.configDir(), account),
);
handle("claude_limits", (accountId?: string) => claudeLimits(config.configDir(), accountId));
handle("notify", (title: string, body: string) => notify(title, body));
handle("copy_text", (text: string) => clipboard.writeText(text));
handle("paste_text", () => clipboard.readText());
// Linki z odpowiedzi modeli: tylko http(s), nic, co uruchomiłoby program albo plik.
handle("open_external", (url: string) => {
  if (!/^https?:\/\//i.test(url)) throw new Error("tylko adresy http(s)");
  return shell.openExternal(url);
});
handle("chat_config", () => chatConfigLoad(config.configDir()));
handle("chat_models", (p: ProviderDef) => chat.models(p));
handle("chat_config_save", (json: string) => chatConfigSave(config.configDir(), json));
handle("chat_key_status", (ps: ProviderDef[]) => keys.status(ps));
handle("chat_set_key", (id: string, key: string | null) => keys.set(id, key));
handle("chat_list", () => chats.list());
handle("chat_load", (id: string) => chats.load(id));
handle("chat_save", (json: string) => chats.save(json));
handle("chat_delete", (id: string) => chats.delete(id));
handle("chat_abort", (reqId: string) => chat.abort(reqId));
// Odpowiedź płynie zdarzeniami `chat_event` (reqId, ChatEvent); `invoke` wraca od razu.
ipcMain.handle("chat_send", (event, reqId: string, req: ChatRequest) => {
  const sender = event.sender;
  const emit = (e: ChatEvent) => {
    if (!sender.isDestroyed()) sender.send("chat_event", reqId, e);
  };
  if (!req.tools?.length || !isCli(req.provider)) return void chat.send(reqId, req, emit);
  // Rozmowa głosowa na claude/codex CLI: narzędzia okna przez serwer MCP `bot` (most z M5).
  void (async () => {
    let session: { env: Record<string, string>; dispose(): void };
    try {
      session = (await (bridge ??= ToolBridge.start())).register({
        tools: req.tools!,
        call: async (name, args) => ({ ...(await windowTools.call(reqId, emit, name, args)), approval: "auto" }),
      });
    } catch (e) {
      return emit({ type: "error", message: `most narzędzi: ${e instanceof Error ? e.message : String(e)}` });
    }
    try {
      const mcp = ToolBridge.serverSpec(process.execPath, path.join(__dirname, "mcp-server.cjs"), session.env);
      await chat.send(reqId, { ...req, tools: undefined, mcp }, emit);
    } finally {
      session.dispose();
      windowTools.end(reqId);
    }
  })();
});
handle("chat_tool_result", (id: string, ok: boolean, text: string) => void windowTools.resolve(id, ok, text));
// Dyktowanie: silnik i język z `stt.json`, klucz z sejfu; do strony wraca sam tekst.
handle("stt_config", () => sttConfigLoad(config.configDir()));
handle("stt_config_save", (json: string) => sttConfigSave(config.configDir(), json));
handle("stt_key_status", (ps: SttProvider[]) => keys.status(ps.map((p) => ({ id: sttKeyId(p.id), keyEnv: p.keyEnv }))));
handle("stt_set_key", (id: string, key: string | null) => keys.set(sttKeyId(id), key));
handle("stt_transcribe", (audio: Uint8Array, mime: string) => {
  const { config: cfg } = parseSttConfig(sttConfigLoad(config.configDir()));
  const p = activeStt(cfg);
  if (!p) throw new Error("nie wybrano silnika transkrypcji (Ustawienia głosu)");
  return transcribe(p, keys.get(sttKeyId(p.id), p.keyEnv), audio, mime, cfg.language);
});
// Rozmowa głosowa (eksperyment, `docs/plan-glos.md`): mózg i silnik mowy z `voice.json`/`tts.json`;
// `voice_speak` zwraca bajty audio jednego zdania, `voice_cancel` je przerywa, `voice_end` zamyka Pipera.
handle("tts_config", () => ttsConfigLoad(config.configDir()));
handle("tts_config_save", (json: string) => ttsConfigSave(config.configDir(), json));
handle("tts_key_status", (ps: TtsProvider[]) => keys.status(ps.map((p) => ({ id: ttsKeyId(p.id), keyEnv: p.keyEnv }))));
handle("tts_set_key", (id: string, key: string | null) => keys.set(ttsKeyId(id), key));
handle("voice_config", () => voiceConfigLoad(config.configDir()));
handle("voice_config_save", (json: string) => voiceConfigSave(config.configDir(), json));
handle("voice_speak", (reqId: string, text: string) => tts.speak(reqId, text));
handle("voice_cancel", (reqId: string) => tts.cancel(reqId));
handle("voice_end", () => tts.end());
// Zakładka Bot (M5): boty, pamięć, skille, harmonogram i rozmowy na dysku.
handle("bot_list", () => bots.list());
handle("bot_create", (json: string) => bots.create(json));
handle("bot_save", (json: string) => bots.save(json));
handle("bot_delete", (id: string) => bots.delete(id));
handle("bot_memory", (id: string) => bots.memory(id));
handle("bot_memory_save", (id: string, target: MemoryTarget, text: string) => bots.memorySave(id, target, text));
handle("bot_skills", (id: string) => bots.skills(id));
handle("bot_skill", (id: string, name: string) => bots.skill(id, name));
handle("bot_skill_save", (id: string, md: string) => bots.skillSave(id, md));
handle("bot_skill_delete", (id: string, name: string) => bots.skillDelete(id, name));
handle("bot_routines", (id: string) => bots.routines(id));
handle("bot_routines_save", (id: string, json: string) => bots.routinesSave(id, json));
handle("bot_chat_list", (id: string, kind: ChatKind) => bots.chats(id, kind).list());
handle("bot_chat_load", (id: string, kind: ChatKind, chatId: string) => bots.chats(id, kind).load(chatId));
handle("bot_chat_save", (json: string) => bots.chatSave(json));
handle("bot_approvals", () => approvals.list());
handle("bot_runs", () => scheduler.runs());
handle("bot_run_now", (id: string, routine: string) => scheduler.runNow(id, routine));
handle("bot_approve", (id: string, decision: ApprovalDecision) => approvals.decide(id, decision));
// Import skilli z claude: tylko odczyt `~/.claude/skills`, kopia do folderu bota.
const claudeSkills = () => path.join(app.getPath("home"), ".claude", "skills");
handle("bot_skill_sources", () => BotStore.skillSources(claudeSkills()));
handle("bot_skill_import", (id: string, name: string) => {
  if (!isSkillName(name)) throw new Error(`zła nazwa skilla: ${name}`);
  return bots.skillImport(id, path.join(claudeSkills(), name));
});
handle("bot_avatar_import", (id: string, file: string) => bots.avatarImport(id, file));
handle("bot_avatar", (id: string, name: string) => bots.avatar(id, name));
handle("bot_abort", (reqId: string) => botService.abort(reqId));
// Odpowiedź bota płynie zdarzeniami `bot_event` (reqId, ChatEvent), jak `chat_event`.
ipcMain.handle("bot_send", (event, reqId: string, chatJson: string, req: ChatRequest) => {
  const sender = event.sender;
  const c = parseBotChat(chatJson);
  const emit = (e: unknown) => {
    if (!sender.isDestroyed()) sender.send("bot_event", reqId, e);
  };
  if (!c) return emit({ type: "error", message: "zła rozmowa bota" });
  void botService.send(reqId, c, req, emit);
});
handle("bot_chat_delete", (id: string, kind: ChatKind, chatId: string) => bots.chats(id, kind).delete(chatId));
handle("pick_dir", async () => {
  const opts: Electron.OpenDialogOptions = { title: "Katalog projektu", properties: ["openDirectory"] };
  const res = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts);
  return res.canceled ? null : (res.filePaths[0] ?? null);
});

handle("pick_image", async () => {
  const opts: Electron.OpenDialogOptions = {
    title: "Obrazek awatara",
    properties: ["openFile"],
    filters: [{ name: "Obrazy", extensions: ["png", "jpg", "jpeg", "webp", "gif"] }],
  };
  const res = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts);
  return res.canceled ? null : (res.filePaths[0] ?? null);
});

// Okno bez dekoracji systemowych (jak w wersji Tauri): pasek tytułu i krawędzie robi `TitleBar.tsx`.
const senderWindow = (event: Electron.IpcMainInvokeEvent) => BrowserWindow.fromWebContents(event.sender);
ipcMain.handle("win_set_title", (e, title: string) => senderWindow(e)?.setTitle(title));
ipcMain.handle("win_is_maximized", (e) => senderWindow(e)?.isMaximized() ?? false);
ipcMain.handle("win_minimize", (e) => senderWindow(e)?.minimize());
ipcMain.handle("win_toggle_maximize", (e) => {
  const w = senderWindow(e);
  if (w?.isMaximized()) w.unmaximize();
  else w?.maximize();
});
ipcMain.handle("win_close", (e) => senderWindow(e)?.close());

/** Granice okna w chwili wciśnięcia uchwytu; `win_resize_move` liczy od nich. */
let resizeFrom: Electron.Rectangle | null = null;
ipcMain.on("win_resize_start", (e) => {
  resizeFrom = BrowserWindow.fromWebContents(e.sender)?.getBounds() ?? null;
});
ipcMain.on("win_resize_move", (e, edge: string, dx: number, dy: number) => {
  const w = BrowserWindow.fromWebContents(e.sender);
  if (!w || !resizeFrom) return;
  w.setBounds(resizedBounds(resizeFrom, edge, dx, dy, w.getMinimumSize()));
});

function createWindow() {
  win = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 640,
    minHeight: 400,
    title: "Agents",
    frame: false,
    transparent: true, // rogi zaokrągla `.shell`
    backgroundColor: "#00000000",
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      sandbox: false,
      additionalArguments: usesWayland(process.env, app.commandLine.getSwitchValue("ozone-platform")) ? ["--aw-wayland"] : [],
    },
  });
  win.setMenu(null);
  // Link z odpowiedzi czatu nie otwiera nowego okna aplikacji: tylko przeglądarka systemowa.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) void shell.openExternal(url);
    return { action: "deny" };
  });
  // Przeładowana strona (Ctrl+R, przeładowanie Vite) nie posprzątała po sobie: bez tego jej agenci
  // żyliby niewidoczni obok kopii tych samych rozmów w nowej stronie.
  win.webContents.on("did-start-navigation", (details) => {
    if (details.isMainFrame && !details.isSameDocument) {
      ptys.killAllAsync();
      chat.abortAll();
      // Przebiegi harmonogramu nie należą do strony: pracują dalej, ich prośby o zgodę czekają.
      botService.abortAll((id) => id.startsWith(RUN_PREFIX));
      approvals.denyAll((req) => scheduler.owns(req.chat));
      tts.end();
    }
  });
  const dev = process.env.AGENTS_DEV_URL;
  if (dev) void win.loadURL(dev);
  else void win.loadFile(path.join(__dirname, "..", "dist-web", "index.html"));
  if (process.env.AGENTS_DEVTOOLS) win.webContents.openDevTools({ mode: "detach" });
  const resized = () => win?.webContents.send("win_resized");
  win.on("resize", resized);
  win.on("maximize", resized);
  win.on("unmaximize", resized);
  win.on("closed", () => (win = null));
}

void app.whenReady().then(() => {
  createWindow();
  scheduler.start();
  // Po wybudzeniu od razu, nie po najbliższym tyknięciu.
  powerMonitor.on("resume", () => scheduler.tick());
});

// Zamknięte okno, Ctrl+C w terminalu: agenci nigdy nie zostają.
app.on("window-all-closed", () => app.quit());
app.on("will-quit", () => {
  scheduler.stop();
  ptys.killAll();
  chat.abortAll();
  botService.abortAll();
  approvals.denyAll();
  void bridge?.then((b) => b.close());
  tts.end();
});
