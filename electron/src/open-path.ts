//! Ścieżki z terminala: sprawdzenie, że plik istnieje, i otwarcie go w edytorze (bez powłoki).

import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import { absolutePath, openPlan } from "../../src/term-links";
import { t } from "./i18n";
import { childEnv, expand } from "./env";

const MAX_PATHS = 60;

/** Dla każdej ścieżki: bezwzględna ścieżka zwykłego pliku albo `null`. cwd to katalog panelu. */
export function resolveFiles(cwd: string, paths: string[], home = os.homedir()): (string | null)[] {
  const base = cwd ? absolutePath(expand(cwd), home, home) : home;
  return paths.slice(0, MAX_PATHS).map((p) => {
    if (typeof p !== "string" || p === "" || p.includes("\0")) return null;
    const abs = absolutePath(p, base, home);
    try {
      return fs.statSync(abs).isFile() ? abs : null;
    } catch {
      return null;
    }
  });
}

/** Otwiera istniejący plik: $VISUAL/$EDITOR, gdy to znany edytor z GUI, inaczej `xdg-open`. */
export function openFile(file: string, line?: number, col?: number, env: NodeJS.ProcessEnv = process.env): void {
  if (typeof file !== "string" || !file.startsWith("/") || file.includes("\0")) throw new Error(t("open.badPath"));
  if (!fs.statSync(file).isFile()) throw new Error(t("open.notFile"));
  const l = Number.isInteger(line) && line! > 0 ? line : undefined;
  const c = l !== undefined && Number.isInteger(col) && col! > 0 ? col : undefined;
  const { command, args } = openPlan(file, l, c, env.VISUAL || env.EDITOR);
  const child = spawn(command, args, { stdio: "ignore", detached: true, env: childEnv() });
  child.on("error", () => undefined); // brak edytora w PATH: bez wyjątku w procesie głównym
  child.unref();
}
