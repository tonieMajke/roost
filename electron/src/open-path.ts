//! Ścieżki z terminala: sprawdzenie, że plik istnieje, i otwarcie go w edytorze (bez powłoki).

import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { absolutePath, openPlan } from "../../src/term-links";
import { t } from "./i18n";
import { childEnv, expand } from "./env";
import { isWindows, opensAsProgram, spawnPlan, systemOpener } from "./platform";

const MAX_PATHS = 60;

/** Dla każdej ścieżki: bezwzględna ścieżka zwykłego pliku albo `null`. cwd to katalog panelu. */
export function resolveFiles(cwd: string, paths: string[], home = os.homedir()): (string | null)[] {
  // `absolutePath` zna tylko ścieżki z `/`; na Windows (`C:\…`) rozwiązuje je `path.resolve`.
  const resolve = isWindows
    ? (p: string, from: string) => path.resolve(from, p === "~" || /^~[\\/]/.test(p) ? home + p.slice(1) : p)
    : (p: string, from: string) => absolutePath(p, from, home);
  const base = cwd ? resolve(expand(cwd), home) : home;
  return paths.slice(0, MAX_PATHS).map((p) => {
    if (typeof p !== "string" || p === "" || p.includes("\0")) return null;
    const abs = resolve(p, base);
    try {
      return fs.statSync(abs).isFile() ? abs : null;
    } catch {
      return null;
    }
  });
}

/** Otwiera istniejący plik: $VISUAL/$EDITOR, gdy to znany edytor z GUI, inaczej domyślną aplikacją systemu
 *  (`xdg-open`, na macOS `open`, na Windows `openDefault`, czyli `shell.openPath` z Electrona).
 *  Plik, który system by uruchomił (`.bat`, `.exe`, `.command`…), trafia do `reveal` (pokaż w folderze). */
export function openFile(
  file: string,
  line?: number,
  col?: number,
  env: NodeJS.ProcessEnv = process.env,
  openDefault?: (file: string) => void,
  reveal?: (file: string) => void,
): void {
  if (typeof file !== "string" || !path.isAbsolute(file) || file.includes("\0")) throw new Error(t("open.badPath"));
  if (!fs.statSync(file).isFile()) throw new Error(t("open.notFile"));
  const l = Number.isInteger(line) && line! > 0 ? line : undefined;
  const c = l !== undefined && Number.isInteger(col) && col! > 0 ? col : undefined;
  const plan = openPlan(file, l, c, env.VISUAL || env.EDITOR);
  const opener = systemOpener();
  const program = plan.command === "xdg-open" ? opener : plan.command;
  if (plan.command === "xdg-open" && opensAsProgram(file)) {
    reveal?.(file);
    return;
  }
  if (program === null) {
    openDefault?.(file);
    return;
  }
  const vars = childEnv();
  // `code` na Windows to `code.cmd`: spawnPlan uruchamia go przez cmd.exe.
  const { command, args, verbatim } = spawnPlan(program, plan.args, { env: vars });
  const child = spawn(command, args, { stdio: "ignore", detached: true, env: vars, windowsHide: true, windowsVerbatimArguments: verbatim });
  child.on("error", () => undefined); // brak edytora w PATH: bez wyjątku w procesie głównym
  child.unref();
}
