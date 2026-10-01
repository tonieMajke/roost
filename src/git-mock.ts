/** Panel plików z gitem w podglądzie (`pnpm dev`): jedno udawane repozytorium w pamięci. */

import type { Backend } from "./backend";
import type { DiffMode, GitBranch, GitCode, GitEntry, GitStatus } from "./git";

type File = { head?: string; index?: string; work?: string };

const initial = (): Map<string, File> =>
  new Map<string, File>([
    ["README.md", { head: "# Agents\n\nPanel agentów.\n", index: "# Agents\n\nPanel agentów.\n", work: "# Agents workspace\n\nPanel agentów CLI.\n" }],
    ["src/App.tsx", { head: "const a = 1;\nconst b = 2;\n", index: "const a = 1;\nconst b = 3;\n", work: "const a = 1;\nconst b = 3;\n" }],
    ["src/git.ts", { head: "export {};\n", index: "export {};\n", work: "export {};\n" }],
    ["src/nowy plik.ts", { work: "export const x = 1;\n" }],
    ["docs/plan.md", { head: "- [ ] etap 1\n", index: "- [x] etap 1\n", work: "- [x] etap 1\n- [ ] etap 2\n" }],
    ["docs/zażółć gęślą.md", { head: "a\n", index: "a\n", work: "a\n" }],
    ["stary.txt", { head: "do usunięcia\n", index: "do usunięcia\n" }],
    ["package.json", { head: "{}\n", index: "{}\n", work: "{}\n" }],
  ]);

let files = initial();
let branch: GitBranch = { head: "glowny", oid: "3f2a9c1d4e5f6071", upstream: "origin/glowny", ahead: 2, behind: 1 };
let commits = 0;

const same = (a?: string, b?: string) => a === b;
function indexCode(f: File): GitCode {
  if (f.head === undefined && f.index === undefined) return ".";
  if (f.head === undefined) return "A";
  if (f.index === undefined) return "D";
  return same(f.head, f.index) ? "." : "M";
}
function workCode(f: File): GitCode {
  if (f.index === undefined) return f.work === undefined ? "." : "?";
  if (f.work === undefined) return "D";
  return same(f.index, f.work) ? "." : "M";
}

function status(): GitStatus {
  const entries: GitEntry[] = [];
  for (const [path, f] of files) {
    const index = indexCode(f);
    const worktree = workCode(f);
    if (index === "." && worktree === ".") continue;
    if (worktree === "?" && index === ".") entries.push({ path, kind: "untracked", index: ".", worktree: "?" });
    else entries.push({ path, kind: "ordinary", index, worktree: worktree === "?" ? "." : worktree });
  }
  return { branch: { ...branch }, entries };
}

const lines = (s: string | undefined) => (s === undefined || s === "" ? [] : s.replace(/\n$/, "").split("\n"));

/** Jeden hunk: wspólny początek i koniec jako kontekst, środek jako zmiana. */
function diff(path: string, a: string | undefined, b: string | undefined): string {
  const x = lines(a);
  const y = lines(b);
  let p = 0;
  while (p < x.length && p < y.length && x[p] === y[p]) p++;
  let s = 0;
  while (s < x.length - p && s < y.length - p && x[x.length - 1 - s] === y[y.length - 1 - s]) s++;
  const ctxBefore = x.slice(Math.max(0, p - 3), p);
  const ctxAfter = x.slice(x.length - s, x.length - s + 3);
  const del = x.slice(p, x.length - s);
  const add = y.slice(p, y.length - s);
  const start = p - ctxBefore.length + 1;
  const oldN = ctxBefore.length + del.length + ctxAfter.length;
  const newN = ctxBefore.length + add.length + ctxAfter.length;
  return [
    `diff --git a/${path} b/${path}`,
    a === undefined ? "new file mode 100644" : "index 1111111..2222222 100644",
    `--- ${a === undefined ? "/dev/null" : `a/${path}`}`,
    `+++ ${b === undefined ? "/dev/null" : `b/${path}`}`,
    `@@ -${start},${oldN} +${start},${newN} @@`,
    ...ctxBefore.map((l) => ` ${l}`),
    ...del.map((l) => `-${l}`),
    ...add.map((l) => `+${l}`),
    ...ctxAfter.map((l) => ` ${l}`),
    "",
  ].join("\n");
}

const delay = () => new Promise((r) => setTimeout(r, 120));

export const mockGitBackend: Pick<Backend, "gitStatus" | "gitFiles" | "gitDiff" | "gitStage" | "gitUnstage" | "gitDiscard" | "gitCommit" | "gitSync"> = {
  async gitStatus() {
    return status();
  },
  async gitFiles() {
    return [...files].filter(([, f]) => f.index !== undefined || f.work !== undefined).map(([p]) => p);
  },
  async gitDiff(_cwd, path, mode: DiffMode) {
    const f = files.get(path);
    if (!f) return "";
    if (mode === "staged") return diff(path, f.head, f.index);
    if (mode === "untracked") return diff(path, undefined, f.work);
    return diff(path, f.index, f.work);
  },
  async gitStage(_cwd, paths) {
    for (const p of paths) {
      const f = files.get(p);
      if (f) f.index = f.work;
    }
  },
  async gitUnstage(_cwd, paths) {
    for (const p of paths) {
      const f = files.get(p);
      if (f) f.index = f.head;
    }
  },
  async gitDiscard(_cwd, tracked, untracked) {
    for (const p of tracked) {
      const f = files.get(p);
      if (f) f.work = f.index;
    }
    for (const p of untracked) {
      const f = files.get(p);
      if (f) {
        f.work = undefined;
        if (f.head === undefined && f.index === undefined) files.delete(p);
      }
    }
  },
  async gitCommit(_cwd, message) {
    if (message.trim() === "") throw new Error("Pusty komunikat");
    if (![...files.values()].some((f) => indexCode(f) !== ".")) throw new Error("nothing to commit");
    for (const [p, f] of files) {
      f.head = f.index;
      if (f.head === undefined && f.work === undefined) files.delete(p);
    }
    commits++;
    branch = { ...branch, ahead: branch.ahead + 1 };
    return `[glowny ${(0xabc100 + commits).toString(16)}] ${message.split("\n")[0]}`;
  },
  async gitSync(_cwd, op) {
    await delay();
    if (op === "pull") {
      if (branch.ahead > 0 && branch.behind > 0) throw new Error("fatal: Not possible to fast-forward, aborting.");
      branch = { ...branch, behind: 0 };
      return "Fast-forward";
    }
    branch = { ...branch, ahead: 0 };
    return "glowny -> glowny";
  },
};

/** Test: przywraca stan początkowy. */
export function resetMockGit() {
  files = initial();
  branch = { head: "glowny", oid: "3f2a9c1d4e5f6071", upstream: "origin/glowny", ahead: 2, behind: 1 };
  commits = 0;
}
