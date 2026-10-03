//! Polecenie bota (`bash`, `rg`) jako proces we własnej grupie: limit czasu i Stop zabijają
//! całą grupę (też dzieci powłoki), wyjście ucięte do limitu bajtów.

import { spawn } from "node:child_process";
import { DEFAULT_PROVIDERS } from "../../../src/chat";
import { childEnv } from "../env";
import { execPlan } from "../fd-guard";
import { groupSpawn, releaseAfterExit, signalTree } from "../platform";

const DEFAULT_KEY_ENVS = DEFAULT_PROVIDERS.flatMap((p) => (p.keyEnv ? [p.keyEnv] : []));

export type ProcResult = { code: number | null; signal: string | null; out: string; truncated: boolean; timedOut: boolean };

/** Zmienne, których polecenia bota nie dostają (klucze aplikacji, token serwera MCP). */
const HIDDEN = ["AW_CHAT_API_KEY", "AW_BOT_TOKEN", "AW_BOT_SOCKET", "SSH_AUTH_SOCK", "GPG_AGENT_INFO"];
const HIDDEN_PREFIXES = ["AWS_", "AZURE_"];
/** Nazwy sekretów jako całe segmenty rozdzielone `_`: `GITHUB_TOKEN`, `X_API_KEY`, `DB_PASSWORD`,
 *  `GOOGLE_APPLICATION_CREDENTIALS`; nie łapie `TOKENIZERS_PARALLELISM` ani `KEYBOARD_LAYOUT`. */
const SECRET_NAME = /(^|_)(API_?KEY|SECRET|TOKEN|PASSWORD|PASSWD|CREDENTIALS?)(_|$)/i;

/** Czysta kopia środowiska bez sekretów. `extraHidden`: `keyEnv` dostawców o nazwach spoza wzorca. */
export function stripSecrets(base: Record<string, string>, extraHidden: readonly string[] = []): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(base)) {
    if (HIDDEN.includes(k) || extraHidden.includes(k) || HIDDEN_PREFIXES.some((p) => k.startsWith(p)) || SECRET_NAME.test(k)) continue;
    env[k] = v;
  }
  return env;
}

/** Środowisko narzędzia `bash`/`rg` bota: bez sekretów. Procesy CLI agenta (claude/codex, chat/cli.ts) używają
 *  `childEnv` bez filtra, bo potrzebują własnych kluczy; filtr dotyczy tylko poleceń uruchamianych na zgodę. */
export function botEnv(base: Record<string, string | undefined> = process.env, extraHidden: readonly string[] = DEFAULT_KEY_ENVS): Record<string, string> {
  return stripSecrets(childEnv({}, base), extraHidden);
}

/** Sygnał do całej grupy procesu (spawn z `detached: true`), więc dochodzi też do wnuków.
 *  Na Windows każdy sygnał zabija drzewo procesów (`taskkill /T /F`). */
export function killGroup(pid: number | undefined, sig: NodeJS.Signals) {
  if (pid) signalTree(pid, sig);
}

/** stdout i stderr przeplecione w kolejności nadejścia. Abort/czas = SIGTERM, po 2 s SIGKILL. */
export function runProc(
  program: string,
  args: string[],
  opts: { cwd: string; timeoutMs: number; maxBytes: number; signal: AbortSignal; env?: Record<string, string> },
): Promise<ProcResult> {
  return new Promise((resolve, reject) => {
    const env = opts.env ?? botEnv();
    const plan = execPlan(program, args, env, { cwd: opts.cwd });
    const child = spawn(plan.command, plan.args, { cwd: opts.cwd, env: plan.env, stdio: ["ignore", "pipe", "pipe"], detached: groupSpawn(), windowsHide: true, windowsVerbatimArguments: plan.verbatim });
    const chunks: Buffer[] = [];
    let size = 0;
    let truncated = false;
    let timedOut = false;
    let killTimer: ReturnType<typeof setTimeout> | undefined;
    const stop = () => {
      killGroup(child.pid, "SIGTERM");
      releaseAfterExit(child);
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
