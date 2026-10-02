//! Aktualizacje z GitHub Releases (electron-updater): sprawdzenie po starcie i co kilka godzin,
//! pobranie w tle, pytanie o ponowne uruchomienie. „Później” = instalacja przy zamknięciu.
//! Tylko tam, gdzie da się podmienić program: AppImage i instalacja NSIS (nie zip przenośny).

import fs from "node:fs";
import path from "node:path";
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
