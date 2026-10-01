//! Proces główny: okno z frontendem z `src/` i backend dla `src/backend-electron.ts` przez IPC.

import fs from "node:fs";
import path from "node:path";
import { app, BrowserWindow, clipboard, dialog, ipcMain, safeStorage, shell } from "electron";
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
import { KeyStore, passwordStore } from "./chat/keys";
import { BotStore, type ChatKind, type MemoryTarget } from "./bot/store";
import { ApprovalBroker } from "./bot/approvals";
import type { ApprovalDecision } from "../../src/bot";
import type { ChatRequest, ProviderDef } from "../../src/chat";

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
let win: BrowserWindow | null = null;
// Prośby botów o zgodę idą do okna (`bot_approval`); decyzja wraca przez `bot_approve`.
const approvals = new ApprovalBroker((e) => {
  if (win && !win.isDestroyed()) win.webContents.send("bot_approval", e);
});

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
  void chat.send(reqId, req, (e) => {
    if (!sender.isDestroyed()) sender.send("chat_event", reqId, e);
  });
});
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
handle("bot_approve", (id: string, decision: ApprovalDecision) => approvals.decide(id, decision));
handle("bot_chat_delete", (id: string, kind: ChatKind, chatId: string) => bots.chats(id, kind).delete(chatId));
handle("pick_dir", async () => {
  const opts: Electron.OpenDialogOptions = { title: "Katalog projektu", properties: ["openDirectory"] };
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
      approvals.denyAll();
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

void app.whenReady().then(createWindow);

// Zamknięte okno, Ctrl+C w terminalu: agenci nigdy nie zostają.
app.on("window-all-closed", () => app.quit());
app.on("will-quit", () => {
  ptys.killAll();
  chat.abortAll();
  approvals.denyAll();
});
