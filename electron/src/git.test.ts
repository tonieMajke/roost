import { afterAll, beforeAll, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { GIT_SAFE_ARGS, gitCommit, gitDiff, gitDiscard, gitEnv, gitFiles, gitStage, gitStatus, gitSync, gitUnstage, runGit } from "./git";

// Prawdziwy git na katalogach tymczasowych; konfiguracja użytkownika nie bierze udziału.
const saved: Record<string, string | undefined> = {};
const ENV: Record<string, string> = {
  GIT_CONFIG_GLOBAL: "/dev/null",
  GIT_CONFIG_NOSYSTEM: "1",
  GIT_AUTHOR_NAME: "Test",
  GIT_AUTHOR_EMAIL: "t@example.com",
  GIT_COMMITTER_NAME: "Test",
  GIT_COMMITTER_EMAIL: "t@example.com",
};
let root: string;
let repo: string;
let remote: string;
let other: string;
const w = (rel: string, text: string, dir = repo) => {
  const f = path.join(dir, rel);
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, text);
};
const r = (rel: string, dir = repo) => fs.readFileSync(path.join(dir, rel), "utf8");
const st = async (dir = repo) => (await gitStatus(dir))!;
const entry = async (p: string) => (await st()).entries.find((e) => e.path === p);

beforeAll(async () => {
  for (const k of Object.keys(ENV)) saved[k] = process.env[k];
  Object.assign(process.env, ENV);
  root = fs.mkdtempSync(path.join(os.tmpdir(), "aw-git-"));
  repo = path.join(root, "repo");
  remote = path.join(root, "remote.git");
  other = path.join(root, "other");
  fs.mkdirSync(repo);
  await runGit(root, ["init", "-q", "--bare", "-b", "main", remote]);
  await runGit(repo, ["init", "-q", "-b", "main"]);
});
afterAll(() => {
  for (const [k, v] of Object.entries(saved)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  fs.rmSync(root, { recursive: true, force: true });
});

describe("git (prawdziwe repozytorium)", () => {
  it("katalog bez repozytorium i nieistniejący = null", async () => {
    const plain = fs.mkdtempSync(path.join(root, "plain-"));
    expect(await gitStatus(plain)).toBeNull();
    expect(await gitStatus(path.join(root, "nie-ma"))).toBeNull();
  });

  it("repozytorium bez commitów: status, stage, unstage (reset działa bez HEAD)", async () => {
    w("zażółć gęślą.txt", "a\n");
    w("src/a.ts", "export const a = 1;\n");
    let s = await st();
    expect(s.branch).toMatchObject({ head: "main", oid: null, upstream: null });
    expect(s.entries.map((e) => e.kind)).toEqual(["untracked", "untracked"]);
    await gitStage(repo, ["zażółć gęślą.txt", "src/a.ts"]);
    expect(await entry("src/a.ts")).toMatchObject({ index: "A", worktree: "." });
    await gitUnstage(repo, ["src/a.ts"]);
    expect(await entry("src/a.ts")).toMatchObject({ kind: "untracked" });
    await gitStage(repo, ["src/a.ts"]);
    s = await st();
    expect(s.entries.every((e) => e.index === "A")).toBe(true);
  });

  it("commit z komunikatem ze stdin (znaki specjalne, wiele linii)", async () => {
    const msg = "Pierwszy: zażółć \"cytat\" $(nie wykonuj)\n\n- punkt `a`\n";
    const line = await gitCommit(repo, msg);
    expect(line).toMatch(/^\[main \(root-commit\) [0-9a-f]+\]/);
    expect((await runGit(repo, ["log", "-1", "--format=%B"])).stdout.trim()).toBe(msg.trim());
    expect((await st()).entries).toEqual([]);
    await expect(gitCommit(repo, "x")).rejects.toThrow(/nothing to commit/);
    await expect(gitCommit(repo, "  ")).rejects.toThrow("Pusty komunikat");
  });

  it("diff: niezatwierdzony, staged i nieśledzony", async () => {
    w("src/a.ts", "export const a = 2;\n");
    expect(await gitDiff(repo, "src/a.ts", "unstaged")).toContain("+export const a = 2;");
    expect(await gitDiff(repo, "src/a.ts", "staged")).toBe("");
    await gitStage(repo, ["src/a.ts"]);
    expect(await gitDiff(repo, "src/a.ts", "staged")).toContain("-export const a = 1;");
    w("nowy plik.md", "# hej\n");
    const untracked = await gitDiff(repo, "nowy plik.md", "untracked");
    expect(untracked).toContain("new file mode");
    expect(untracked).toContain("+# hej");
    await gitUnstage(repo, ["src/a.ts"]);
  });

  it("lista plików: śledzone i nieśledzone, bez ignorowanych", async () => {
    w(".gitignore", "dist/\n");
    w("dist/out.js", "x");
    const files = await gitFiles(repo);
    expect(files).toContain("src/a.ts");
    expect(files).toContain("nowy plik.md");
    expect(files).not.toContain("dist/out.js");
  });

  it("discard: zmiana śledzonego wraca do indeksu, nieśledzony znika, reszta stoi", async () => {
    // a.ts: zmieniony w katalogu roboczym (po unstage); dodaj też zmianę staged w innym pliku
    w("staged.txt", "v1\n");
    await gitStage(repo, ["staged.txt", ".gitignore"]);
    await gitCommit(repo, "dodaj staged");
    w("staged.txt", "v2\n");
    await gitStage(repo, ["staged.txt"]);
    w("staged.txt", "v3\n"); // staged v2 + zmiana v3 w katalogu roboczym
    await gitDiscard(repo, ["src/a.ts", "staged.txt"], ["nowy plik.md"]);
    expect(r("src/a.ts")).toBe("export const a = 1;\n");
    expect(r("staged.txt")).toBe("v2\n"); // wrócił do indeksu, nie do HEAD
    expect(fs.existsSync(path.join(repo, "nowy plik.md"))).toBe(false);
    expect(fs.existsSync(path.join(repo, "dist/out.js"))).toBe(true); // ignorowany nietknięty
    expect(await entry("staged.txt")).toMatchObject({ index: "M", worktree: "." });
  });

  it("usunięty plik wraca po discard", async () => {
    fs.rmSync(path.join(repo, "src/a.ts"));
    expect(await entry("src/a.ts")).toMatchObject({ worktree: "D" });
    await gitDiscard(repo, ["src/a.ts"], []);
    expect(r("src/a.ts")).toBe("export const a = 1;\n");
  });

  it("przeniesienie: status z oryginalną ścieżką, unstage obu ścieżek", async () => {
    await runGit(repo, ["mv", "src/a.ts", "src/b.ts"]);
    expect(await entry("src/b.ts")).toMatchObject({ kind: "renamed", orig: "src/a.ts", index: "R" });
    await gitUnstage(repo, ["src/b.ts", "src/a.ts"]);
    expect(fs.existsSync(path.join(repo, "src/b.ts"))).toBe(true);
    expect(await entry("src/b.ts")).toMatchObject({ kind: "untracked" });
    expect(await entry("src/a.ts")).toMatchObject({ worktree: "D" });
    await gitDiscard(repo, ["src/a.ts"], ["src/b.ts"]);
    expect(r("src/a.ts")).toBe("export const a = 1;\n");
    expect(fs.existsSync(path.join(repo, "src/b.ts"))).toBe(false);
  });

  it("złe ścieżki są odrzucane zanim git ruszy", async () => {
    for (const bad of ["../poza", "/etc/passwd", "a/../../b", ""]) {
      await expect(gitStage(repo, [bad])).rejects.toThrow("Niedozwolona ścieżka");
      await expect(gitDiscard(repo, [bad], [])).rejects.toThrow("Niedozwolona ścieżka");
      await expect(gitDiscard(repo, [], [bad])).rejects.toThrow("Niedozwolona ścieżka");
      await expect(gitDiff(repo, bad, "unstaged")).rejects.toThrow("Niedozwolona ścieżka");
    }
  });

  it("ścieżka zaczynająca się od myślnika nie jest opcją", async () => {
    w("-n.txt", "x\n");
    await gitStage(repo, ["-n.txt"]);
    expect(await entry("-n.txt")).toMatchObject({ index: "A" });
    await gitUnstage(repo, ["-n.txt"]);
    await gitDiscard(repo, [], ["-n.txt"]);
    expect(fs.existsSync(path.join(repo, "-n.txt"))).toBe(false);
  });

  it("push bez upstreamu publikuje (-u), potem ahead/behind i pull ff-only", async () => {
    await runGit(repo, ["remote", "add", "origin", remote]);
    expect((await st()).branch.upstream).toBeNull();
    await gitSync(repo, "push");
    let s = await st();
    expect(s.branch).toMatchObject({ upstream: "origin/main", ahead: 0, behind: 0 });

    w("lokalny.txt", "l\n");
    await gitStage(repo, ["lokalny.txt"]);
    await gitCommit(repo, "lokalny");
    expect((await st()).branch).toMatchObject({ ahead: 1, behind: 0 });
    await gitSync(repo, "push");
    expect((await st()).branch).toMatchObject({ ahead: 0, behind: 0 });

    // drugi klon dopisuje commit; po fetch repo jest „behind”
    await runGit(root, ["clone", "-q", remote, other]);
    w("zdalny.txt", "z\n", other);
    await runGit(other, ["add", "zdalny.txt"]);
    await runGit(other, ["commit", "-q", "-m", "zdalny"]);
    await runGit(other, ["push", "-q"]);
    await runGit(repo, ["fetch", "-q"]);
    s = await st();
    expect(s.branch).toMatchObject({ ahead: 0, behind: 1 });
    await gitSync(repo, "pull");
    expect(r("zdalny.txt")).toBe("z\n");
    expect((await st()).branch).toMatchObject({ ahead: 0, behind: 0 });
  });

  it("pull ff-only odmawia przy rozbieżnych historiach i niczego nie scala", async () => {
    w("a1.txt", "1\n");
    await gitStage(repo, ["a1.txt"]);
    await gitCommit(repo, "lokalna rozbieżna");
    w("b1.txt", "2\n", other);
    await runGit(other, ["add", "b1.txt"]);
    await runGit(other, ["commit", "-q", "-m", "zdalna rozbieżna"]);
    await runGit(other, ["push", "-q"]);
    const head = (await runGit(repo, ["rev-parse", "HEAD"])).stdout;
    await expect(gitSync(repo, "pull")).rejects.toThrow();
    expect((await runGit(repo, ["rev-parse", "HEAD"])).stdout).toBe(head);
    expect(fs.existsSync(path.join(repo, "b1.txt"))).toBe(false);
  });

  it("środowisko git: bez pytań o hasło, ssh w trybie wsadowym", () => {
    expect(gitEnv({})).toMatchObject({ GIT_TERMINAL_PROMPT: "0", LC_ALL: "C", GIT_SSH_COMMAND: "ssh -o BatchMode=yes" });
    expect(gitEnv({ GIT_SSH_COMMAND: "moje ssh" }).GIT_SSH_COMMAND).toBe("moje ssh");
  });
});

describe("git: core.fsmonitor z konfiguracji repozytorium nie jest wykonywany", () => {
  it("status nie uruchamia zapisanego programu", async () => {
    const evil = fs.mkdtempSync(path.join(root, "evil-"));
    await runGit(evil, ["init", "-q", "-b", "main"]);
    const marker = path.join(root, "fsmonitor-ran");
    const hook = path.join(root, "fsmonitor.sh");
    fs.writeFileSync(hook, `#!/bin/sh\ntouch '${marker}'\n`, { mode: 0o755 });
    // `/` zamiast `\` z Windows: w pliku konfiguracji git `\` zaczyna sekwencję ucieczki
    fs.appendFileSync(path.join(evil, ".git", "config"), `[core]\n\tfsmonitor = ${hook.replaceAll("\\", "/")}\n`);
    expect(GIT_SAFE_ARGS).toContain("core.fsmonitor=false");
    await gitStatus(evil);
    await gitFiles(evil);
    expect(fs.existsSync(marker)).toBe(false);
  });
});
