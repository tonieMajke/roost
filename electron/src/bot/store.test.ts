import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { CREATOR_ID, MEMORY_LIMIT, newBot, newBotChat, serializeBot, skillMarkdown } from "../../../src/bot";
import { BotStore } from "./store";

let dir = "";
let store: BotStore;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "aw-bot-"));
  store = new BotStore(path.join(dir, "bots"), path.join(dir, "bots-trash"), () => new Date(2026, 9, 1, 14, 30, 5).getTime());
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

const bot = (id: string, created = 1) => newBot(id, created, { name: id.toUpperCase() });

describe("BotStore: boty", () => {
  it("pierwszy odczyt tworzy Kreatora z katalogami", () => {
    const { bots, errors } = store.list();
    expect(errors).toEqual([]);
    expect(bots.map((b) => b.id)).toEqual([CREATOR_ID]);
    expect(bots[0].builtin).toBe("creator");
    expect(fs.existsSync(path.join(dir, "bots", CREATOR_ID, "work"))).toBe(true);
    expect(fs.existsSync(path.join(dir, "bots", CREATOR_ID, "skills"))).toBe(true);
  });

  it("create, lista od najstarszego z Kreatorem na końcu, save, load", () => {
    store.create(serializeBot(bot("rust", 20)));
    store.create(serializeBot(bot("ola", 10)));
    expect(store.list().bots.map((b) => b.id)).toEqual(["ola", "rust", CREATOR_ID]);
    expect(() => store.create(serializeBot(bot("rust")))).toThrow("już istnieje");
    store.save(serializeBot({ ...bot("rust", 999), persona: "Pirat", builtin: "creator" }));
    const r = store.load("rust");
    expect(r?.persona).toBe("Pirat");
    expect(r?.created).toBe(20); // `created` z dysku
    expect(r?.builtin).toBeUndefined(); // zwykły bot nie zostanie Kreatorem
    expect(() => store.save(serializeBot(bot("nie-ma")))).toThrow("nie ma bota");
  });

  it("Kreator zostaje Kreatorem po zapisie i nie da się go usunąć ani podrobić", () => {
    const creator = store.list().bots[0];
    const { builtin: _b, ...rest } = creator;
    store.save(serializeBot({ ...rest, name: "Mistrz" } as typeof creator));
    expect(store.load(CREATOR_ID)).toMatchObject({ name: "Mistrz", builtin: "creator" });
    expect(() => store.delete(CREATOR_ID)).toThrow("wbudowanego");
    expect(() => store.create(serializeBot({ ...bot("drugi"), builtin: "creator" }))).toThrow("wbudowanego");
  });

  it("usunięcie przenosi do kosza z datą", () => {
    store.create(serializeBot(bot("rust")));
    store.memorySave("rust", "memory", "fakt");
    store.delete("rust");
    expect(store.load("rust")).toBeNull();
    expect(fs.readFileSync(path.join(dir, "bots-trash", "rust-2026-10-01-143005", "memory.md"), "utf8")).toBe("fakt");
    store.create(serializeBot(bot("rust")));
    store.delete("rust");
    expect(fs.existsSync(path.join(dir, "bots-trash", "rust-2026-10-01-143005-2"))).toBe(true);
  });

  it("złe id nie wychodzi poza katalog", () => {
    expect(() => store.load("../x")).toThrow("złe id");
    expect(() => store.memory("../../etc")).toThrow("złe id");
  });

  it("zepsuty bot.json i niezgodne id w liście jako błędy", () => {
    store.list();
    fs.mkdirSync(path.join(dir, "bots", "zly"));
    fs.writeFileSync(path.join(dir, "bots", "zly", "bot.json"), "{");
    fs.mkdirSync(path.join(dir, "bots", "inny"));
    fs.writeFileSync(path.join(dir, "bots", "inny", "bot.json"), serializeBot(bot("cudzy")));
    const { bots, errors } = store.list();
    expect(bots.map((b) => b.id)).toEqual([CREATOR_ID]);
    expect(errors).toHaveLength(2);
  });
});

describe("BotStore: pamięć i skille", () => {
  beforeEach(() => void store.create(serializeBot(bot("rust"))));

  it("pamięć: pusta na start, zapis, limit", () => {
    expect(store.memory("rust")).toEqual({ memory: "", user: "" });
    store.memorySave("rust", "user", "Ma na imię Majke");
    expect(store.memory("rust").user).toBe("Ma na imię Majke");
    expect(() => store.memorySave("rust", "memory", "x".repeat(MEMORY_LIMIT + 1))).toThrow("za dużo");
    expect(() => store.memorySave("rust", "inne" as "user", "x")).toThrow("nieznana");
  });

  it("skille: zapis po nazwie z frontmattera, lista, usunięcie", () => {
    const name = store.skillSave("rust", skillMarkdown({ name: "rust-news", description: "Newsy o Ruście", body: "1. Szukaj" }));
    expect(name).toBe("rust-news");
    expect(store.skills("rust")).toMatchObject([{ name: "rust-news", description: "Newsy o Ruście" }]);
    expect(store.skill("rust", "rust-news")).toContain("1. Szukaj");
    expect(store.skill("rust", "nie-ma")).toBeNull();
    expect(() => store.skillSave("rust", "bez nagłówka")).toThrow("SKILL.md");
    expect(() => store.skill("rust", "../bot")).toThrow("zła nazwa");
    store.skillDelete("rust", "rust-news");
    expect(store.skills("rust")).toEqual([]);
  });

  it("zepsuty skill i niezgodna nazwa zostają na liście z błędem", () => {
    const skills = path.join(dir, "bots", "rust", "skills");
    fs.mkdirSync(path.join(skills, "zepsuty"));
    fs.writeFileSync(path.join(skills, "zepsuty", "SKILL.md"), "nic");
    fs.mkdirSync(path.join(skills, "katalog"));
    fs.writeFileSync(path.join(skills, "katalog", "SKILL.md"), skillMarkdown({ name: "inna", description: "d", body: "" }));
    const list = store.skills("rust");
    expect(list.map((s) => s.name)).toEqual(["katalog", "zepsuty"]);
    expect(list.every((s) => s.error)).toBe(true);
  });
});

describe("BotStore: harmonogram i rozmowy", () => {
  beforeEach(() => void store.create(serializeBot(bot("rust"))));

  it("routines: domyślnie pusto, zapis tylko poprawnych", () => {
    expect(JSON.parse(store.routines("rust"))).toEqual({ routines: [] });
    const ok = JSON.stringify({ routines: [{ id: "r1", prompt: "Newsy", schedule: { kind: "daily", at: "08:00" } }] });
    store.routinesSave("rust", ok);
    expect(store.routines("rust")).toBe(ok);
    expect(() => store.routinesSave("rust", JSON.stringify({ routines: [{ id: "r2", prompt: "x", schedule: { kind: "every", minutes: 1 } }] }))).toThrow("minutes");
    expect(store.routines("rust")).toBe(ok);
  });

  it("rozmowa i przebieg trafiają do różnych katalogów", () => {
    const model = { provider: "claude", model: "haiku" };
    store.chatSave(JSON.stringify({ ...newBotChat("aaaaaaaa-1", "rust", 1, model), title: "rozmowa" }));
    store.chatSave(JSON.stringify({ ...newBotChat("bbbbbbbb-2", "rust", 2, model, "r1"), title: "przebieg" }));
    expect(store.chats("rust", "chats").list().map((c) => c.title)).toEqual(["rozmowa"]);
    expect(store.chats("rust", "runs").list().map((c) => c.title)).toEqual(["przebieg"]);
    expect(() => store.chatSave(JSON.stringify(newBotChat("cccccccc-3", "nie-ma", 1, model)))).toThrow("nie ma bota");
    expect(() => store.chatSave(JSON.stringify({ version: 1, id: "dddddddd-4", messages: [] }))).toThrow("zły format");
    expect(() => store.chats("rust", "x" as "runs")).toThrow("nieznany");
  });
});

describe("BotStore: autor skilla, import, awatar", () => {
  beforeEach(() => store.create(serializeBot(bot("rust"))));
  const md = (name: string, body = "kroki") => skillMarkdown({ name, description: `opis ${name}`, body });

  it("autor zapisany przy tworzeniu, poprawka go nie zmienia", () => {
    store.skillSave("rust", md("a"), "bot");
    store.skillSave("rust", md("b"));
    store.skillSave("rust", md("a", "nowe kroki"), "user");
    expect(store.skills("rust").map((s) => [s.name, s.by])).toEqual([
      ["a", "bot"],
      ["b", "user"],
    ]);
  });

  it("import kopiuje katalog z plikami (dowiązanie jako plik), źródło bez zmian, drugi raz = błąd", () => {
    const src = path.join(dir, "claude-skills");
    fs.mkdirSync(path.join(src, "pdf", "scripts"), { recursive: true });
    fs.writeFileSync(path.join(src, "pdf", "SKILL.md"), md("pdf"));
    fs.writeFileSync(path.join(src, "pdf", "scripts", "run.sh"), "echo hej");
    fs.writeFileSync(path.join(dir, "cel.txt"), "z dowiązania");
    fs.symlinkSync(path.join(dir, "cel.txt"), path.join(src, "pdf", "link.txt"));
    fs.mkdirSync(path.join(src, "zly"));
    fs.writeFileSync(path.join(src, "zly", "SKILL.md"), "bez nagłówka");
    expect(BotStore.skillSources(src)).toEqual([
      { name: "pdf", description: "opis pdf" },
      { name: "zly", description: "", error: expect.any(String) },
    ]);
    expect(store.skillImport("rust", path.join(src, "pdf"))).toBe("pdf");
    const dest = path.join(dir, "bots", "rust", "skills", "pdf");
    expect(fs.readFileSync(path.join(dest, "scripts", "run.sh"), "utf8")).toBe("echo hej");
    expect(fs.lstatSync(path.join(dest, "link.txt")).isSymbolicLink()).toBe(false);
    expect(store.skills("rust")[0]).toMatchObject({ name: "pdf", by: "import" });
    expect(() => store.skillImport("rust", path.join(src, "pdf"))).toThrow("już jest");
    expect(fs.lstatSync(path.join(src, "pdf", "link.txt")).isSymbolicLink()).toBe(true);
    expect(BotStore.skillSources(path.join(dir, "nie-ma"))).toEqual([]);
  });

  it("awatar: kopia jako avatar.<ext>, poprzedni usunięty, data URL; zły typ i zła nazwa", () => {
    const png = path.join(dir, "kot.PNG");
    fs.writeFileSync(png, Buffer.from([1, 2, 3]));
    expect(store.avatarImport("rust", png)).toBe("avatar.png");
    fs.writeFileSync(path.join(dir, "pies.webp"), "x");
    expect(store.avatarImport("rust", path.join(dir, "pies.webp"))).toBe("avatar.webp");
    expect(fs.existsSync(path.join(dir, "bots", "rust", "avatar.png"))).toBe(false);
    expect(store.avatar("rust", "avatar.webp")).toBe(`data:image/webp;base64,${Buffer.from("x").toString("base64")}`);
    expect(store.avatar("rust", "../bot.json")).toBeNull();
    expect(store.avatar("rust", "avatar.png")).toBeNull();
    fs.writeFileSync(path.join(dir, "a.svg"), "<svg/>");
    expect(() => store.avatarImport("rust", path.join(dir, "a.svg"))).toThrow("tylko PNG");
  });
});
