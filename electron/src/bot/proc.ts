//! Polecenie bota (`bash`, `rg`) jako proces we własnej grupie: limit czasu i Stop zabijają
//! całą grupę (też dzieci powłoki), wyjście ucięte do limitu bajtów.

import { spawn } from "node:child_process";
import { childEnv } from "../env";

export type ProcResult = { code: number | null; signal: string | null; out: string; truncated: boolean; timedOut: boolean };

/** Zmienne, których polecenia bota nie dostają (klucze aplikacji, token serwera MCP). */
const HIDDEN = ["AW_CHAT_API_KEY", "AW_BOT_TOKEN", "AW_BOT_SOCKET"];

export function botEnv(base: Record<string, string | undefined> = process.env): Record<string, string> {
  const env = childEnv({}, base);
  for (const k of HIDDEN) delete env[k];
  return env;
}

function killGroup(pid: number | undefined, sig: NodeJS.Signals) {
  if (!pid) return;
  try {
    process.kill(-pid, sig);
  } catch {
    // grupa już nie istnieje
  }
}

/** stdout i stderr przeplecione w kolejności nadejścia. Abort/czas = SIGTERM, po 2 s SIGKILL. */
export function runProc(
  program: string,
  args: string[],
  opts: { cwd: string; timeoutMs: number; maxBytes: number; signal: AbortSignal; env?: Record<string, string> },
): Promise<ProcResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(program, args, { cwd: opts.cwd, env: opts.env ?? botEnv(), stdio: ["ignore", "pipe", "pipe"], detached: true });
    const chunks: Buffer[] = [];
    let size = 0;
    let truncated = false;
    let timedOut = false;
    let killTimer: ReturnType<typeof setTimeout> | undefined;
    const stop = () => {
      killGroup(child.pid, "SIGTERM");
      killTimer ??= setTimeout(() => killGroup(child.pid, "SIGKILL"), 2000);
    };
    const timer = setTimeout(() => {
      timedOut = true;
      stop();
    }, opts.timeoutMs);
    opts.signal.addEventListener("abort", stop, { once: true });
    const take = (d: Buffer) => {
      if (size >= opts.maxBytes) return void (truncated = true);
      const part = d.subarray(0, opts.maxBytes - size);
      if (part.length < d.length) truncated = true;
      chunks.push(part);
      size += part.length;
    };
    child.stdout.on("data", take);
    child.stderr.on("data", take);
    const done = () => {
      clearTimeout(timer);
      clearTimeout(killTimer);
      opts.signal.removeEventListener("abort", stop);
    };
    child.on("error", (e) => {
      done();
      reject(new Error(`nie uruchomiono \`${program}\`: ${e.message}`));
    });
    child.on("close", (code, signal) => {
      done();
      // powłoka skończyła, ale jej dzieci w tle mogą żyć dalej: sprzątamy grupę
      killGroup(child.pid, "SIGKILL");
      resolve({ code, signal, out: Buffer.concat(chunks).toString("utf8"), truncated, timedOut });
    });
  });
}
