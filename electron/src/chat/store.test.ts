import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DEFAULT_PROVIDERS, newChat } from "../../../src/chat";
import { chatConfigLoad } from "./service";
import { ChatStore } from "./store";

let dir = "";
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "aw-chat-"));
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

const chat = (id: string, updated: number, title = "") => ({ ...newChat(id, updated, { provider: "p", model: "m" }), title });

describe("ChatStore", () => {
  it("zapis, lista od najnowszych, odczyt, usunięcie", () => {
    const s = new ChatStore(path.join(dir, "chats"));
    expect(s.list()).toEqual([]);
    s.save(JSON.stringify(chat("aaaaaaaa-1", 1, "stara")));
    s.save(JSON.stringify(chat("bbbbbbbb-2", 2, "nowa")));
    s.save(JSON.stringify(chat("aaaaaaaa-1", 3, "stara zmieniona")));
    expect(s.list().map((c) => c.title)).toEqual(["stara zmieniona", "nowa"]);
    expect(JSON.parse(s.load("bbbbbbbb-2")!).title).toBe("nowa");
    expect(s.load("cccccccc-3")).toBeNull();
    s.delete("aaaaaaaa-1");
    expect(s.list().map((c) => c.id)).toEqual(["bbbbbbbb-2"]);
  });

  it("brak indeksu → odbudowa z plików, zepsute pliki pominięte", () => {
    const d = path.join(dir, "chats");
    const s = new ChatStore(d);
    s.save(JSON.stringify(chat("aaaaaaaa-1", 1, "a")));
    fs.writeFileSync(path.join(d, "zepsuty.json"), "{");
    fs.rmSync(path.join(d, "index.json"));
    expect(new ChatStore(d).list().map((c) => c.title)).toEqual(["a"]);
  });

  it("złe id i zły format odrzucone", () => {
    const s = new ChatStore(dir);
    expect(() => s.load("../../etc/passwd")).toThrow(/złe id/);
    expect(() => s.save("{}")).toThrow(/format/);
  });
});

describe("chatConfigLoad", () => {
  it("tworzy chat.json z domyślnymi, czyta models.json pi", () => {
    fs.mkdirSync(path.join(dir, ".pi", "agent"), { recursive: true });
    fs.writeFileSync(path.join(dir, ".pi", "agent", "models.json"), '{"providers":{}}');
    const r = chatConfigLoad(path.join(dir, "cfg"), dir);
    expect(JSON.parse(r.chat).providers).toEqual(DEFAULT_PROVIDERS);
    expect(r.pi).toBe('{"providers":{}}');
    expect(chatConfigLoad(path.join(dir, "cfg"), path.join(dir, "nie-ma")).pi).toBeNull();
  });
});
