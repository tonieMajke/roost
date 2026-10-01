import { describe, expect, it } from "vitest";
import {
  branchLabel,
  buildTree,
  canCommit,
  diffModeFor,
  dirsWithChanges,
  discardPlan,
  isStaged,
  isUnstaged,
  parseDiff,
  parseStatus,
  statusLetter,
  statusTone,
  syncLabel,
  unstagePaths,
  validRelPath,
  visibleRows,
  type GitEntry,
} from "./git";

const H = "1111111111111111111111111111111111111111";
const Z = (...parts: string[]) => parts.join("\0") + "\0";
const one = (xy: string, path: string) => `1 ${xy} N... 100644 100644 100644 ${H} ${H} ${path}`;

const FIXTURE = Z(
  "# branch.oid 3f2a9c1d4e5f60718293a4b5c6d7e8f901234567",
  "# branch.head glowny",
  "# branch.upstream origin/glowny",
  "# branch.ab +2 -1",
  one("M.", "src/a.ts"),
  one(".M", "src/b ze spacją.ts"),
  one("MM", "README.md"),
  one(".D", "stary.txt"),
  `2 R. N... 100644 100644 100644 ${H} ${H} R100 src/nowy.ts`,
  "src/dawny.ts",
  `u UU N... 100644 100644 100644 100644 ${H} ${H} ${H} konflikt.txt`,
  "? zażółć/gęślą.txt",
  "? nowy.md",
  "! dist/out.js",
);

describe("parseStatus", () => {
  const s = parseStatus(FIXTURE);
  const by = (p: string) => s.entries.find((e) => e.path === p);

  it("czyta nagłówek brancha", () => {
    expect(s.branch).toEqual({ head: "glowny", oid: "3f2a9c1d4e5f60718293a4b5c6d7e8f901234567", upstream: "origin/glowny", ahead: 2, behind: 1 });
  });
  it("czyta wpisy zwykłe z XY i ścieżkami ze spacjami", () => {
    expect(by("src/a.ts")).toMatchObject({ kind: "ordinary", index: "M", worktree: "." });
    expect(by("src/b ze spacją.ts")).toMatchObject({ index: ".", worktree: "M" });
    expect(by("README.md")).toMatchObject({ index: "M", worktree: "M" });
    expect(by("stary.txt")).toMatchObject({ worktree: "D" });
  });
  it("przeniesienie zabiera drugą ścieżkę po NUL i nie gubi następnych wpisów", () => {
    expect(by("src/nowy.ts")).toMatchObject({ kind: "renamed", orig: "src/dawny.ts", index: "R" });
    expect(by("konflikt.txt")).toMatchObject({ kind: "unmerged" });
    expect(s.entries).toHaveLength(9);
  });
  it("nieśledzone i ignorowane z polskimi literami", () => {
    expect(by("zażółć/gęślą.txt")).toMatchObject({ kind: "untracked", worktree: "?" });
    expect(by("dist/out.js")).toMatchObject({ kind: "ignored" });
  });
  it("odłączony HEAD, brak upstreamu i commitów", () => {
    const d = parseStatus(Z("# branch.oid abcdef1234567", "# branch.head (detached)"));
    expect(d.branch).toMatchObject({ head: null, oid: "abcdef1234567", upstream: null, ahead: 0, behind: 0 });
    const n = parseStatus(Z("# branch.oid (initial)", "# branch.head main"));
    expect(n.branch).toMatchObject({ head: "main", oid: null });
  });
  it("pusty status i śmieci", () => {
    expect(parseStatus("").entries).toEqual([]);
    expect(parseStatus(Z("x dziwny wiersz", "1 za krótki")).entries).toEqual([]);
  });
});

describe("flagi wpisów", () => {
  const e = (kind: GitEntry["kind"], index: GitEntry["index"], worktree: GitEntry["worktree"]): GitEntry => ({ path: "p", kind, index, worktree });
  it("staged / unstaged / oba", () => {
    expect([isStaged(e("ordinary", "M", ".")), isUnstaged(e("ordinary", "M", "."))]).toEqual([true, false]);
    expect([isStaged(e("ordinary", ".", "M")), isUnstaged(e("ordinary", ".", "M"))]).toEqual([false, true]);
    expect([isStaged(e("ordinary", "M", "M")), isUnstaged(e("ordinary", "M", "M"))]).toEqual([true, true]);
    expect([isStaged(e("untracked", ".", "?")), isUnstaged(e("untracked", ".", "?"))]).toEqual([false, true]);
    expect([isStaged(e("unmerged", "U", "U")), isUnstaged(e("unmerged", "U", "U"))]).toEqual([false, false]);
  });
  it("litera i ton", () => {
    expect(statusLetter(e("ordinary", "M", "D"))).toBe("D");
    expect(statusLetter(e("ordinary", "A", "."))).toBe("A");
    expect(statusTone(e("ordinary", "A", "."))).toBe("added");
    expect(statusTone(e("ordinary", ".", "D"))).toBe("deleted");
    expect(statusTone(e("untracked", ".", "?"))).toBe("untracked");
    expect(statusTone(e("unmerged", "U", "U"))).toBe("conflict");
  });
  it("discardPlan: zmiana w katalogu roboczym albo nieśledzony, reszta nic", () => {
    expect(discardPlan(e("ordinary", ".", "M"))).toBe("restore");
    expect(discardPlan(e("ordinary", "M", "M"))).toBe("restore");
    expect(discardPlan(e("untracked", ".", "?"))).toBe("clean");
    expect(discardPlan(e("ordinary", "M", "."))).toBeNull();
    expect(discardPlan(e("unmerged", "U", "U"))).toBeNull();
    expect(discardPlan(e("ignored", ".", "!"))).toBeNull();
  });
  it("unstage przeniesienia dotyczy obu ścieżek", () => {
    expect(unstagePaths({ path: "b", orig: "a", kind: "renamed", index: "R", worktree: "." })).toEqual(["b", "a"]);
    expect(unstagePaths({ path: "b", kind: "ordinary", index: "M", worktree: "." })).toEqual(["b"]);
  });
  it("diffModeFor", () => {
    expect(diffModeFor(undefined)).toBeNull();
    expect(diffModeFor(e("ordinary", ".", "."))).toBeNull();
    expect(diffModeFor(e("ordinary", "M", "M"))).toBe("unstaged");
    expect(diffModeFor(e("ordinary", "M", "M"), "staged")).toBe("staged");
    expect(diffModeFor(e("ordinary", "M", "."), "unstaged")).toBe("staged");
    expect(diffModeFor(e("untracked", ".", "?"))).toBe("untracked");
    expect(diffModeFor(e("ignored", ".", "!"))).toBeNull();
  });
});

describe("validRelPath", () => {
  it("przyjmuje względne, odrzuca resztę", () => {
    expect(validRelPath("src/a ą.ts")).toBe(true);
    expect(validRelPath("-rf")).toBe(true); // po `--` niegroźne
    for (const bad of ["", "/etc/passwd", "../x", "a/../b", "a//b", "a/", "./a", "a\0b"]) expect(validRelPath(bad)).toBe(false);
  });
});

describe("canCommit i etykiety", () => {
  const staged: GitEntry = { path: "a", kind: "ordinary", index: "M", worktree: "." };
  const conflict: GitEntry = { path: "c", kind: "unmerged", index: "U", worktree: "U" };
  it("powody odmowy", () => {
    expect(canCommit([staged], "  ")).toBe("Wpisz komunikat");
    expect(canCommit([], "x")).toBe("Nic w indeksie");
    expect(canCommit([staged, conflict], "x")).toBe("Rozwiąż konflikty");
    expect(canCommit([staged], "x")).toBeNull();
  });
  it("branchLabel i syncLabel", () => {
    const b = { head: "main", oid: "abc", upstream: "origin/main", ahead: 0, behind: 0 };
    expect(branchLabel(b)).toBe("main");
    expect(branchLabel({ ...b, head: null, oid: "1234567890" })).toBe("odłączony HEAD @ 1234567");
    expect(syncLabel(b)).toBe("zsynchronizowany");
    expect(syncLabel({ ...b, ahead: 2 })).toBe("↑2");
    expect(syncLabel({ ...b, ahead: 2, behind: 1 })).toBe("↑2 ↓1");
    expect(syncLabel({ ...b, upstream: null })).toBe("brak upstreamu");
  });
});

describe("parseDiff", () => {
  const DIFF = [
    "diff --git a/a.ts b/a.ts",
    "index 111..222 100644",
    "--- a/a.ts",
    "+++ b/a.ts",
    "@@ -3,4 +3,5 @@ function x() {",
    " keep",
    "-old",
    "+new",
    "+another",
    " tail",
    "\\ No newline at end of file",
    "@@ -20 +21 @@",
    "-- zaczyna się od myślnika",
    "++ plus",
    "",
  ].join("\n");
  const d = parseDiff(DIFF);
  it("numeruje linie i liczy zmiany", () => {
    expect(d.added).toBe(3);
    expect(d.removed).toBe(2);
    const l = d.lines;
    expect(l[0].kind).toBe("meta");
    expect(l[2]).toMatchObject({ kind: "meta", text: "--- a/a.ts" });
    expect(l[4].kind).toBe("hunk");
    expect(l[5]).toMatchObject({ kind: "ctx", text: "keep", oldNo: 3, newNo: 3 });
    expect(l[6]).toMatchObject({ kind: "del", text: "old", oldNo: 4 });
    expect(l[7]).toMatchObject({ kind: "add", text: "new", newNo: 4 });
    expect(l[8]).toMatchObject({ kind: "add", newNo: 5 });
    expect(l[9]).toMatchObject({ kind: "ctx", oldNo: 5, newNo: 6 });
    expect(l[10].kind).toBe("note");
  });
  it("linie zaczynające się od --- i +++ wewnątrz hunka to zmiany, nie nagłówki", () => {
    expect(d.lines[12]).toMatchObject({ kind: "del", text: "- zaczyna się od myślnika", oldNo: 20 });
    expect(d.lines[13]).toMatchObject({ kind: "add", text: "+ plus", newNo: 21 });
  });
  it("plik binarny", () => {
    const b = parseDiff("diff --git a/x.png b/x.png\nindex 1..2 100644\nBinary files a/x.png and b/x.png differ\n");
    expect(b.binary).toBe(true);
    expect(b.added + b.removed).toBe(0);
  });
  it("pusty diff", () => {
    expect(parseDiff("")).toEqual({ lines: [], binary: false, added: 0, removed: 0 });
  });
});

describe("drzewo", () => {
  const entries = parseStatus(FIXTURE).entries;
  const paths = ["README.md", "src/a.ts", "src/b ze spacją.ts", "src/dawny.ts", "src/c.ts", "konflikt.txt", "stary.txt", "zażółć/gęślą.txt", "nowy.md", "docs/x.md"];
  const tree = buildTree(paths, entries);

  it("katalogi przed plikami, polskie sortowanie, agregat zmian", () => {
    expect(tree.children.map((c) => c.name)).toEqual(["docs", "src", "zażółć", "konflikt.txt", "nowy.md", "README.md", "stary.txt"]);
    const src = tree.children.find((c) => c.name === "src")!;
    expect(src.children.map((c) => c.name)).toEqual(["a.ts", "b ze spacją.ts", "c.ts", "dawny.ts", "nowy.ts"]);
    expect(src.changed).toBe(3); // a, b, nowy (dawny nie ma wpisu pod swoją ścieżką)
    expect(tree.children.find((c) => c.name === "docs")!.changed).toBe(0);
  });
  it("wpis spoza listy plików (np. przeniesiony) trafia do drzewa", () => {
    const names = tree.children.find((c) => c.name === "src")!.children.map((c) => c.name);
    expect(names).toContain("nowy.ts");
  });
  it("visibleRows: zwinięte, rozwinięte, tylko zmienione", () => {
    expect(visibleRows(tree, new Set()).map((r) => r.node.path)).toEqual(["docs", "src", "zażółć", "konflikt.txt", "nowy.md", "README.md", "stary.txt"]);
    const open = visibleRows(tree, new Set(["src"]));
    expect(open.filter((r) => r.depth === 1)).toHaveLength(5);
    const changed = visibleRows(tree, new Set(), true).map((r) => r.node.path);
    expect(changed).not.toContain("docs");
    expect(changed).not.toContain("docs/x.md");
    expect(changed).toContain("src/a.ts");
    expect(changed).not.toContain("src/c.ts");
  });
  it("dirsWithChanges pomija ignorowane", () => {
    expect([...dirsWithChanges(entries)].sort()).toEqual(["src", "zażółć"]);
  });
  it("nieprawidłowe ścieżki są pomijane", () => {
    expect(buildTree(["../x", "/abs", "ok.txt"], []).children.map((c) => c.name)).toEqual(["ok.txt"]);
  });
});
