import { beforeEach, describe, expect, it, vi } from "vitest";
import { mockBotBackend as b } from "./bot-mock";
import { newBot, newBotChat } from "./bot";

beforeEach(() => {
  const data = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
  });
});

describe("boty w podglądzie", () => {
  it("przykładowe dane: dwa boty i Kreator na końcu", async () => {
    const { bots } = await b.botList();
    expect(bots.map((x) => x.id)).toEqual(["rusty", "ola", "kreator"]);
    expect((await b.botSkills("rusty")).map((s) => s.name)).toEqual(["rust-news"]);
    expect((await b.botRoutines("rusty")).routines).toHaveLength(1);
    expect(await b.botChatList("rusty", "chats")).toHaveLength(1);
    expect(await b.botChatList("rusty", "runs")).toHaveLength(1);
    expect((await b.botMemory("rusty")).memory).toContain("Electronie");
  });

  it("te same odmowy co na dysku", async () => {
    await expect(b.botCreate(newBot("rusty", 0, { name: "X" }))).rejects.toThrow("już istnieje");
    await expect(b.botDelete("kreator")).rejects.toThrow("wbudowanego");
    await expect(b.botMemorySave("rusty", "user", "x".repeat(2000))).rejects.toThrow("za dużo");
    await expect(b.botSkillSave("rusty", "bez nagłówka")).rejects.toThrow("SKILL.md");
  });

  it("zmiany zostają", async () => {
    await b.botCreate(newBot("nowy", 5, { name: "Nowy" }));
    await b.botChatSave(newBotChat("cccccccc-1", "nowy", 6, { provider: "claude", model: "haiku" }));
    expect((await b.botList()).bots.map((x) => x.id)).toContain("nowy");
    expect(await b.botChatLoad("nowy", "chats", "cccccccc-1")).toMatchObject({ bot: "nowy" });
    await b.botDelete("nowy");
    expect((await b.botList()).bots.map((x) => x.id)).not.toContain("nowy");
  });
});
