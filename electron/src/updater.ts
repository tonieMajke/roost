//! Aktualizacje z GitHub Releases (electron-updater): sprawdzenie po starcie i co kilka godzin,
//! pobranie w tle, pytanie o ponowne uruchomienie. „Później” = instalacja przy zamknięciu.
//! Tylko tam, gdzie da się podmienić program: AppImage i instalacja NSIS (nie zip przenośny).

import fs from "node:fs";
import path from "node:path";
import { childEnv } from "./env";
import { t } from "./i18n";

export const CHECK_DELAY_MS = 10_000;
export const CHECK_EVERY_MS = 6 * 60 * 60 * 1000;

/** Czy ta kopia może się sama zaktualizować. `exePath` = `process.execPath`. */
export function updatable(o: { packaged: boolean; platform: NodeJS.Platform; env: NodeJS.ProcessEnv; exePath: string }): boolean {
  if (!o.packaged || o.env.ROOST_NO_UPDATE) return false;
  // AppRun ustawia APPIMAGE na ścieżkę pliku, który updater podmienia
  if (o.platform === "linux") return !!o.env.APPIMAGE;
  // Instalator NSIS zostawia deinstalator obok programu; zip przenośny go nie ma
  if (o.platform === "win32") return fs.existsSync(path.join(path.dirname(o.exePath), `Uninstall ${path.basename(o.exePath, ".exe")}.exe`));
  return false;
}

/** Opcje dla `dialog.showMessageBox`; przycisk 0 = uruchom ponownie. */
export function readyOptions(version: string) {
  return {
    type: "info" as const,
    message: t("update.title", { version }),
    detail: t("update.detail"),
    buttons: [t("update.restart"), t("update.later")],
    defaultId: 0,
    cancelId: 1,
  };
}

/** Część `autoUpdater`, której używa `installAndRelaunch`. */
export type Installer = {
  autoRunAppAfterInstall: boolean;
  quitAndInstall(): void;
  once(event: "appimage-filename-updated", fn: (file: string) => void): unknown;
  removeListener(event: "appimage-filename-updated", fn: (file: string) => void): unknown;
};

function inode(file: string): number | null {
  try {
    return fs.statSync(file).ino;
  } catch {
    return null;
  }
}

/** Podmienia zawartość `env` (u nas `process.env`, które Node przepisuje do środowiska procesu). */
export function replaceEnv(env: NodeJS.ProcessEnv, next: Record<string, string>): void {
  for (const key of Object.keys(env)) if (!(key in next)) delete env[key];
  for (const [key, value] of Object.entries(next)) env[key] = value;
}

/**
 * AppImage: instalacja przez electron-updater, ale nowa wersja startuje przez `relaunch` (`app.relaunch`).
 * Sam updater uruchamia ją przez `child_process.spawn`, a libuv nie zamyka deskryptorów, które Chromium
 * otworzył bez O_CLOEXEC (`app.asar`, `icudtl.dat`, `*.pak` ze starego montowania): nowa wersja i jej
 * proces FUSE trzymały przez to stare montowanie do końca pracy, a środowisko niosło ścieżki starego
 * `$APPDIR` (PATH, LD_LIBRARY_PATH…). Relauncher Electrona czeka na koniec tego procesu i uruchamia
 * program przez base::LaunchProcess, który zamyka wszystkie deskryptory poza 0–2; środowisko bierze
 * z `env`, więc przedtem czyścimy je jak dla dziecka (`childEnv`).
 * Zwraca, czy nowa wersja jest na miejscu (wtedy też `quit`). Bez tego nic nie robi: updater zgłosił
 * błąd (`error`) i aplikacja działa dalej.
 */
export function installAndRelaunch(up: Installer, o: { env: NodeJS.ProcessEnv; relaunch(execPath: string): void; quit(): void; ino?: (file: string) => number | null }): boolean {
  const ino = o.ino ?? inode;
  const current = o.env.APPIMAGE;
  if (!current) {
    up.quitAndInstall();
    return false;
  }
  const before = ino(current);
  let target = current;
  // Plik z wersją w nazwie (`Roost-0.0.4.AppImage`) dostaje nazwę nowej wersji
  const renamed = (file: string) => void (target = file);
  up.once("appimage-filename-updated", renamed);
  // Bez własnego uruchomienia: updater tylko podmienia plik (i odpala go z APPIMAGE_EXIT_AFTER_INSTALL, co nic nie robi)
  up.autoRunAppAfterInstall = false;
  try {
    up.quitAndInstall();
  } finally {
    up.removeListener("appimage-filename-updated", renamed);
  }
  const after = ino(target);
  if (after === null || after === before) return false;
  replaceEnv(o.env, childEnv({}, o.env));
  o.relaunch(target);
  o.quit();
  return true;
}
