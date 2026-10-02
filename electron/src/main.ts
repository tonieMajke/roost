//! Proces główny: okno z frontendem z `src/` i backend dla `src/backend-electron.ts` przez IPC.

import { t } from "./i18n";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { app, BrowserWindow, clipboard, dialog, ipcMain, Notification, powerMonitor, safeStorage, shell } from "electron";
import * as config from "./config";
import * as scratchpad from "./scratchpad";
import { sessionContext } from "./context";
import { sessionHandoff } from "./handoff";
import * as git from "./git";
import { commandsAvailable } from "./commands";
import { claudeLimits, claudeSettingsArg } from "./limits";
import { notify as notifySend } from "./notify";
import { isLinux, isWindows } from "./platform";
import { getMainLang, resolveMainLang, setMainLang } from "./i18n";
import * as sandboxNotice from "./sandbox-notice";
import { openFile, resolveFiles } from "./open-path";
import { Ptys, type SpawnSpec } from "./pty";
import { resizedBounds, usesWayland } from "./window";
import { allowNavigation, buildCsp, isTrustedSender, allowPermission, PickedFiles, shouldApplyCsp, validateArgs, validateSpawnSpec, type ArgSpec } from "./security";
import { claudeSummary, piSummary } from "./summary";
import { ChatStore } from "./chat/store";
import { UsageLedger } from "./usage-store";
import { chatLogExcludes, logRoots, UsageScanner } from "./usage-logs";
import { parseAccounts, type AccountDef } from "../../src/accounts";
import { mergeRows, type UsageStats } from "../../src/usage";
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
import { ensureFreeToken, freeGpuForRouter, freetokenInstance, isRouter } from "./chat/freetoken";
import { isSkillName, parseBotChat, runNotice, type ApprovalDecision } from "../../src/bot";
import { buildChatConfig, isCli, type ChatEvent, type ChatRequest, type ProviderDef } from "../../src/chat";

// Wewnętrzna nazwa „Agents” zostaje: od niej zależą userData i wpis w sejfie systemowym, w którym leżą
// klucze API (safeStorage). Zmiana nazwy po cichu unieważniłaby zapisane klucze. Widoczna nazwa to Roost.
app.setName("Agents");
app.setPath("userData", path.join(app.getPath("appData"), "Agents"));
// Windows pokazuje powiadomienia tylko aplikacji z AppUserModelID (ten sam co `appId` instalatora).
if (isWindows) app.setAppUserModelId("dev.majke.roost");

/** Powiadomienie na pulpicie: na Linuksie `notify-send` (działa z akcją kliknięcia w KDE/GNOME/dunst),
 *  gdzie indziej `Notification` z Electrona. */
function notify(title: string, body: string, onClick?: () => void): void {
  if (isLinux) return notifySend(title, body, onClick);
  const n = new Notification({ title, body });
  // Bez referencji obiekt może zniknąć przed kliknięciem (a z nim obsługa `click`).
  shownNotifications.add(n);
  n.on("close", () => shownNotifications.delete(n));
  n.on("click", () => {
    shownNotifications.delete(n);
    onClick?.();
  });
  n.show();
}
const shownNotifications = new Set<Notification>();

// Jedna kopia na katalog konfiguracji: druga podwoiłaby harmonogram bota i nadpisywała workspace.json.
// Z własnym `ROOST_CONFIG_DIR`/`AGENTS_CONFIG_DIR` druga kopia jest zamierzona.
const ownConfig = Boolean(process.env.ROOST_CONFIG_DIR || process.env.AGENTS_CONFIG_DIR);
if (!ownConfig && !app.requestSingleInstanceLock()) {
  process.exit(0); // od razu: bez migracji, sklepów i harmonogramu w drugiej kopii
}
app.on("second-instance", () => {
  // `win` jest zadeklarowane niżej; handler odpala się dopiero po starcie.
  if (!win) return;
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
});

// Pierwszy start po zmianie nazwy: konfiguracja ze starego katalogu `dev.majke.agents`. Nie przy
// własnym `ROOST_CONFIG_DIR`/`AGENTS_CONFIG_DIR` (druga kopia ma zostać pusta).
if (!ownConfig) {
  try {
    config.migrateLegacyConfig();
  } catch (e) {
    console.error("config migration failed:", e);
  }
}

// Katalog konfiguracji 0700, pliki z sekretami 0600 – przy każdym starcie, nie tylko po migracji.
try {
  config.ensureConfigPerms();
} catch (e) {
  console.error("config permissions:", e);
}

// Przed `ready`: wybór sejfu kluczy API (wyłączony KWallet → Secret Service).
const store = isLinux ? passwordStore(readOrNull(path.join(app.getPath("home"), ".config", "kwalletrc")), process.env) : null;
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
const ledger = new UsageLedger(config.configDir());
const usageScanner = new UsageScanner(
  config.configDir(),
  () => {
    let accounts: AccountDef[] = [];
    try {
      const text = config.accountsLoad();
      if (text) accounts = parseAccounts(JSON.parse(text)).value.accounts;
    } catch {
      // zepsute accounts.json: tylko konta domyślne
    }
    return logRoots(accounts);
  },
  // Czat i Boty przez claude/codex też zostawiają logi sesji, ale liczy je dziennik (bez podwójnego liczenia).
  chatLogExcludes(config.configDir(), config.legacyConfigDir()),
);
const chat = defaultChatService(
  path.join(config.configDir(), "chat-cwd"),
  path.join(config.configDir(), "pi-agent"),
  (p) => keys.get(p.id, p.keyEnv),
  (r) => ledger.record({ ts: Date.now(), source: "chat", ...r }),
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
  onUsage: ({ bot, ...r }) => ledger.record({ ts: Date.now(), source: "bot", ref: bot, ...r }),
  beforeOpenAI: async (req, signal, emit) => {
    // FreeToken i router to usługi systemd z nvidia-smi: tylko Linux.
    const ft = isLinux ? freetokenInstance(req.provider.baseUrl, req.model) : null;
    const status = (text: string) => emit({ type: "thinking", text: `${text}\n` });
    if (ft) await ensureFreeToken(req.model, ft, signal, status);
    else if (isLinux && isRouter(req.provider.baseUrl)) await freeGpuForRouter(signal, status);
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

/** Adres naszej strony (dist-web albo dev serwer); do nawigacji okna i do sprawdzania nadawcy IPC. */
const appFile = path.join(__dirname, "..", "dist-web", "index.html");
// Dev serwer i DevTools tylko poza spakowaną aplikacją: w AppImage zmienna środowiskowa nie wyłącza CSP.
const devUrl = app.isPackaged ? undefined : process.env.AGENTS_DEV_URL;
const appUrl = { dev: devUrl, file: pathToFileURL(appFile).href };

/** Każde żądanie IPC musi przyjść z ramki z naszą stroną; obca ramka (iframe, nawigacja) nie dostaje nic. */
function assertTrusted(event: Electron.IpcMainInvokeEvent | Electron.IpcMainEvent, name: string): void {
  const url = event.senderFrame?.url;
  if (!isTrustedSender(url, appUrl)) throw new Error(`${name}: żądanie z niezaufanej ramki`);
}
/** `ipcMain.handle` z kontrolą nadawcy. */
function secure(name: string, fn: (event: Electron.IpcMainInvokeEvent, ...args: unknown[]) => unknown) {
  ipcMain.handle(name, (event, ...args) => {
    assertTrusted(event, name);
    return fn(event, ...args);
  });
}
/** `ipcMain.on` z kontrolą nadawcy: obca ramka jest po cichu ignorowana. */
function secureOn(name: string, fn: (event: Electron.IpcMainEvent, ...args: unknown[]) => void) {
  ipcMain.on(name, (event, ...args) => {
    if (!isTrustedSender(event.senderFrame?.url, appUrl)) return;
    fn(event, ...args);
  });
}

const DIFF_MODES = ["staged", "unstaged", "untracked"] as const;
const ID = "str" as const;
/** Typy argumentów każdego handlera; brak wpisu = brak argumentów. Błędny typ odrzuca `handle` zanim dotknie dysku, procesu czy shella. */
const ARGS: Record<string, readonly ArgSpec[]> = {
  pty_write: ["int", "str"],
  pty_resize: ["int", "int", "int"],
  pty_kill: ["int"],
  accounts_save: ["str"],
  claude_session_exists: [ID, "path?"],
  dir_exists: ["path"],
  commands_available: ["strs"],
  git_status: ["path"],
  git_files: ["path"],
  git_diff: ["path", "path", DIFF_MODES],
  git_stage: ["path", "paths"],
  git_unstage: ["path", "paths"],
  git_discard: ["path", "paths", "paths"],
  git_commit: ["path", "str"],
  git_sync: ["path", ["pull", "push"]],
  set_language: ["str"],
  workspace_save: ["str"],
  workspace_backup: ["str"],
  scratchpad_load: [ID],
  scratchpad_save: [ID, "str"],
  session_context: [ID, ID, "path?"],
  session_handoff: [ID, ID, "path?"],
  claude_summary: ["str", "str", "str"],
  pi_summary: ["str", "str", "str"],
  claude_settings_arg: ["obj?"],
  usage_stats: ["bool?"],
  claude_limits: ["str?"],
  notify: ["str", "str"],
  copy_text: ["str"],
  open_external: ["str"],
  resolve_files: ["path", "paths"],
  open_file: ["path", "int?", "int?"],
  chat_models: ["obj"],
  chat_config_save: ["str"],
  chat_key_status: ["objs"],
  chat_set_key: [ID, "str?"],
  chat_load: [ID],
  chat_save: ["str"],
  chat_delete: [ID],
  chat_abort: [ID],
  chat_send: [ID, "obj"],
  chat_tool_result: [ID, "bool", "str"],
  stt_config_save: ["str"],
  stt_key_status: ["objs"],
  stt_set_key: [ID, "str?"],
  stt_transcribe: ["bytes", "str"],
  tts_config_save: ["str"],
  tts_key_status: ["objs"],
  tts_set_key: [ID, "str?"],
  voice_config_save: ["str"],
  voice_speak: [ID, "str"],
  voice_cancel: [ID],
  bot_create: ["str"],
  bot_save: ["str"],
  bot_delete: [ID],
  bot_memory: [ID],
  bot_memory_save: [ID, ["memory", "user"], "str"],
  bot_skills: [ID],
  bot_skill: [ID, ID],
  bot_skill_save: [ID, "str"],
  bot_skill_delete: [ID, ID],
  bot_routines: [ID],
  bot_routines_save: [ID, "str"],
  bot_chat_list: [ID, ["chats", "runs"]],
  bot_chat_load: [ID, ["chats", "runs"], ID],
  bot_chat_save: ["str"],
  bot_run_now: [ID, ID],
  bot_approve: [ID, ["once", "chat", "deny"]],
  bot_skill_import: [ID, ID],
  bot_avatar_import: [ID, "path"],
  bot_avatar: [ID, ID],
  bot_abort: [ID],
  bot_send: [ID, "str", "obj"],
  bot_chat_delete: [ID, ["chats", "runs"], ID],
  win_set_title: ["str"],
  win_resize_move: ["str", "int", "int"],
};

/** Każde wywołanie z `backend-electron.ts` to `invoke(name, ...args)`; błąd wraca jako odrzucenie. */
function handle(name: string, fn: (...args: never[]) => unknown) {
  secure(name, (_event, ...args) => {
    validateArgs(name, args, ARGS[name] ?? []);
    return fn(...(args as never[]));
  });
}

secure("pty_spawn", (event, rawSpec) => {
  validateArgs("pty_spawn", [rawSpec], ["obj"]);
  validateSpawnSpec(rawSpec);
  const spec = rawSpec as SpawnSpec;
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
handle("commands_available", (commands: string[]) => commandsAvailable(commands));
handle("git_status", (cwd: string) => git.gitStatus(cwd));
handle("git_files", (cwd: string) => git.gitFiles(cwd));
handle("git_diff", (cwd: string, p: string, mode: git.DiffMode) => git.gitDiff(cwd, p, mode));
handle("git_stage", (cwd: string, paths: string[]) => git.gitStage(cwd, paths));
handle("git_unstage", (cwd: string, paths: string[]) => git.gitUnstage(cwd, paths));
handle("git_discard", (cwd: string, tracked: string[], untracked: string[]) => git.gitDiscard(cwd, tracked, untracked));
handle("git_commit", (cwd: string, message: string) => git.gitCommit(cwd, message));
handle("git_sync", (cwd: string, op: "pull" | "push") => git.gitSync(cwd, op === "pull" ? "pull" : "push"));
handle("set_language", (lang: string) => setMainLang(lang === "en" ? "en" : "pl"));
handle("home_dir", () => app.getPath("home"));
handle("workspace_load", () => config.workspaceLoad());
handle("workspace_save", (json: string) => config.workspaceSave(json));
handle("workspace_backup", (date: string) => config.workspaceBackup(date));
handle("scratchpad_load", (id: string) => scratchpad.scratchpadLoad(id));
handle("scratchpad_save", (id: string, text: string) => scratchpad.scratchpadSave(id, text));
handle("session_context", (kind: string, id: string, dir?: string) => sessionContext(kind, id, undefined, dir));
handle("session_handoff", (kind: string, id: string, dir?: string) => sessionHandoff(kind, id, undefined, dir));
handle("claude_summary", (command: string, system: string, input: string) => claudeSummary(command, system, input));
handle("pi_summary", (command: string, system: string, input: string) => piSummary(command, system, input));
handle("claude_settings_arg", (account?: { id: string; dir: string }) =>
  claudeSettingsArg(process.execPath, path.join(__dirname, "statusline.cjs"), config.configDir(), account),
);
handle("usage_stats", async (rescan: boolean): Promise<UsageStats> => {
  const scan = rescan ? await usageScanner.scan() : undefined;
  return {
    rows: mergeRows([...ledger.rows(), ...usageScanner.rows()]),
    ...(scan ? { scan: { files: scan.files, parsed: scan.parsed, skipped: scan.skipped } } : {}),
    at: Date.now(),
  };
});
handle("claude_limits", (accountId?: string) => claudeLimits(config.configDir(), accountId));
handle("notify", (title: string, body: string) => notify(title, body));
handle("copy_text", (text: string) => clipboard.writeText(text));
handle("paste_text", () => clipboard.readText());
// Linki z odpowiedzi modeli: tylko http(s), nic, co uruchomiłoby program albo plik.
handle("open_external", (url: string) => {
  if (!/^https?:\/\//i.test(url)) throw new Error(t("main.httpOnly"));
  return shell.openExternal(url);
});
// Ścieżki z terminala (Ctrl-klik): istnienie sprawdza proces główny, plik otwiera spawn z tablicą argumentów.
handle("resolve_files", (cwd: string, paths: string[]) => resolveFiles(cwd, paths));
handle("open_file", (file: string, line?: number, col?: number) => openFile(
    file,
    line,
    col,
    process.env,
    (f) => void shell.openPath(f),
    (f) => shell.showItemInFolder(f),
  ),
);
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
secure("chat_send", (event, ...a) => {
  validateArgs("chat_send", a, ARGS.chat_send);
  const [reqId, req] = a as [string, ChatRequest];
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
      return emit({ type: "error", message: t("main.bridge", { msg: e instanceof Error ? e.message : String(e) }) });
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
  if (!p) throw new Error(t("main.noStt"));
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
  if (!isSkillName(name)) throw new Error(t("main.badSkill", { name }));
  return bots.skillImport(id, path.join(claudeSkills(), name));
});
// Awatar tylko z pliku wskazanego w ostatnim oknie `pick_image` (jednorazowo); renderer nie może podać dowolnej ścieżki.
const pickedImages = new PickedFiles();
handle("bot_avatar_import", (id: string, file: string) => {
  if (!pickedImages.take(file)) throw new Error(t("main.avatarNotPicked"));
  return bots.avatarImport(id, file);
});
handle("bot_avatar", (id: string, name: string) => bots.avatar(id, name));
handle("bot_abort", (reqId: string) => botService.abort(reqId));
// Odpowiedź bota płynie zdarzeniami `bot_event` (reqId, ChatEvent), jak `chat_event`.
secure("bot_send", (event, ...a) => {
  validateArgs("bot_send", a, ARGS.bot_send);
  const [reqId, chatJson, req] = a as [string, string, ChatRequest];
  const sender = event.sender;
  const c = parseBotChat(chatJson);
  const emit = (e: unknown) => {
    if (!sender.isDestroyed()) sender.send("bot_event", reqId, e);
  };
  if (!c) return emit({ type: "error", message: t("main.badBotChat") });
  void botService.send(reqId, c, req, emit);
});
handle("bot_chat_delete", (id: string, kind: ChatKind, chatId: string) => bots.chats(id, kind).delete(chatId));
handle("pick_dir", async () => {
  const opts: Electron.OpenDialogOptions = { title: t("dialog.dir"), properties: ["openDirectory"] };
  const res = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts);
  return res.canceled ? null : (res.filePaths[0] ?? null);
});

handle("pick_image", async () => {
  const opts: Electron.OpenDialogOptions = {
    title: t("dialog.avatar"),
    properties: ["openFile"],
    filters: [{ name: t("dialog.images"), extensions: ["png", "jpg", "jpeg", "webp", "gif"] }],
  };
  const res = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts);
  const file = res.canceled ? null : (res.filePaths[0] ?? null);
  if (file) pickedImages.add(file);
  return file;
});

// Okno bez dekoracji systemowych (jak w wersji Tauri): pasek tytułu i krawędzie robi `TitleBar.tsx`.
const senderWindow = (event: Electron.IpcMainInvokeEvent) => BrowserWindow.fromWebContents(event.sender);
secure("win_set_title", (e, ...a) => {
  validateArgs("win_set_title", a, ARGS.win_set_title);
  return senderWindow(e)?.setTitle(a[0] as string);
});
secure("win_is_maximized", (e) => senderWindow(e)?.isMaximized() ?? false);
secure("win_minimize", (e) => senderWindow(e)?.minimize());
secure("win_toggle_maximize", (e) => {
  const w = senderWindow(e);
  if (w?.isMaximized()) w.unmaximize();
  else w?.maximize();
});
secure("win_close", (e) => senderWindow(e)?.close());

/** Granice okna w chwili wciśnięcia uchwytu; `win_resize_move` liczy od nich. */
let resizeFrom: Electron.Rectangle | null = null;
secureOn("win_resize_start", (e) => {
  resizeFrom = BrowserWindow.fromWebContents(e.sender)?.getBounds() ?? null;
});
secureOn("win_resize_move", (e, ...a) => {
  // Zły typ w zdarzeniu bez odpowiedzi: ignorujemy, nie rzucamy.
  try {
    validateArgs("win_resize_move", a, ARGS.win_resize_move);
  } catch {
    return;
  }
  const [edge, dx, dy] = a as [string, number, number];
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
    title: "Roost",
    frame: false,
    transparent: true, // rogi zaokrągla `.shell`
    backgroundColor: "#00000000",
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      sandbox: true, // preload używa tylko contextBridge/ipcRenderer/webUtils
      additionalArguments: usesWayland(process.env, app.commandLine.getSwitchValue("ozone-platform")) ? ["--aw-wayland"] : [],
    },
  });
  win.setMenu(null);
  // Link z odpowiedzi czatu nie otwiera nowego okna aplikacji: tylko przeglądarka systemowa.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) void shell.openExternal(url);
    return { action: "deny" };
  });
  // Strona nie wychodzi poza własny adres ani nie osadza <webview>.
  win.webContents.on("will-navigate", (e, url) => {
    if (!allowNavigation(url, appUrl)) e.preventDefault();
  });
  win.webContents.on("will-attach-webview", (e) => e.preventDefault());
  // Uprawnienia Chromium: domyślnie odmowa, mikrofon (tylko audio) i zapis schowka wyłącznie dla naszej strony.
  win.webContents.session.setPermissionRequestHandler((wc, permission, cb, details) => {
    const d = details as { requestingUrl?: string; mediaTypes?: string[] };
    cb(allowPermission(permission, d.requestingUrl ?? wc.getURL(), appUrl, d.mediaTypes));
  });
  win.webContents.session.setPermissionCheckHandler((wc, permission, _origin, details) => {
    const d = details as { requestingUrl?: string; mediaType?: string };
    // Sprawdzenie (np. etykiety mikrofonów w enumerateDevices) przychodzi z typem „unknown” albo bez typu;
    // samo nic nie nagrywa, więc liczy się jak audio. Kamera nadal nie.
    return allowPermission(permission, d.requestingUrl ?? wc?.getURL(), appUrl, [d.mediaType === "video" ? "video" : "audio"]);
  });
  // CSP z nagłówka (nie z <meta>, żeby nie psuć HMR Vite); tylko dla file://.
  win.webContents.session.webRequest.onHeadersReceived((details, cb) => {
    if (!shouldApplyCsp(details.url)) return cb({});
    cb({ responseHeaders: { ...details.responseHeaders, "Content-Security-Policy": [buildCsp()] } });
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
  if (devUrl) void win.loadURL(devUrl);
  else void win.loadFile(appFile);
  if (!app.isPackaged && process.env.AGENTS_DEVTOOLS) win.webContents.openDevTools({ mode: "detach" });
  const resized = () => win?.webContents.send("win_resized");
  win.on("resize", resized);
  win.on("maximize", resized);
  win.on("unmaximize", resized);
  win.on("closed", () => (win = null));
}

/** Język procesu głównego do czasu, aż strona zgłosi własny (`set_language`): `ui.lang` z workspace.json, "auto" = język systemu. */
function initialLang(): void {
  let pref: string | undefined;
  try {
    pref = (JSON.parse(config.workspaceLoad() ?? "null") as { ui?: { lang?: string } } | null)?.ui?.lang;
  } catch {
    // zepsuty workspace.json: język systemu
  }
  setMainLang(resolveMainLang(pref, app.getLocale()));
}

/** Jednorazowe ostrzeżenie, gdy AppRun uruchomił nas z `--no-sandbox` (sandbox-notice.ts). */
function warnIfNoSandbox(w: BrowserWindow): void {
  const dir = config.configDir();
  if (!sandboxNotice.shouldWarn(app.commandLine.hasSwitch("no-sandbox"), app.isPackaged, dir)) return;
  w.webContents.once("did-finish-load", () => {
    void dialog.showMessageBox(w, sandboxNotice.noticeOptions()).then(({ response, checkboxChecked }) => {
      if (checkboxChecked) {
        try {
          sandboxNotice.dismiss(dir);
        } catch (e) {
          console.error("no-sandbox-ok:", e);
        }
      }
      if (response === 0) void shell.openExternal(sandboxNotice.HOWTO_URL[getMainLang()]);
    });
  });
}

void app.whenReady().then(() => {
  initialLang();
  createWindow();
  if (win) warnIfNoSandbox(win);
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
