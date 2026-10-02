//! Różnice między systemami w jednym miejscu: tylko tutaj sprawdzamy `process.platform`.
//! Funkcje przyjmują system i środowisko jako parametry (domyślnie bieżące), żeby testy
//! na Linuksie mogły sprawdzić też zachowanie na Windows i macOS.

import { spawn, spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

type Env = Record<string, string | undefined>;

export const isWindows = process.platform === "win32";
export const isMac = process.platform === "darwin";
export const isLinux = process.platform === "linux";

/** Katalog, w którym leży folder konfiguracji aplikacji. Linux bez zmian (`~/.config`, także gdy jest
 *  `XDG_CONFIG_HOME` – tak było od początku), macOS `~/Library/Application Support`, Windows `%APPDATA%`. */
export function configBase(platform: NodeJS.Platform = process.platform, env: Env = process.env, home = os.homedir()): string {
  if (platform === "win32") return env.APPDATA || path.win32.join(home, "AppData", "Roaming");
  if (platform === "darwin") return path.posix.join(home, "Library", "Application Support");
  return path.posix.join(home, ".config");
}

/** Program dla `$SHELL` (panel „Terminal”). Windows nie ma `SHELL`: PowerShell 5 jest w każdym Windows 10/11. */
export function defaultShell(platform: NodeJS.Platform = process.platform, env: Env = process.env): string {
  if (platform === "win32") return "powershell.exe";
  return env.SHELL || "/bin/sh";
}

/** Zmienna ze ścieżką szukania programów. Na Windows klucz bywa `Path`, a obiekt env w Node
 *  rozróżnia wielkość liter dopiero po skopiowaniu (`{...process.env}`). */
export function pathValue(env: Env, platform: NodeJS.Platform = process.platform): string {
  if (platform !== "win32") return env.PATH ?? "";
  const key = Object.keys(env).find((k) => k.toUpperCase() === "PATH");
  return (key && env[key]) || "";
}

function isFile(f: string): boolean {
  try {
    return fs.statSync(f).isFile();
  } catch {
    return false;
  }
}

function isExecutable(f: string): boolean {
  try {
    fs.accessSync(f, fs.constants.X_OK);
    return fs.statSync(f).isFile();
  } catch {
    return false;
  }
}

export type Lookup = { platform?: NodeJS.Platform; env?: Env; exists?: (file: string) => boolean };

/** Czy komenda jest ścieżką (a nie gołą nazwą do szukania w PATH). */
export function hasDir(command: string, platform: NodeJS.Platform = process.platform): boolean {
  return platform === "win32" ? /[\\/]/.test(command) : command.includes("/");
}

/**
 * Pełna ścieżka programu albo `null`. Goła nazwa jest szukana w PATH; na Windows z rozszerzeniami
 * z `PATHEXT` (npm instaluje `codex.cmd`, a `spawn("codex")` takiego pliku sam nie znajdzie).
 * Ścieżka jest sprawdzana wprost (na Windows też z dopisanym rozszerzeniem).
 */
export function resolveCommand(command: string, opts: Lookup = {}): string | null {
  const platform = opts.platform ?? process.platform;
  const env = opts.env ?? process.env;
  const win = platform === "win32";
  const exists = opts.exists ?? (win ? isFile : isExecutable);
  if (command === "") return null;
  const p = win ? path.win32 : path.posix;
  const exts = win ? (env.PATHEXT || ".COM;.EXE;.BAT;.CMD").split(";").filter(Boolean).map((e) => e.toLowerCase()) : [];
  // Nazwa z rozszerzeniem z PATHEXT (`git.exe`) jest szukana tylko tak, jak ją podano.
  const candidates = (base: string) => (!win || exts.includes(p.extname(base).toLowerCase()) ? [base] : exts.map((e) => base + e));
  if (hasDir(command, platform)) return candidates(command).find(exists) ?? null;
  for (const dir of pathValue(env, platform).split(p.delimiter)) {
    if (dir === "") continue;
    const hit = candidates(p.join(dir, command)).find(exists);
    if (hit) return hit;
  }
  return null;
}

/** Program i argumenty gotowe do `spawn`. `verbatim`: linia poleceń już zacytowana dla cmd.exe. */
export type SpawnPlan = { command: string; args: string[]; verbatim: boolean };

/** Znaki, które cmd.exe interpretuje (za `cross-spawn`). Poprzedzone `^` tracą znaczenie. */
const CMD_META = /([()\][%!^"`<>&|;, *?])/g;

/** Argument dla `cmd.exe /d /s /c "…"`: najpierw cytowanie jak dla CreateProcess, potem `^` przed
 *  metaznakami. Ten sam algorytm co `cross-spawn` (`lib/util/escape.js`). */
export function cmdEscapeArg(arg: string): string {
  let a = arg.replace(/(\\*)"/g, '$1$1\\"');
  a = a.replace(/(\\*)$/, "$1$1");
  return `"${a}"`.replace(CMD_META, "^$1");
}

/** Skrypt JS, który shim npm (`codex.cmd`) podaje node: `"%_prog%" "%dp0%\node_modules\…\codex.js" %*`
 *  (starsze shimy: `node "%~dp0\…js" %*`). Skrypt uruchamiany czymś innym (`code.cmd` → `Code.exe`) się nie liczy. */
export function npmShimTarget(shim: string, text: string): string | null {
  const m = /(?:"%_prog%"|\bnode(?:\.exe)?"?)\s+"%~?dp0%?\\?([^"%]+\.[cm]?js)"\s+%\*/i.exec(text);
  return m ? path.win32.join(path.win32.dirname(shim), m[1]) : null;
}

/**
 * Jak uruchomić program bez powłoki. Poza Windows: bez zmian. Na Windows:
 * - `.exe`/`.com` wprost (pełna ścieżka z PATH),
 * - shim npm (`.cmd` wołający skrypt JS): `node skrypt.js args` – bez cmd.exe, więc argumenty
 *   (np. prompt systemowy z nowymi liniami) przechodzą bez cytowania dla cmd,
 * - inny `.cmd`/`.bat`: przez `cmd.exe /d /s /c` z cytowaniem; nowa linia w argumencie to błąd,
 *   bo cmd.exe ucina na niej polecenie.
 * Nieznaleziony program zostaje jak był: `spawn` zgłosi ENOENT jak dotąd.
 */
export function spawnPlan(command: string, args: string[], opts: Lookup & { read?: (f: string) => string } = {}): SpawnPlan {
  const platform = opts.platform ?? process.platform;
  if (platform !== "win32") return { command, args, verbatim: false };
  const env = opts.env ?? process.env;
  const resolved = resolveCommand(command, opts);
  if (!resolved) return { command, args, verbatim: false };
  const ext = path.win32.extname(resolved).toLowerCase();
  if (ext !== ".cmd" && ext !== ".bat") return { command: resolved, args, verbatim: false };
  const read = opts.read ?? ((f: string) => fs.readFileSync(f, "utf8"));
  let script: string | null = null;
  try {
    script = npmShimTarget(resolved, read(resolved));
  } catch {
    // nieczytelny plik: zostaje cmd.exe
  }
  if (script) {
    const local = path.win32.join(path.win32.dirname(resolved), "node.exe");
    const exists = opts.exists ?? isFile;
    return { command: exists(local) ? local : (resolveCommand("node", opts) ?? "node"), args: [script, ...args], verbatim: false };
  }
  if (args.some((a) => /[\r\n]/.test(a))) throw new Error(`${command}: argumentu z nową linią nie da się przekazać przez cmd.exe`);
  const line = [resolved, ...args].map(cmdEscapeArg).join(" ");
  return { command: env.ComSpec || env.COMSPEC || "cmd.exe", args: ["/d", "/s", "/c", `"${line}"`], verbatim: true };
}

/**
 * Sygnał do procesu i wszystkiego, co uruchomił. Zwraca, czy proces jeszcze istniał.
 * - Linux/macOS: do grupy (`-pid`; dziecko z `detached: true` albo z node-pty jest jej liderem).
 *   Tuż po spawn grupy może jeszcze nie być (ESRCH): wtedy do samego pid.
 * - Windows: sygnałów nie ma. `0` sprawdza, czy proces żyje, każdy inny zabija całe drzewo
 *   (`taskkill /T /F`); łagodnego zamknięcia konsolowych programów nie da się wysłać.
 */
export function signalTree(pid: number, sig: NodeJS.Signals | 0, platform: NodeJS.Platform = process.platform): boolean {
  if (platform === "win32") {
    if (!alive(pid)) return false;
    if (sig !== 0) {
      const child = spawn("taskkill", ["/PID", String(pid), "/T", "/F"], { stdio: "ignore", windowsHide: true });
      child.on("error", () => undefined);
    }
    return true;
  }
  try {
    process.kill(-pid, sig);
    return true;
  } catch {
    return alive(pid, sig);
  }
}

/** Jak `signalTree`, ale na Windows czeka, aż `taskkill` skończy (wyjście z aplikacji). */
export function signalTreeSync(pid: number, sig: NodeJS.Signals | 0, platform: NodeJS.Platform = process.platform): boolean {
  if (platform !== "win32" || sig === 0) return signalTree(pid, sig, platform);
  if (!alive(pid)) return false;
  spawnSync("taskkill", ["/PID", String(pid), "/T", "/F"], { stdio: "ignore", windowsHide: true, timeout: 5000 });
  return true;
}

function alive(pid: number, sig: NodeJS.Signals | 0 = 0): boolean {
  try {
    process.kill(pid, sig);
    return true;
  } catch {
    return false;
  }
}

/** Adres gniazda mostu MCP bota. Linux/macOS: plik gniazda w `dir`, domyślnie w prywatnym katalogu
 *  (`$XDG_RUNTIME_DIR`, inaczej nowy katalog 0700 w tmp). Windows: named pipe (`dir` bez znaczenia);
 *  domyślne prawa potoku dają innym użytkownikom co najwyżej odczyt, a sesję i tak wskazuje token. */
export function bridgeSocketPath(dir?: string, platform: NodeJS.Platform = process.platform, env: Env = process.env, pid = process.pid): string {
  if (platform === "win32") return `\\\\.\\pipe\\roost-bot-${pid}-${randomBytes(6).toString("hex")}`;
  const base = dir || env.XDG_RUNTIME_DIR || fs.mkdtempSync(path.join(os.tmpdir(), "agents-"));
  return path.join(base, `agents-bot-${pid}.sock`);
}

/** Czy adres to named pipe Windows (a nie plik gniazda). */
export function isPipePath(p: string): boolean {
  return p.startsWith("\\\\.\\pipe\\") || p.startsWith("\\\\?\\pipe\\");
}

/** Czy pliki mają uniksowe prawa dostępu (`chmod`). Na Windows profil użytkownika chroni ACL. */
export function hasUnixPerms(platform: NodeJS.Platform = process.platform): boolean {
  return platform !== "win32";
}

/** Program otwierający plik domyślną aplikacją; `null` = `shell.openPath` z Electrona. */
export function systemOpener(platform: NodeJS.Platform = process.platform): string | null {
  if (platform === "linux") return "xdg-open";
  if (platform === "darwin") return "open";
  return null;
}

/** Rozszerzenia, które domyślna aplikacja systemu uruchamia zamiast otwierać (Windows: `shell.openPath`,
 *  macOS: `open`). Takiego pliku z linku w terminalu nie otwieramy, tylko pokazujemy w folderze. */
const RUNNABLE: Partial<Record<NodeJS.Platform, string[]>> = {
  win32: [".exe", ".com", ".bat", ".cmd", ".ps1", ".psm1", ".vbs", ".vbe", ".js", ".jse", ".wsf", ".wsh", ".msi", ".msp", ".scr", ".pif", ".hta", ".cpl", ".lnk", ".url", ".reg", ".jar", ".appref-ms", ".application", ".msc", ".scf", ".inf", ".settingcontent-ms"],
  darwin: [".app", ".command", ".tool", ".terminal", ".workflow", ".action", ".pkg", ".mpkg", ".jar", ".scpt", ".applescript", ".webloc", ".inetloc", ".fileloc"],
};

export function opensAsProgram(file: string, platform: NodeJS.Platform = process.platform): boolean {
  const ext = (platform === "win32" ? path.win32 : path.posix).extname(file).toLowerCase();
  return RUNNABLE[platform]?.includes(ext) ?? false;
}

/** Powłoka narzędzia `bash` bota; `null` na Windows (narzędzie wyłączone, patrz `toolDefs`). */
export function posixShell(platform: NodeJS.Platform = process.platform): string | null {
  return platform === "win32" ? null : "/bin/sh";
}
