import { afterEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DEFAULT_AGENTS, parseAgents } from "../../src/agents";
import { accountsLoad, accountsSave, agentsLoad, defaultAgentsJson, sessionExistsIn, workspaceBackup, workspaceLoad, workspaceSave, writeAtomic } from "./config";

const dirs: string[] = [];
const tempDir = () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "aw-config-"));
  dirs.push(d);
  return d;
};
afterEach(() => dirs.splice(0).forEach((d) => fs.rmSync(d, { recursive: true, force: true })));

describe("config", () => {
  it("znajduje sesję w dowolnym katalogu projektu", () => {
    const root = tempDir();
    const id = "3f2a1b0c-0000-4000-8000-000000000001";
    fs.mkdirSync(path.join(root, "some-project"));
    fs.writeFileSync(path.join(root, "some-project", `${id}.jsonl`), "{}\n");
    expect(sessionExistsIn(root, id)).toBe(true);
    expect(sessionExistsIn(root, "00000000-0000-4000-8000-000000000000")).toBe(false);
    expect(sessionExistsIn(path.join(root, "nope"), id)).toBe(false);
  });

  it("odrzuca id, które nie są UUID", () => {
    const root = tempDir();
    fs.mkdirSync(path.join(root, "project"));
    fs.writeFileSync(path.join(root, "x.jsonl"), "not a session");
    fs.writeFileSync(path.join(root, "project", "x.jsonl"), "not a session");
    for (const id of ["../x", "x/../../x", "x.server.com", "ABCDEF", "", "x;rm"]) expect(sessionExistsIn(root, id)).toBe(false);
  });

  it("writeAtomic podmienia i nie zostawia pliku tymczasowego", () => {
    const dir = tempDir();
    const file = path.join(dir, "agents.json");
    writeAtomic(file, "first");
    writeAtomic(file, "second");
    expect(fs.readFileSync(file, "utf8")).toBe("second");
    expect(fs.readdirSync(dir)).toEqual(["agents.json"]);
  });

  it("kopia zapasowa raz, brak źródła to nie błąd, zła data odrzucona", () => {
    const dir = tempDir();
    const bak = path.join(dir, "workspace.2026-09-30.bak");
    workspaceBackup("2026-09-30", dir);
    expect(fs.existsSync(bak)).toBe(false);
    workspaceSave("one", dir);
    workspaceBackup("2026-09-30", dir);
    expect(fs.readFileSync(bak, "utf8")).toBe("one");
    workspaceSave("two", dir);
    workspaceBackup("2026-09-30", dir);
    expect(fs.readFileSync(bak, "utf8")).toBe("one");
    expect(() => workspaceBackup("../../x", dir)).toThrow();
  });

  it("workspace: null przy pierwszym starcie, potem zapisana treść", () => {
    const dir = tempDir();
    expect(workspaceLoad(dir)).toBeNull();
    workspaceSave('{"a":1}', dir);
    expect(workspaceLoad(dir)).toBe('{"a":1}');
  });

  it("accounts.json: brak pliku = null i nie powstaje, potem zapisana treść", () => {
    const dir = tempDir();
    expect(accountsLoad(dir)).toBeNull();
    expect(fs.existsSync(path.join(dir, "accounts.json"))).toBe(false);
    accountsSave('{"accounts":[]}', dir);
    expect(accountsLoad(dir)).toBe('{"accounts":[]}');
  });

  it("agents.json: brak → domyślne zapisane, zepsuty plik zwracany bez nadpisania", () => {
    const dir = tempDir();
    expect(agentsLoad(dir)).toBe(defaultAgentsJson());
    fs.writeFileSync(path.join(dir, "agents.json"), "{zepsuty");
    expect(agentsLoad(dir)).toBe("{zepsuty");
    const agents = JSON.parse(defaultAgentsJson()).agents;
    expect(agents.length).toBe(3);
    expect(agents[0].id).toBe("claude");
    expect(agents[2].command).toBe("$SHELL");
  });

  it("domyślni agenci to ta sama lista co DEFAULT_AGENTS w src/agents.ts", () => {
    expect(parseAgents(JSON.parse(defaultAgentsJson()))).toEqual({ agents: DEFAULT_AGENTS, errors: [] });
  });
});
