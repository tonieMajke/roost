//! Powiadomienie na pulpicie przez `notify-send` (Linux), jak w wersji Tauri.

import { spawn } from "node:child_process";
import { childEnv } from "./env";

const APP_NAME = "Agents";
/** Akcja `default` = kliknięcie w samo powiadomienie (KDE, GNOME, dunst). */
const CLICK = "default";

/** Argumenty `notify-send`: nazwa aplikacji, (akcja kliknięcia), tytuł, treść. */
export function notifyArgs(title: string, body: string, clickable = false): string[] {
  return ["-a", APP_NAME, ...(clickable ? ["-A", `${CLICK}=Otwórz`] : []), title, body];
}

/** `onClick`: notify-send czeka na decyzję i wypisuje nazwę wybranej akcji. */
export function notify(title: string, body: string, onClick?: () => void): void {
  const child = spawn("notify-send", notifyArgs(title, body, onClick !== undefined), { stdio: ["ignore", onClick ? "pipe" : "ignore", "ignore"], env: childEnv() });
  child.on("error", (e) => console.error(`notify-send: ${e.message}`));
  let out = "";
  child.stdout?.on("data", (d: Buffer) => (out += d.toString()));
  child.on("close", () => {
    if (out.trim() === CLICK) onClick?.();
  });
}
