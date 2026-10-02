//! Program CLI jako dostawca czatu: proces z poleceniem na stdin, wyjście linia po linii (JSON).

import { t } from "../i18n";
import { spawn } from "node:child_process";
import fs from "node:fs";
import type { ChatEvent } from "../../../src/chat";
import { childEnv } from "../env";
import { killGroup } from "../bot/proc";
import { spawnPlan } from "../platform";

export type LineParser = {
  /** Zdarzenia z jednej linii wyjścia (już sparsowanej z JSON). */
  line(obj: unknown): ChatEvent[];
  /** Po zakończeniu procesu: błąd do zgłoszenia mimo kodu 0 (np. `result` z `is_error`). */
  failure(): string | null;
};

/** Uruchamia program, podaje `input` na stdin; zdarzenia z parsera idą do `emit`.
 *  Rozwiązuje się po zamknięciu procesu; odrzuca przy błędzie (komunikat z parsera albo stderr).
 *  Abort = SIGTERM, po 2 s SIGKILL, do całej grupy: dzieci programu (MCP, polecenia) trzymają stdout
 *  i bez tego `close` czekałby, aż same skończą. */
export function runCli(
  program: string,
  args: string[],
  input: string,
  cwd: string,
  parser: LineParser,
  signal: AbortSignal,
  emit: (e: ChatEvent) => void,
  env: Record<string, string> = {},
): Promise<void> {
  if (signal.aborted) return Promise.resolve(); // przerwane przed startem: procesu nie uruchamiamy
  fs.mkdirSync(cwd, { recursive: true });
  const childVars = childEnv(env);
  let plan: ReturnType<typeof spawnPlan>;
  try {
    plan = spawnPlan(program, args, { env: childVars });
  } catch (e) {
    return Promise.reject(e as Error);
  }
  return new Promise((resolve, reject) => {
    const child = spawn(plan.command, plan.args, { cwd, env: childVars, stdio: ["pipe", "pipe", "pipe"], detached: true, windowsHide: true, windowsVerbatimArguments: plan.verbatim });
    let buf = "";
    let err = "";
    let killTimer: ReturnType<typeof setTimeout> | undefined;
    const onAbort = () => {
      killGroup(child.pid, "SIGTERM");
      killTimer = setTimeout(() => killGroup(child.pid, "SIGKILL"), 2000);
    };
    signal.addEventListener("abort", onAbort, { once: true });

    const handle = (line: string) => {
      if (line.trim() === "") return;
      let obj: unknown;
      try {
        obj = JSON.parse(line);
      } catch {
        return; // ostrzeżenia programu na stdout
      }
      for (const e of parser.line(obj)) emit(e);
    };
    child.stdout.setEncoding("utf8").on("data", (d: string) => {
      buf += d;
      let nl: number;
      while ((nl = buf.indexOf("\n")) >= 0) {
        handle(buf.slice(0, nl));
        buf = buf.slice(nl + 1);
      }
    });
    child.stderr.setEncoding("utf8").on("data", (d: string) => {
      if (err.length < 8000) err += d;
    });
    child.stdin.on("error", () => {});
    child.stdin.end(input);

    child.on("error", (e) => {
      signal.removeEventListener("abort", onAbort);
      reject(new Error(`nie uruchomiono \`${program}\`: ${e.message}`));
    });
    child.on("close", (code, sig) => {
      signal.removeEventListener("abort", onAbort);
      clearTimeout(killTimer);
      handle(buf);
      if (signal.aborted) return resolve();
      const failure = parser.failure();
      if (failure) return reject(new Error(failure));
      if (code !== 0) {
        const why = err.split("\n").find((l) => l.trim() !== "")?.trim();
        return reject(new Error(why ? `${program}: ${why}` : t("chat.cliExit", { program, code: code ?? sig ?? "" })));
      }
      resolve();
    });
  });
}
