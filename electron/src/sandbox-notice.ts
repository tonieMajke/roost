//! Ostrzeżenie, gdy okno działa bez sandboxa Chromium. AppRun z electron-buildera sam dokleja
//! `--no-sandbox`, kiedy `unshare -Ur` się nie udaje (Ubuntu 24.04+: AppArmor blokuje przestrzenie
//! nazw użytkownika), więc użytkownik nie wie, że renderer nie ma izolacji.

import fs from "node:fs";
import path from "node:path";
import { t } from "./i18n";

/** Plik w katalogu konfiguracji: jest = użytkownik wybrał „Nie pokazuj ponownie”. */
export const DISMISS_FILE = "no-sandbox-ok";

export const HOWTO_URL = {
  pl: "https://github.com/tonieMajke/roost/blob/main/README.pl.md#rozwiązywanie-problemów",
  en: "https://github.com/tonieMajke/roost/blob/main/README.md#troubleshooting",
} as const;

/** Tylko spakowana aplikacja (w trybie deweloperskim `--no-sandbox` to świadomy wybór). */
export function shouldWarn(noSandbox: boolean, packaged: boolean, dir: string): boolean {
  return noSandbox && packaged && !fs.existsSync(path.join(dir, DISMISS_FILE));
}

export function dismiss(dir: string): void {
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  fs.writeFileSync(path.join(dir, DISMISS_FILE), "", { mode: 0o600 });
}

export type NoticeChoice = { howto: boolean; dontShow: boolean };

/** Opcje dla `dialog.showMessageBox`; przycisk 0 = instrukcja. */
export function noticeOptions() {
  return {
    type: "warning" as const,
    message: t("sandbox.title"),
    detail: t("sandbox.detail"),
    buttons: [t("sandbox.howto"), t("sandbox.ok")],
    defaultId: 1,
    cancelId: 1,
    checkboxLabel: t("sandbox.dontShow"),
  };
}
