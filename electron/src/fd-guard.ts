//! Dzieci bez cudzych deskryptorów. Chromium otwiera pliki z zamontowanego AppImage (`app.asar`,
//! `icudtl.dat`, `*.pak`, `v8_context_snapshot.bin`) bez O_CLOEXEC, a na Linuksie ani node-pty (forkpty
//! + execvp), ani libuv (`child_process`) nie zamykają przed exec reszty deskryptorów. Każdy agent
//! trzymałby więc otwarte pliki z montowania AppImage – po aktualizacji także starej wersji, której
//! montowanie i proces FUSE przez to nie znikają.
//!
//! Strażnik: dziecko startuje jako ten sam program w trybie node (`ELECTRON_RUN_AS_NODE`; w testach
//! zwykły node), zamyka deskryptory ≥ 3 bez O_CLOEXEC i przez `execve` staje się właściwym programem.
//! Pid, grupa procesów, terminal sterujący, stdin/stdout/stderr i katalog roboczy zostają.
//! Wymaga bezpiecznika `runAsNode` (electron/package.json) i Node z `process.execve` (≥ 22.15).

import fs from "node:fs";
import path from "node:path";
import { hasDir, needsFdGuard, resolveCommand, spawnPlan, type SpawnPlan } from "./platform";

/**
 * Kod strażnika (`-e`); argumenty: plik programu, argv[0], reszta argumentów.
 * Zamyka tylko deskryptory bez O_CLOEXEC (flaga 02000000 w `/proc/self/fdinfo`): własne deskryptory
 * node/libuv mają ją ustawioną, więc pętla zdarzeń działa do samego `execve`. Odziedziczone liczby
 * są zajęte od startu procesu, więc nic własnego nie dostało ich numerów.
 */
export const FD_GUARD_JS = `"use strict";
const fs = require("fs");
const [file, ...argv] = process.argv.slice(1);
delete process.env.ELECTRON_RUN_AS_NODE;
let fds = [];
try { fds = fs.readdirSync("/proc/self/fd").map(Number).filter((fd) => fd > 2); } catch {}
for (const fd of fds) {
  try {
    const m = /^flags:\\s*([0-7]+)/m.exec(fs.readFileSync("/proc/self/fdinfo/" + fd, "latin1"));
    if (m && (parseInt(m[1], 8) & 0o2000000) === 0) fs.closeSync(fd);
  } catch {}
}
try {
  process.execve(file, argv, process.env);
} catch (e) {
  process.stderr.write(argv[0] + ": " + (e && e.message) + "\\n");
  process.exit(126);
}
`;

export type GuardOpts = {
  platform?: NodeJS.Platform;
  cwd?: string;
  execPath?: string;
  exists?: (file: string) => boolean;
  /** Czy jądro uruchomi plik samo; domyślnie `directExec`. */
  direct?: (file: string) => boolean;
};

/** ELF albo skrypt z `#!` i istniejącym interpreterem. Resztę (skrypt bez `#!`, formaty binfmt_misc)
 *  execvp obsługuje sam (np. przez /bin/sh); takie programy startują bez strażnika. Nieudany `execve`
 *  w Node 24 (Electron) kończy proces abortem zamiast wyjątku, więc strażnik dostaje tylko pliki,
 *  które jądro na pewno uruchomi. */
export function directExec(file: string, exists: (file: string) => boolean = (f) => resolveCommand(f) !== null): boolean {
  let head: string;
  let fd: number | undefined;
  try {
    fd = fs.openSync(file, "r");
    const buf = Buffer.alloc(256);
    head = buf.subarray(0, fs.readSync(fd, buf, 0, buf.length, 0)).toString("latin1");
  } catch {
    return false;
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
  }
  if (head.startsWith("\x7fELF")) return true;
  const interp = /^#!\s*(\S+)/.exec(head)?.[1];
  return interp !== undefined && interp.startsWith("/") && exists(interp);
}

/**
 * `command args` uruchomione przez strażnika; `env` to środowisko dla `spawn`/node-pty (dla strażnika,
 * który oddaje je programowi bez `ELECTRON_RUN_AS_NODE`). Bez zmian: poza Linuksem, gdy programu
 * nie ma (błąd ENOENT zgłasza jak dotąd `spawn`), gdy jądro mogłoby go nie uruchomić (`directExec`) i gdy
 * `env` już ma `ELECTRON_RUN_AS_NODE` (strażnik nie odróżniłby go od swojego).
 */
export function guardFds(
  command: string,
  args: string[],
  env: Record<string, string>,
  opts: GuardOpts = {},
): { command: string; args: string[]; env: Record<string, string> } {
  const platform = opts.platform ?? process.platform;
  const same = { command, args, env };
  if (!needsFdGuard(platform) || "ELECTRON_RUN_AS_NODE" in env) return same;
  // Ścieżkę względną program dostałby względem swojego katalogu roboczego, nie naszego.
  const target = hasDir(command, platform) ? path.posix.resolve(opts.cwd || process.cwd(), command) : command;
  const file = resolveCommand(target, { platform, env, exists: opts.exists });
  if (!file || !(opts.direct ?? directExec)(file)) return same;
  return {
    command: opts.execPath ?? process.execPath,
    args: ["--no-warnings", "-e", FD_GUARD_JS, "--", file, command, ...args],
    env: { ...env, ELECTRON_RUN_AS_NODE: "1" },
  };
}

/** `spawnPlan` (Windows: shimy npm, cmd.exe) plus strażnik deskryptorów. Do `spawn` idą `command`,
 *  `args` i `env` z wyniku – `env` strażnika różni się od podanego. */
export function execPlan(command: string, args: string[], env: Record<string, string>, opts: GuardOpts = {}): SpawnPlan & { env: Record<string, string> } {
  const plan = spawnPlan(command, args, { env, platform: opts.platform });
  return { ...guardFds(plan.command, plan.args, env, opts), verbatim: plan.verbatim };
}
