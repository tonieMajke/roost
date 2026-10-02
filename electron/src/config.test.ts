import { afterEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DEFAULT_AGENTS, parseAgents } from "../../src/agents";
import { accountsLoad, accountsSave, agentsLoad, claudeSessionExists, defaultAgentsJson, legacyCwdFor, migrateLegacyConfig, resolveClaudeResume, sessionExistsIn, workspaceBackup, workspaceLoad, workspaceSave, writeAtomic } from "./config";

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

  it("claudeSessionExists szuka w folderze konta, nie w ~/.claude", () => {
    const dir = tempDir();
    const id = "11111111-1111-4111-8111-111111111111";
    fs.mkdirSync(path.join(dir, "projects", "p"), { recursive: true });
    fs.writeFileSync(path.join(dir, "projects", "p", `${id}.jsonl`), "{}\n");
    expect(claudeSessionExists(id, dir)).toBe(true);
    expect(claudeSessionExists("22222222-2222-4222-8222-222222222222", dir)).toBe(false);
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

  it("migracja: kopiuje stary katalog, gdy nowego nie ma, i niczego nie rusza w starym", () => {
    const root = tempDir();
    const legacy = path.join(root, "agents");
    const dir = path.join(root, "roost");
    fs.mkdirSync(path.join(legacy, "bots", "rust"), { recursive: true });
    fs.writeFileSync(path.join(legacy, "workspace.json"), '{"a":1}');
    fs.writeFileSync(path.join(legacy, "bots", "rust", "bot.json"), "{}");
    expect(migrateLegacyConfig(dir, legacy)).toBe(true);
    expect(fs.readFileSync(path.join(dir, "workspace.json"), "utf8")).toBe('{"a":1}');
    expect(fs.existsSync(path.join(dir, "bots", "rust", "bot.json"))).toBe(true);
    expect(fs.existsSync(path.join(legacy, "workspace.json"))).toBe(true);
  });

  it("migracja: nie nadpisuje istniejącego nowego katalogu i znosi brak starego", () => {
    const root = tempDir();
    const legacy = path.join(root, "agents");
    const dir = path.join(root, "roost");
    fs.mkdirSync(legacy);
    fs.writeFileSync(path.join(legacy, "workspace.json"), "stary");
    fs.mkdirSync(dir);
    fs.writeFileSync(path.join(dir, "workspace.json"), "nowy");
    expect(migrateLegacyConfig(dir, legacy)).toBe(false);
    expect(fs.readFileSync(path.join(dir, "workspace.json"), "utf8")).toBe("nowy");
    expect(migrateLegacyConfig(path.join(root, "x"), path.join(root, "brak"))).toBe(false);
  });

  describe("migrateLegacyConfig", () => {
    const legacyWith = () => {
      const legacy = tempDir();
      fs.writeFileSync(path.join(legacy, "workspace.json"), "old");
      fs.mkdirSync(path.join(legacy, "bots", "b"), { recursive: true });
      return legacy;
    };

    it("kopiuje przez .migrating i jest idempotentna", () => {
      const legacy = legacyWith();
      const dir = path.join(tempDir(), "roost");
      expect(migrateLegacyConfig(dir, legacy)).toBe(true);
      expect(fs.readFileSync(path.join(dir, "workspace.json"), "utf8")).toBe("old");
      expect(fs.existsSync(`${dir}.migrating`)).toBe(false);
      fs.writeFileSync(path.join(dir, "workspace.json"), "new");
      expect(migrateLegacyConfig(dir, legacy)).toBe(false);
      expect(fs.readFileSync(path.join(dir, "workspace.json"), "utf8")).toBe("new");
      expect(fs.readFileSync(path.join(legacy, "workspace.json"), "utf8")).toBe("old");
    });

    it("po migracji katalog ma 0700, a pliki z sekretami 0600 (reszta bez zmian)", () => {
      const legacy = legacyWith();
      fs.mkdirSync(path.join(legacy, "pi-agent"));
      for (const f of ["accounts.json", "chat-keys.json", "pi-agent/web-search.json", "agents.json"]) {
        fs.writeFileSync(path.join(legacy, f), "{}");
        fs.chmodSync(path.join(legacy, f), 0o644);
      }
      fs.chmodSync(legacy, 0o755);
      const dir = path.join(tempDir(), "roost");
      expect(migrateLegacyConfig(dir, legacy)).toBe(true);
      const mode = (f: string) => fs.statSync(path.join(dir, f)).mode & 0o777;
      expect(fs.statSync(dir).mode & 0o777).toBe(0o700);
      for (const f of ["accounts.json", "chat-keys.json", "pi-agent/web-search.json"]) expect(mode(f)).toBe(0o600);
      expect(mode("agents.json")).toBe(0o644);
      expect(fs.statSync(legacy).mode & 0o777).toBe(0o755); // stary katalog nietknięty
    });

    it("przerwana kopia (.migrating z resztkami) nie blokuje kolejnej próby", () => {
      const legacy = legacyWith();
      const dir = path.join(tempDir(), "roost");
      fs.mkdirSync(`${dir}.migrating`);
      fs.writeFileSync(path.join(`${dir}.migrating`, "junk"), "x");
      expect(migrateLegacyConfig(dir, legacy)).toBe(true);
      expect(fs.existsSync(path.join(dir, "junk"))).toBe(false);
      expect(fs.existsSync(path.join(dir, "workspace.json"))).toBe(true);
    });

    it("pusty albo szczątkowy katalog docelowy nie blokuje, szczątki zostają", () => {
      const legacy = legacyWith();
      const dir = tempDir();
      fs.writeFileSync(path.join(dir, "usage-index.json"), "cache");
      expect(migrateLegacyConfig(dir, legacy)).toBe(true);
      expect(fs.readFileSync(path.join(dir, "workspace.json"), "utf8")).toBe("old");
      expect(fs.readFileSync(path.join(dir, "usage-index.json"), "utf8")).toBe("cache");
      const empty = tempDir();
      expect(migrateLegacyConfig(empty, legacy)).toBe(true);
      expect(fs.existsSync(path.join(empty, "bots", "b"))).toBe(true);
    });

    it("katalog z danymi nigdy nie jest ruszany", () => {
      const legacy = legacyWith();
      for (const name of ["workspace.json", "agents.json", "accounts.json", "chat-keys.json", "bots", "chats"]) {
        const dir = tempDir();
        fs.mkdirSync(path.join(dir, name), { recursive: true }); // plik lub katalog: liczy się istnienie
        expect(migrateLegacyConfig(dir, legacy)).toBe(false);
        expect(fs.readdirSync(dir)).toEqual([name]);
      }
    });

    it("brak starego katalogu: nic się nie dzieje", () => {
      expect(migrateLegacyConfig(path.join(tempDir(), "x"), path.join(tempDir(), "nope"))).toBe(false);
    });
  });

  it("writeAtomic z mode: plik 0600, także gdy stary .tmp był szerszy", () => {
    const dir = tempDir();
    const file = path.join(dir, "k.json");
    fs.writeFileSync(`${file}.tmp`, "stare", { mode: 0o644 });
    writeAtomic(file, "tajne", 0o600);
    expect(fs.statSync(file).mode & 0o777).toBe(0o600);
    expect(fs.readFileSync(file, "utf8")).toBe("tajne");
    expect(fs.readdirSync(dir)).toEqual(["k.json"]);
  });

  it("accountsSave zapisuje z 0600", () => {
    const dir = tempDir();
    accountsSave("{}", dir);
    expect(fs.statSync(path.join(dir, "accounts.json")).mode & 0o777).toBe(0o600);
  });

  describe("resolveClaudeResume", () => {
    const id = "3f2a1b0c-0000-4000-8000-000000000001";
    const put = (root: string, cwd: string) => {
      const d = path.join(root, cwd.replace(/[^a-zA-Z0-9]/g, "-"));
      fs.mkdirSync(d, { recursive: true });
      fs.writeFileSync(path.join(d, `${id}.jsonl`), "{}\n");
    };
    const cur = "/home/u/.config/dev.majke.roost/chat-cwd";
    const old = "/home/u/.config/dev.majke.agents/chat-cwd";

    it("sesja pod bieżącym cwd: resume tam", () => {
      const root = tempDir();
      put(root, cur);
      put(root, old);
      expect(resolveClaudeResume(id, cur, old, root)).toEqual({ cwd: cur, resume: true });
    });
    it("tylko pod starym cwd: stary cwd", () => {
      const root = tempDir();
      put(root, old);
      expect(resolveClaudeResume(id, cur, old, root)).toEqual({ cwd: old, resume: true });
    });
    it("nigdzie: nowa sesja zamiast resume", () => {
      expect(resolveClaudeResume(id, cur, old, tempDir())).toEqual({ cwd: cur, resume: false });
      expect(resolveClaudeResume("../x", cur, old, tempDir())).toEqual({ cwd: cur, resume: false });
    });
    it("bez starego cwd (folder użytkownika) nie szuka go", () => {
      const root = tempDir();
      put(root, old);
      expect(resolveClaudeResume(id, "/home/u/proj", null, root)).toEqual({ cwd: "/home/u/proj", resume: false });
    });
    it("legacyCwdFor mapuje ścieżki pod configDir", () => {
      expect(legacyCwdFor("/c/roost/bots/b/work", "/c/roost", "/c/agents")).toBe("/c/agents/bots/b/work");
      expect(legacyCwdFor("/c/roost", "/c/roost", "/c/agents")).toBe("/c/agents");
      expect(legacyCwdFor("/home/u/proj", "/c/roost", "/c/agents")).toBeNull();
      expect(legacyCwdFor("/c/roost-x", "/c/roost", "/c/agents")).toBeNull();
    });
  });
});
