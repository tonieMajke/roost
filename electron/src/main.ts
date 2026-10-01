//! Proces główny: okno z frontendem z `src/` i backend dla `src/backend-electron.ts` przez IPC.

import path from "node:path";
import { app, BrowserWindow, clipboard, dialog, ipcMain } from "electron";
import * as config from "./config";
import { sessionContext } from "./context";
import { sessionHandoff } from "./handoff";
import { claudeLimits, claudeSettingsArg } from "./limits";
import { notify } from "./notify";
import { Ptys, type SpawnSpec } from "./pty";
import { resizedBounds, usesWayland } from "./window";
import { claudeSummary, piSummary } from "./summary";

const ptys = new Ptys();
let win: BrowserWindow | null = null;

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
handle("claude_session_exists", (id: string) => config.claudeSessionExists(id));
handle("dir_exists", (p: string) => config.dirExists(p));
handle("home_dir", () => app.getPath("home"));
handle("workspace_load", () => config.workspaceLoad());
handle("workspace_save", (json: string) => config.workspaceSave(json));
handle("workspace_backup", (date: string) => config.workspaceBackup(date));
handle("session_context", (kind: string, id: string) => sessionContext(kind, id));
handle("session_handoff", (kind: string, id: string) => sessionHandoff(kind, id));
handle("claude_summary", (command: string, system: string, input: string) => claudeSummary(command, system, input));
handle("pi_summary", (command: string, system: string, input: string) => piSummary(command, system, input));
handle("claude_settings_arg", () =>
  claudeSettingsArg(process.execPath, path.join(__dirname, "statusline.cjs"), config.configDir()),
);
handle("claude_limits", () => claudeLimits(config.configDir()));
handle("notify", (title: string, body: string) => notify(title, body));
handle("copy_text", (text: string) => clipboard.writeText(text));
handle("paste_text", () => clipboard.readText());
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
  // Przeładowana strona (Ctrl+R, przeładowanie Vite) nie posprzątała po sobie: bez tego jej agenci
  // żyliby niewidoczni obok kopii tych samych rozmów w nowej stronie.
  win.webContents.on("did-start-navigation", (details) => {
    if (details.isMainFrame && !details.isSameDocument) ptys.killAllAsync();
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
app.on("will-quit", () => ptys.killAll());
