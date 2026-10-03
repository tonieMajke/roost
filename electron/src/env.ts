//! Środowisko procesów uruchamianych z aplikacji (agenci, powłoki, notify-send, claude -p).
//! Uruchomiona z AppImage aplikacja ma środowisko AppRun (`LD_LIBRARY_PATH`, `PATH`,
//! `PYTHONHOME`… wskazujące na zamontowany `$APPDIR`). Agenci i powłoki w panelach
//! nie mogą go dziedziczyć: python, perl i programy z systemowymi bibliotekami się sypią.

import os from "node:os";
import { defaultShell, isWindows } from "./platform";

/** Ustawiane przez runtime/AppRun (i electron-updater) bez odwołania do `$APPDIR` w wartości. */
const APPIMAGE_ONLY = ["APPDIR", "APPIMAGE", "ARGV0", "OWD", "PYTHONDONTWRITEBYTECODE", "GTK_THEME", "APPIMAGE_SILENT_INSTALL", "APPIMAGE_EXIT_AFTER_INSTALL"];

/** Wpis w montowaniu dowolnego AppImage (`/tmp/.mount_Roost-XXXXXX/...`). Po aktualizacji przez dawny
 *  updater środowisko ma jeszcze ścieżki montowania poprzedniej wersji (AppRun tylko dopisuje swoje). */
const MOUNT_ENTRY = /(^|\/)\.mount_[^/]+(\/|$)/;

export type Env = Record<string, string | undefined>;

/** Poprawki środowiska dziecka: zmienne do usunięcia i do nadpisania.
 *  Listy `a:b:c` tracą wpisy z `$APPDIR` i z montowań innych AppImage; zmienna bez innych wpisów znika.
 *  Poza AppImage (brak `APPDIR`/`APPIMAGE`) nic nie zmienia. */
export function childEnvFixes(vars: Env): { remove: string[]; set: [string, string][] } {
  const remove: string[] = [];
  const set: [string, string][] = [];
  const dir = vars.APPDIR;
  if (!dir || dir.length <= 1 || !vars.APPIMAGE) return { remove, set };
  const appdir = dir.replace(/\/+$/, "");
  for (const [key, value] of Object.entries(vars)) {
    if (value === undefined) continue;
    if (APPIMAGE_ONLY.includes(key)) remove.push(key);
    else if (value.includes(appdir) || MOUNT_ENTRY.test(value)) {
      const kept = value.split(":").filter((p) => p !== "" && !p.includes(appdir) && !MOUNT_ENTRY.test(p));
      if (kept.length === 0) remove.push(key);
      else set.push([key, kept.join(":")]);
    }
  }
  return { remove, set };
}

/** Zmienne Electrona: `ELECTRON_RUN_AS_NODE` w dziecku zmieniłby każdy program na Electronie w node. */
function ownVar(key: string): boolean {
  return key.startsWith("ELECTRON_") || key === "CHROME_DESKTOP";
}

/** Środowisko tego procesu bez zmiennych Electrona i AppImage, plus `extra`. */
export function childEnv(extra: Env = {}, base: Env = process.env): Record<string, string> {
  const { remove, set } = childEnvFixes(base);
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(base)) {
    if (value !== undefined && !ownVar(key) && !remove.includes(key)) env[key] = value;
  }
  for (const [key, value] of set) env[key] = value;
  for (const [key, value] of Object.entries(extra)) if (value !== undefined) env[key] = value;
  return env;
}

/** `$SHELL` → wartość zmiennej (bez niej, np. na Windows: domyślna powłoka systemu),
 *  `$X` → wartość zmiennej, `~/x` → względem katalogu domowego. */
export function expand(value: string): string {
  if (value === "$SHELL") return defaultShell();
  if (value.startsWith("$")) return process.env[value.slice(1)] ?? "";
  // Windows: `tildify` zapisuje `~\x` (separator z oryginalnej ścieżki)
  if (value === "~" || value.startsWith("~/") || (isWindows && value.startsWith("~\\"))) return os.homedir() + value.slice(1);
  return value;
}
