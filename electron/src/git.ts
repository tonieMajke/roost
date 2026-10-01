//! Panel plików z gitem: uruchamianie gita (spawn z tablicą argumentów, bez powłoki).
//! Parsowanie i reguły są w `src/git.ts`; tu tylko wejście/wyjście.

import { t } from "./i18n";
import fs from "node:fs";
import { spawn } from "node:child_process";
import { childEnv, expand } from "./env";
import { parseStatus, validRelPath, type GitStatus } from "../../src/git";

const LOCAL_MS = 15_000;
const NET_MS = 90_000;
const MAX_FILES = 50_000;
export const MAX_DIFF_BYTES = 1024 * 1024;
const MAX_OUT = 64 * 1024 * 1024;

export type RunOpts = { input?: string; okCodes?: number[]; timeoutMs?: number; maxBytes?: number };
export type RunResult = { code: number; stdout: string; stderr: string; truncated: boolean };

/** Środowisko: bez pytań o hasło, wyjście po angielsku (stabilne), ssh bez interakcji. */
export function gitEnv(base: Record<string, string | undefined> = process.env): Record<string, string> {
  const extra: Record<string, string> = { GIT_TERMINAL_PROMPT: "0", LC_ALL: "C" };
  if (!base.GIT_SSH_COMMAND && !base.GIT_SSH) extra.GIT_SSH_COMMAND = "ssh -o BatchMode=yes";
  return childEnv(extra, base);
}

/** Uruchamia `git args…` w `cwd`. Kod spoza `okCodes` (domyślnie 0) odrzuca komunikatem z stderr. */
export function runGit(cwd: string, args: string[], opts: RunOpts = {}): Promise<RunResult> {
  const { input, okCodes = [0], timeoutMs = LOCAL_MS, maxBytes = MAX_OUT } = opts;
  return new Promise((resolve, reject) => {
    const child = spawn("git", args, { cwd: expand(cwd), env: gitEnv(), stdio: ["pipe", "pipe", "pipe"] });
    const out: Buffer[] = [];
    const err: Buffer[] = [];
    let size = 0;
    let truncated = false;
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, timeoutMs);
    child.stdout.on("data", (b: Buffer) => {
      if (size >= maxBytes) return void (truncated = true);
      size += b.length;
      out.push(b);
      if (size > maxBytes) truncated = true;
    });
    child.stderr.on("data", (b: Buffer) => err.length < 256 && err.push(b));
    child.on("error", (e) => {
      clearTimeout(timer);
      reject(new Error((e as NodeJS.ErrnoException).code === "ENOENT" ? t("git.notFound") : String(e)));
    });
    child.stdin.on("error", () => {}); // git mógł zakończyć się, zanim przeczytał wejście
    child.stdin.end(input ?? "");
    child.on("close", (code) => {
      clearTimeout(timer);
      const stdout = Buffer.concat(out).toString("utf8");
      const stderr = Buffer.concat(err).toString("utf8").trim();
      if (timedOut) return reject(new Error(t("git.timeout", { cmd: args[0] })));
      const c = code ?? -1;
      if (!okCodes.includes(c)) return reject(new Error(stderr || stdout.trim() || t("git.code", { cmd: args[0], code: c })));
      resolve({ code: c, stdout: truncated ? stdout.slice(0, maxBytes) : stdout, stderr, truncated });
    });
  });
}

function checkPaths(paths: string[]): string[] {
  const bad = paths.find((p) => !validRelPath(p));
  if (bad !== undefined) throw new Error(t("git.badPath", { path: bad }));
  return paths;
}

/** `null` = katalog nie jest repozytorium (albo nie istnieje). */
export async function gitStatus(cwd: string): Promise<GitStatus | null> {
  try {
    if (!fs.statSync(expand(cwd)).isDirectory()) return null;
  } catch {
    return null;
  }
  try {
    await runGit(cwd, ["rev-parse", "--is-inside-work-tree"]);
  } catch (e) {
    if (/not a git repository/i.test(String(e))) return null;
    throw e;
  }
  const r = await runGit(cwd, ["--no-optional-locks", "status", "--porcelain=v2", "-z", "--branch", "-uall"]);
  return parseStatus(r.stdout);
}

/** Pliki śledzone i nieśledzone (bez ignorowanych), względne ścieżki. */
export async function gitFiles(cwd: string): Promise<string[]> {
  const r = await runGit(cwd, ["--no-optional-locks", "ls-files", "-z", "--cached", "--others", "--exclude-standard"]);
  return r.stdout.split("\0").filter((p) => p !== "").slice(0, MAX_FILES);
}

export type DiffMode = "staged" | "unstaged" | "untracked";

export async function gitDiff(cwd: string, path: string, mode: DiffMode): Promise<string> {
  checkPaths([path]);
  const base = ["--no-optional-locks", "diff", "--no-color", "--no-ext-diff"];
  const args =
    mode === "staged"
      ? [...base, "--cached", "--", path]
      : mode === "unstaged"
        ? [...base, "--", path]
        : [...base, "--no-index", "--", "/dev/null", path]; // kod 1 = są różnice
  const r = await runGit(cwd, args, { okCodes: [0, 1], maxBytes: MAX_DIFF_BYTES });
  return r.truncated ? `${r.stdout}\n\\ ${t("git.diffCut", { kb: MAX_DIFF_BYTES / 1024 })}\n` : r.stdout;
}

export async function gitStage(cwd: string, paths: string[]): Promise<void> {
  if (paths.length === 0) return;
  await runGit(cwd, ["add", "-A", "--", ...checkPaths(paths)]);
}

/** `reset -- ścieżki` działa też w repozytorium bez commitów (w odróżnieniu od `restore --staged`). */
export async function gitUnstage(cwd: string, paths: string[]): Promise<void> {
  if (paths.length === 0) return;
  await runGit(cwd, ["reset", "-q", "--", ...checkPaths(paths)]);
}

/** Destrukcyjne: `tracked` wraca do stanu z indeksu, `untracked` jest usuwane z dysku. Zgodę zbiera UI. */
export async function gitDiscard(cwd: string, tracked: string[], untracked: string[]): Promise<void> {
  checkPaths([...tracked, ...untracked]);
  if (tracked.length > 0) await runGit(cwd, ["restore", "--worktree", "--", ...tracked]);
  // `clean` bez -d i -x: tylko wskazane pliki nieśledzone, nie ignorowane.
  if (untracked.length > 0) await runGit(cwd, ["clean", "-f", "-q", "--", ...untracked]);
}

/** Zwraca pierwszą linię wyniku (np. „[main 3f2a9c1] komunikat”). */
export async function gitCommit(cwd: string, message: string): Promise<string> {
  if (message.trim() === "") throw new Error(t("git.emptyMsg"));
  const r = await runGit(cwd, ["commit", "-F", "-"], { input: message });
  return r.stdout.split("\n")[0] ?? "";
}

/** Pull tylko fast-forward; push bez force, a bez upstreamu z `-u origin HEAD`. */
export async function gitSync(cwd: string, op: "pull" | "push"): Promise<string> {
  if (op === "pull") {
    const r = await runGit(cwd, ["pull", "--ff-only"], { timeoutMs: NET_MS });
    return lastLine(r.stdout) || lastLine(r.stderr) || t("git.done");
  }
  const up = await runGit(cwd, ["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"], { okCodes: [0, 128] });
  const args = up.code === 0 ? ["push"] : ["push", "-u", "origin", "HEAD"];
  const r = await runGit(cwd, args, { timeoutMs: NET_MS });
  return lastLine(r.stderr) || lastLine(r.stdout) || t("git.done");
}

const lastLine = (s: string) => s.trim().split("\n").pop()?.trim() ?? "";
