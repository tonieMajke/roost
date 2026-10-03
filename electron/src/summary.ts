//! Streszczenie wyciągu rozmowy przez jednorazowe `claude -p` (M4, Shift przy upuszczeniu).
//! Bez narzędzi, MCP, ustawień i zapisu sesji; katalog tymczasowy, żeby nie czytał CLAUDE.md.

import { t } from "./i18n";
import { spawn } from "node:child_process";
import os from "node:os";
import { childEnv } from "./env";
import { execPlan } from "./fd-guard";
import { killChild, releaseAfterExit } from "./platform";

const TIMEOUT_MS = 60_000;
const PI_TIMEOUT_MS = 120_000; // lokalny model bywa wolniejszy niż Haiku
const MODEL = "haiku";

export function summaryArgs(system: string): string[] {
  return [
    "-p", "--model", MODEL, "--no-session-persistence", "--tools", "", "--strict-mcp-config",
    "--disable-slash-commands", "--setting-sources", "", "--system-prompt", system,
  ];
}

/** pi z lokalnym modelem (domyślnym z ustawień pi): bez narzędzi, rozszerzeń i zapisu sesji. */
export function piSummaryArgs(system: string): string[] {
  return [
    "-p", "--no-session", "--no-tools", "--no-extensions", "--no-skills", "--no-prompt-templates",
    "--no-themes", "--thinking", "off", "--system-prompt", system,
  ];
}

/** Uruchamia `program args`, podaje `input` na stdin, zwraca przycięte stdout.
 *  Odrzuca: nie wystartował, przekroczony czas (proces zabity), kod ≠ 0 albo pusta odpowiedź. */
export function run(program: string, args: string[], input: string, timeoutMs: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const env = childEnv();
    const cwd = os.tmpdir();
    const plan = execPlan(program, args, env, { cwd });
    const child = spawn(plan.command, plan.args, { cwd, env: plan.env, stdio: ["pipe", "pipe", "pipe"], windowsHide: true, windowsVerbatimArguments: plan.verbatim });
    let out = "";
    let err = "";
    let timedOut = false;
    child.stdout.setEncoding("utf8").on("data", (d: string) => (out += d));
    child.stderr.setEncoding("utf8").on("data", (d: string) => (err += d));
    child.stdin.on("error", () => {}); // proces skończył, zanim przeczytał wejście
    child.stdin.end(input); // zamknięcie stdin = koniec wejścia
    const timer = setTimeout(() => {
      timedOut = true;
      killChild(child);
      releaseAfterExit(child);
    }, timeoutMs);
    child.on("error", (e) => {
      clearTimeout(timer);
      reject(new Error(t("summary.spawn", { program, msg: e.message })));
    });
    child.on("close", (code, signal) => {
      clearTimeout(timer);
      if (timedOut) return reject(new Error(t("summary.timeout", { s: Math.round(timeoutMs / 1000) })));
      if (code !== 0) {
        const why = err.split("\n").find((l) => l.trim() !== "")?.trim() ?? "";
        if (code === null) return reject(new Error(t("summary.signal", { signal: signal ?? "" }).trim()));
        return reject(new Error(why === "" ? t("summary.code", { code }) : t("summary.codeWhy", { code, why })));
      }
      const text = out.trim();
      if (text === "") return reject(new Error(t("summary.empty")));
      resolve(text);
    });
  });
}

/** `command`: program claude z agents.json (zwykle `claude`); `system`: polecenie streszczenia;
 *  `input`: wyciąg rozmowy. */
export function claudeSummary(command: string, system: string, input: string): Promise<string> {
  return run(command, summaryArgs(system), input, TIMEOUT_MS);
}

/** To samo co `claudeSummary`, ale streszcza lokalny model przez program pi. */
export function piSummary(command: string, system: string, input: string): Promise<string> {
  return run(command, piSummaryArgs(system), input, PI_TIMEOUT_MS);
}
