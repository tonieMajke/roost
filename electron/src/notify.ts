//! Powiadomienie na pulpicie przez `notify-send` (Linux), jak w wersji Tauri.

import { spawn } from "node:child_process";
import { childEnv } from "./env";

const APP_NAME = "Agents";

/** Argumenty `notify-send`: nazwa aplikacji, tytuł, treść. */
export function notifyArgs(title: string, body: string): string[] {
  return ["-a", APP_NAME, title, body];
}

export function notify(title: string, body: string): void {
  const child = spawn("notify-send", notifyArgs(title, body), { stdio: "ignore", env: childEnv() });
  child.on("error", (e) => console.error(`notify-send: ${e.message}`));
}
