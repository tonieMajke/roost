//! Naprawa wpisu w menu po aktualizacji AppImage. electron-updater przy pliku z wersją w nazwie
//! (`Roost-0.0.3.AppImage`) zapisuje nowy plik pod nową nazwą i kasuje stary, więc `.desktop`
//! zrobiony przez użytkownika (ręcznie, AppImageLauncher, Gear Lever) wskazuje na nieistniejący plik.
//! Przy starcie poprawiamy w takich wpisach tylko ścieżkę w Exec/TryExec i X-AppImage-Version.

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

/** Katalog wpisów użytkownika; systemowych (`/usr/share/applications`) nie ruszamy. */
export function applicationsDir(env: NodeJS.ProcessEnv = process.env, home = os.homedir()): string {
  const data = env.XDG_DATA_HOME && path.isAbsolute(env.XDG_DATA_HOME) ? env.XDG_DATA_HOME : path.join(home, ".local", "share");
  return path.join(data, "applications");
}

const KEY_LINE = /^(Exec|TryExec)(\s*=\s*)(.*)$/;
const APPIMAGE = /\.appimage$/i;
const ROOST_APPIMAGE = /^roost[^/]*\.appimage$/i;

/** Pierwszy argument wartości Exec/TryExec: ścieżka (bez cudzysłowów) i zakres w `value`. */
export function firstArg(value: string): { path: string; start: number; end: number; quoted: boolean } | null {
  const start = value.length - value.trimStart().length;
  if (start >= value.length) return null;
  if (value[start] !== '"') {
    const m = /^[^\s]+/.exec(value.slice(start))!;
    return { path: m[0], start, end: start + m[0].length, quoted: false };
  }
  // Specyfikacja .desktop: w cudzysłowie \" \` \$ \\ to znaki dosłowne
  let out = "";
  for (let i = start + 1; i < value.length; i++) {
    const c = value[i];
    if (c === "\\" && i + 1 < value.length) {
      out += value[++i];
    } else if (c === '"') {
      return { path: out, start, end: i + 1, quoted: true };
    } else {
      out += c;
    }
  }
  return null; // niezamknięty cudzysłów: nie zgadujemy
}

function quoteArg(p: string, quoted: boolean): string {
  if (!quoted && !/[\s"'`$\\<>~|&;*?#()]/.test(p)) return p;
  return `"${p.replace(/["`$\\]/g, (c) => "\\" + c)}"`;
}

/** Wpis Roosta: nasza klasa okna albo Exec/TryExec na `Roost*.AppImage`. */
export function isRoostEntry(text: string): boolean {
  for (const raw of text.split("\n")) {
    const line = raw.replace(/\r$/, "");
    if (/^StartupWMClass\s*=\s*roost-app\s*$/.test(line)) return true;
    const m = KEY_LINE.exec(line);
    const arg = m && firstArg(m[3]);
    if (arg && ROOST_APPIMAGE.test(path.basename(arg.path))) return true;
  }
  return false;
}

/** Nowa treść wpisu albo `null`, gdy nic do zmiany. Zmienia tylko Exec/TryExec wskazujące na
 *  nieistniejący AppImage (inny niż bieżący) oraz X-AppImage-Version; reszta linii bez zmian. */
export function repairEntry(text: string, appimage: string, version: string, exists: (p: string) => boolean): string | null {
  if (!path.isAbsolute(appimage) || !isRoostEntry(text)) return null;
  const lines = text.split("\n");
  let changed = false;
  for (let i = 0; i < lines.length; i++) {
    const cr = lines[i].endsWith("\r") ? "\r" : "";
    const line = cr ? lines[i].slice(0, -1) : lines[i];
    const m = KEY_LINE.exec(line);
    const arg = m && firstArg(m[3]);
    if (!m || !arg) continue;
    const old = arg.path;
    if (old === appimage || !path.isAbsolute(old) || !APPIMAGE.test(old) || exists(old)) continue;
    const value = m[3].slice(0, arg.start) + quoteArg(appimage, arg.quoted) + m[3].slice(arg.end);
    lines[i] = m[1] + m[2] + value + cr;
    changed = true;
  }
  if (!changed) return null;
  for (let i = 0; i < lines.length; i++) {
    const m = /^(X-AppImage-Version\s*=\s*)(.*?)(\r?)$/.exec(lines[i]);
    if (m) lines[i] = m[1] + version + m[3];
  }
  return lines.join("\n");
}

const MAX_SIZE = 64 * 1024;

/** Przegląda `dir` i naprawia wpisy Roosta. Zwraca nazwy poprawionych plików. */
export async function repairDesktopEntries(dir: string, appimage: string, version: string): Promise<string[]> {
  const fixed: string[] = [];
  const existing = new Map<string, boolean>();
  const exists = (p: string) => existing.get(p) ?? true; // nieznane = istnieje, czyli nie ruszamy
  let names: string[];
  try {
    names = await fs.readdir(dir);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return fixed; // nikt nie dodał wpisu do menu
    throw e;
  }
  for (const name of names) {
    if (!name.endsWith(".desktop")) continue;
    const file = path.join(dir, name);
    // Dowiązania pomijamy: rename zastąpiłby link zwykłym plikiem
    const st = await fs.lstat(file);
    if (!st.isFile() || st.size > MAX_SIZE) continue;
    const text = await fs.readFile(file, "utf8");
    if (!isRoostEntry(text)) continue;
    for (const raw of text.split("\n")) {
      const m = KEY_LINE.exec(raw.replace(/\r$/, ""));
      const arg = m && firstArg(m[3]);
      if (arg && path.isAbsolute(arg.path) && !existing.has(arg.path)) {
        existing.set(arg.path, await fs.access(arg.path).then(() => true, () => false));
      }
    }
    const next = repairEntry(text, appimage, version, exists);
    if (next === null) continue;
    const tmp = path.join(dir, `.${name}.${process.pid}.tmp`);
    try {
      await fs.writeFile(tmp, next, { mode: st.mode & 0o777 });
      await fs.rename(tmp, file);
    } catch (e) {
      await fs.rm(tmp, { force: true });
      throw e;
    }
    fixed.push(name);
  }
  return fixed;
}
