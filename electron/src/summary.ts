//! Streszczenie wyciągu rozmowy przez jednorazowe `claude -p` (M4, Shift przy upuszczeniu).
//! Bez narzędzi, MCP, ustawień i zapisu sesji; katalog tymczasowy, żeby nie czytał CLAUDE.md.

import { spawn } from "node:child_process";
import os from "node:os";
import { childEnv } from "./env";

const TIMEOUT_MS = 60_000;
const MODEL = "haiku";

export function summaryArgs(system: string): string[] {
  return [
    "-p", "--model", MODEL, "--no-session-persistence", "--tools", "", "--strict-mcp-config",
    "--disable-slash-commands", "--setting-sources", "", "--system-prompt", system,
  ];
}

/** Uruchamia `program args`, podaje `input` na stdin, zwraca przycięte stdout.
 *  Odrzuca: nie wystartował, przekroczony czas (proces zabity), kod ≠ 0 albo pusta odpowiedź. */
export function run(program: string, args: string[], input: string, timeoutMs: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(program, args, { cwd: os.tmpdir(), env: childEnv(), stdio: ["pipe", "pipe", "pipe"] });
    let out = "";
    let err = "";
    let timedOut = false;
    child.stdout.setEncoding("utf8").on("data", (d: string) => (out += d));
    child.stderr.setEncoding("utf8").on("data", (d: string) => (err += d));
    child.stdin.on("error", () => {}); // proces skończył, zanim przeczytał wejście
    child.stdin.end(input); // zamknięcie stdin = koniec wejścia
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, timeoutMs);
    child.on("error", (e) => {
      clearTimeout(timer);
      reject(new Error(`nie uruchomiono \`${program}\`: ${e.message}`));
    });
    child.on("close", (code, signal) => {
      clearTimeout(timer);
      if (timedOut) return reject(new Error(`brak odpowiedzi po ${Math.round(timeoutMs / 1000)} s`));
      if (code !== 0) {
        const why = err.split("\n").find((l) => l.trim() !== "")?.trim() ?? "";
        if (code === null) return reject(new Error(`przerwany sygnałem ${signal ?? ""}`.trim()));
        return reject(new Error(why === "" ? `kod ${code}` : `kod ${code}: ${why}`));
      }
      const text = out.trim();
      if (text === "") return reject(new Error("pusta odpowiedź"));
      resolve(text);
    });
  });
}

/** `command`: program claude z agents.json (zwykle `claude`); `system`: polecenie streszczenia;
 *  `input`: wyciąg rozmowy. */
export function claudeSummary(command: string, system: string, input: string): Promise<string> {
  return run(command, summaryArgs(system), input, TIMEOUT_MS);
}
