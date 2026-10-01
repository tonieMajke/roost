//! Limity subskrypcji Claude („Limity Claude” w doku), z wejścia linii statusu Claude Code
//! (`rate_limits`). Panele claude dostają `--settings` z `statusLine`, której poleceniem jest
//! `statusline.cjs` uruchomiony binarką aplikacji jako node; zostawia tylko `rate_limits` w katalogu
//! konfiguracji. Bez tokenu, bez sieci, nic w `~/.claude`.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { expand } from "./env";

export const LIMITS_FILE = "claude-limits.json";

/** Konto z `accounts.json`: id nazywa plik limitów, `dir` to jego folder logowania. */
export type AccountRef = { id: string; dir: string };

/** Każde konto ma własny plik (inny abonament = inne limity); id z pliku użytkownika nie może wyjść poza folder. */
export function limitsFile(configDir: string, accountId?: string): string {
  if (!accountId) return path.join(configDir, LIMITS_FILE);
  return path.join(configDir, LIMITS_FILE.replace(".json", `.${accountId.replace(/[^A-Za-z0-9_-]/g, "_")}.json`));
}

export type Window = { pct: number; resetsAt: number };
export type ClaudeLimits = { fiveHour: Window | null; sevenDay: Window | null; at: number };

type Json = Record<string, unknown>;
const obj = (v: unknown): Json | null => (v !== null && typeof v === "object" && !Array.isArray(v) ? (v as Json) : null);

function window(v: unknown): Window | null {
  const w = obj(v);
  const pct = w?.used_percentage;
  const resets = w?.resets_at;
  if (typeof pct !== "number" || typeof resets !== "number") return null;
  return { pct, resetsAt: Math.max(0, Math.trunc(resets)) };
}

/** `rate_limits` jednego wejścia linii statusu; `null` = brak subskrypcji albo jeszcze brak odpowiedzi API. */
export function parseStatus(input: string, at: number): ClaudeLimits | null {
  let root: Json | null;
  try {
    root = obj(JSON.parse(input));
  } catch {
    return null;
  }
  const rl = obj(root?.rate_limits);
  if (!rl) return null;
  const limits = { fiveHour: window(rl.five_hour), sevenDay: window(rl.seven_day), at };
  return limits.fiveHour || limits.sevenDay ? limits : null;
}

/** Kilka paneli claude uruchamia pomocnika naraz: własna nazwa tymczasowa, potem atomowy rename. */
export function store(file: string, limits: ClaudeLimits): void {
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(limits));
  fs.renameSync(tmp, file);
}

/** `'x'` dla `sh -c`: claude uruchamia polecenie linii statusu przez powłokę. */
export function shellQuote(s: string): string {
  return `'${s.replaceAll("'", `'\\''`)}'`;
}

/** Własna linia statusu użytkownika wygrywa: z nią w `~/.claude/settings.json` nic nie dodajemy. */
export function userHasStatusLine(settings: string): boolean {
  try {
    const v = obj(JSON.parse(fs.readFileSync(settings, "utf8")));
    return v !== null && "statusLine" in v;
  } catch {
    return false;
  }
}

export function settingsArg(exe: string, helper: string, file: string): string {
  const command = `ELECTRON_RUN_AS_NODE=1 ${shellQuote(exe)} ${shellQuote(helper)} ${shellQuote(file)}`;
  return JSON.stringify({ statusLine: { type: "command", command } });
}

/** JSON dla `claude --settings` albo `null`, gdy użytkownik ma własną linię statusu. */
export function claudeSettingsArg(exe: string, helper: string, configDir: string, account?: AccountRef): string | null {
  const claudeHome = account ? expand(account.dir) : path.join(os.homedir(), ".claude");
  if (userHasStatusLine(path.join(claudeHome, "settings.json"))) return null;
  fs.mkdirSync(configDir, { recursive: true });
  return settingsArg(exe, helper, limitsFile(configDir, account?.id));
}

/** Najnowsze limity z dowolnego panelu claude (konta `accountId` albo domyślnego); `null` przed pierwszymi. */
export function claudeLimits(configDir: string, accountId?: string): ClaudeLimits | null {
  try {
    return JSON.parse(fs.readFileSync(limitsFile(configDir, accountId), "utf8")) as ClaudeLimits;
  } catch {
    return null;
  }
}
