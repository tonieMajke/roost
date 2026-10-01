import { beforeEach, describe, expect, it } from "vitest";
import { mockGitBackend as g, resetMockGit } from "./git-mock";
import { parseDiff } from "./git";

beforeEach(resetMockGit);

describe("mock gita (podgląd)", () => {
  it("status ma staged, zmiany, nieśledzony i usunięty", async () => {
    const s = (await g.gitStatus(""))!;
    const by = (p: string) => s.entries.find((e) => e.path === p);
    expect(by("src/App.tsx")).toMatchObject({ index: "M", worktree: "." });
    expect(by("README.md")).toMatchObject({ index: ".", worktree: "M" });
    expect(by("docs/plan.md")).toMatchObject({ index: "M", worktree: "M" });
    expect(by("src/nowy plik.ts")).toMatchObject({ kind: "untracked" });
    expect(by("stary.txt")).toMatchObject({ worktree: "D" });
  });
  it("stage, commit i push zmieniają stan; diff się parsuje", async () => {
    const d = parseDiff(await g.gitDiff("", "README.md", "unstaged"));
    expect(d.added).toBeGreaterThan(0);
    await g.gitStage("", ["README.md"]);
    await g.gitCommit("", "x");
    expect((await g.gitStatus(""))!.branch.ahead).toBe(3);
    await g.gitSync("", "push");
    expect((await g.gitStatus(""))!.branch.ahead).toBe(0);
  });
  it("discard nieśledzonego usuwa go z listy, zmiany wracają do indeksu", async () => {
    await g.gitDiscard("", ["README.md"], ["src/nowy plik.ts"]);
    expect(await g.gitFiles("")).not.toContain("src/nowy plik.ts");
    expect((await g.gitStatus(""))!.entries.find((e) => e.path === "README.md")).toBeUndefined();
  });
});
