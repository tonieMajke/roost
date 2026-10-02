//! Procesy agentów w pseudoterminalach. Każdy jest liderem sesji (node-pty woła setsid),
//! więc jego pid to też grupa procesów i jeden sygnał do `-pid` dociera do wszystkiego, co uruchomił.
//! Na Windows (ConPTY) grup nie ma: `signalTree` zabija drzewo procesów przez `taskkill`.

import os from "node:os";
import * as nodePty from "node-pty";
import { childEnv, expand } from "./env";
import { signalTree, signalTreeSync, spawnPlan } from "./platform";

export type SpawnSpec = {
  command: string;
  args?: string[];
  cwd?: string | null;
  cols: number;
  rows: number;
  /** Dodatkowe zmienne dla dziecka, po usunięciu zmiennych aplikacji i TERM/COLORTERM. */
  env?: [string, string][];
};

export type ExitInfo = { code: number; signal: string | null };

/** Czas na posprzątanie po SIGHUP, zanim dostanie SIGKILL. */
const GRACE_MS = 1500;

const signalNames = new Map(Object.entries(os.constants.signals).map(([name, n]) => [n, name]));

/** SIGHUP do grupy (to robi zamknięcie okna terminala), SIGKILL dla tego, co zostało po `grace`. */
export function hangUp(pids: number[], grace = GRACE_MS): Promise<void> {
  // Tuż po spawn dziecko może jeszcze nie mieć setsid: wtedy `signalTree` trafia w sam pid,
  // inaczej panel zamknięty od razu przeżyłby.
  const alive = pids.filter((pid) => signalTree(pid, "SIGHUP"));
  if (alive.length === 0) return Promise.resolve();
  return new Promise((resolve) => {
    const until = Date.now() + grace;
    const check = () => {
      if (Date.now() < until && alive.some((pid) => signalTree(pid, 0))) return void setTimeout(check, 50);
      for (const pid of alive) signalTree(pid, "SIGKILL");
      resolve();
    };
    check();
  });
}

/** To samo synchronicznie: przy wyjściu z aplikacji nie ma już pętli zdarzeń, na którą można czekać. */
export function hangUpSync(pids: number[], grace = GRACE_MS): void {
  const alive = pids.filter((pid) => signalTreeSync(pid, "SIGHUP"));
  const until = Date.now() + grace;
  const pause = new Int32Array(new SharedArrayBuffer(4));
  while (Date.now() < until && alive.some((pid) => signalTreeSync(pid, 0))) Atomics.wait(pause, 0, 0, 50);
  for (const pid of alive) signalTreeSync(pid, "SIGKILL");
}

export class Ptys {
  private map = new Map<number, nodePty.IPty>();
  private next = 0;

  /** `onData` dostaje surowe bajty, `onExit` raz, gdy dziecko się skończy. */
  spawn(spec: SpawnSpec, onData: (chunk: Uint8Array) => void, onExit: (info: ExitInfo) => void): number {
    const cwd = spec.cwd ? expand(spec.cwd) : "";
    const extra: Record<string, string> = { TERM: "xterm-256color", COLORTERM: "truecolor" };
    for (const [key, value] of spec.env ?? []) extra[expand(key)] = expand(value);
    const env = childEnv(extra);
    let proc: nodePty.IPty;
    try {
      // Windows: `codex.cmd` z npm → node + skrypt, inny `.cmd` → cmd.exe (gotowa linia poleceń).
      const plan = spawnPlan(expand(spec.command), (spec.args ?? []).map(expand), { env });
      proc = nodePty.spawn(plan.command, plan.verbatim ? plan.args.join(" ") : plan.args, {
        name: "xterm-256color",
        cols: Math.max(1, spec.cols),
        rows: Math.max(1, spec.rows),
        cwd: cwd || expand("~"),
        env,
        encoding: null, // surowe bajty: dekoduje xterm.js
      });
    } catch (e) {
      throw new Error(`${spec.command}: ${e instanceof Error ? e.message : String(e)}`);
    }
    const id = ++this.next;
    this.map.set(id, proc);
    // Na Windows node-pty ignoruje `encoding: null` i zawsze oddaje tekst; strona chce bajtów.
    proc.onData((chunk: string | Uint8Array) => onData(typeof chunk === "string" ? Buffer.from(chunk, "utf8") : chunk));
    proc.onExit(({ exitCode, signal }) => {
      // Usunięte przed zgłoszeniem, żeby późniejsze kill nie trafiło w ponownie użyty pid.
      this.map.delete(id);
      onExit({ code: exitCode, signal: signal ? (signalNames.get(signal) ?? String(signal)) : null });
    });
    return id;
  }

  write(id: number, data: string): void {
    const proc = this.map.get(id);
    if (!proc) throw new Error("no such terminal");
    proc.write(data);
  }

  resize(id: number, cols: number, rows: number): void {
    const proc = this.map.get(id);
    if (!proc) throw new Error("no such terminal");
    proc.resize(Math.max(1, cols), Math.max(1, rows));
  }

  /** Asynchronicznie: SIGHUP do grupy teraz, SIGKILL dla maruderów po czasie. */
  kill(id: number): void {
    const proc = this.map.get(id);
    if (proc) void hangUp([proc.pid]);
  }

  pid(id: number): number | undefined {
    return this.map.get(id)?.pid;
  }

  /** Rozłącza wszystkich agentów; przy wyjściu z aplikacji. */
  killAll(): void {
    hangUpSync(this.takeAll());
  }

  /** Jak `killAll`, ale bez czekania (przeładowanie strony). */
  killAllAsync(): void {
    void hangUp(this.takeAll());
  }

  private takeAll(): number[] {
    const pids = [...this.map.values()].map((p) => p.pid);
    this.map.clear();
    return pids;
  }
}
