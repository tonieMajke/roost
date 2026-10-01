// Kreator na żywo (claude z subskrypcji, przez most MCP):
// `AW_LIVE=1 pnpm vitest run electron/src/bot/creator-live.test.ts` (po `npm run build` w electron/).
// Model: `AW_LIVE_MODEL` (domyślnie haiku). Bez AW_LIVE pominięte – zużywa limity i trwa kilka minut.

import { randomUUID } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { CREATOR_ID, newBot, newBotChat, serializeBot, type ApprovalRequest, type BotChat } from "../../../src/bot";
import type { ChatEvent, ChatRequest, ProviderDef } from "../../../src/chat";
import { ApprovalBroker } from "./approvals";
import { ToolBridge } from "./bridge";
import { BotService } from "./service";
import { BotStore } from "./store";

const SERVER = path.join(__dirname, "..", "..", "out", "mcp-server.cjs");
const MODEL = process.env.AW_LIVE_MODEL ?? "haiku";
const claude: ProviderDef = { id: "claude", name: "Claude", kind: "claude-cli", group: "sub", command: "claude", models: [] };

describe.skipIf(!process.env.AW_LIVE)("Kreator (na żywo)", () => {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "aw-creator-")));
  const project = path.join(dir, "projekt");
  const store = new BotStore(path.join(dir, "bots"), path.join(dir, "trash"));
  const asked: ApprovalRequest[] = [];
  const broker = new ApprovalBroker((e) => {
    if (e.type !== "request") return;
    asked.push(e.req);
    queueMicrotask(() => broker.decide(e.req.id, "once"));
  });
  let bridge: ToolBridge;
  let service: BotService;
  beforeAll(async () => {
    fs.mkdirSync(project);
    store.list(); // tworzy Kreatora
    store.create(serializeBot(newBot("rusty", 1, { name: "Rusty", persona: "Ahoj! Jestem Rusty, pirat od Rusta.", style: "Długo i kwieciście, jak pirat." })));
    bridge = await ToolBridge.start();
    service = new BotService({
      store,
      broker,
      bridge: async () => bridge,
      execPath: process.execPath,
      mcpScript: SERVER,
      key: () => null,
      web: { search: async () => "(brak wyników w teście)", fetch: async () => "(brak strony w teście)" },
    });
  });
  afterAll(() => {
    bridge?.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  /** Rozmowa z Kreatorem: kolejne wiadomości użytkownika, dopóki nie zawoła `want`. Zwraca liczbę tur. */
  const talk = async (messages: string[], want: "bot_create" | "bot_update") => {
    const session = randomUUID();
    const chat: BotChat = newBotChat(randomUUID(), CREATOR_ID, Date.now(), { provider: "claude", model: MODEL });
    for (let i = 0; i < messages.length; i++) {
      const events: ChatEvent[] = [];
      const req: ChatRequest = { provider: claude, model: MODEL, system: "", messages: [], prompt: messages[i], session: { id: session, resume: i > 0 }, search: false };
      await service.send(randomUUID(), chat, req, (e) => events.push(e));
      const text = events.map((e) => (e.type === "text" ? e.text : "")).join("");
      console.log(`[${want} ${i + 1}] ${text.slice(0, 600)}`);
      expect(events.at(-1)).toEqual({ type: "done" });
      // Błąd walidacji wraca do modelu, a ten poprawia definicję: liczy się udane wywołanie.
      const results = events.filter((e) => e.type === "tool_result" && events.some((c) => c.type === "tool_call" && c.id === e.id && c.name === want));
      for (const r of results) if (r.type === "tool_result" && r.error) console.log(`[${want}] błąd dla modelu: ${r.text}`);
      if (results.some((r) => r.type === "tool_result" && !r.error)) return i + 1;
    }
    throw new Error(`Kreator nie zawołał ${want}`);
  };
  const newest = (before: string[]) => store.list().bots.find((b) => !before.includes(b.id))!;
  const ids = () => store.list().bots.map((b) => b.id);
  const ANSWER = "Zdecyduj sam o reszcie i utwórz go.";

  it("bot newsowy z harmonogramem: zadanie wyłączone, sieć włączona", async () => {
    const before = ids();
    const turns = await talk(["Zrób mi bota, który co rano przegląda newsy o Ruście i mówi jak pirat.", "Codziennie o 8:00, pirat z przymrużeniem oka. " + ANSWER, ANSWER], "bot_create");
    const bot = newest(before);
    const routines = JSON.parse(store.routines(bot.id)).routines;
    console.log(serializeBot(bot), JSON.stringify(routines), store.skills(bot.id).map((s) => s.name), `tur: ${turns}`);
    expect(bot.tools.web).toBe(true);
    expect(routines.length).toBeGreaterThan(0);
    expect(routines.every((r: { enabled: boolean }) => !r.enabled)).toBe(true);
    expect(bot.model).toEqual({ provider: "claude", model: MODEL });
    expect(asked.at(-1)?.preview?.routines?.length).toBeGreaterThan(0);
  }, 600_000);

  it("bot do przeglądu kodu z folderem projektu", async () => {
    const before = ids();
    await talk([`Potrzebuję bota do przeglądu kodu w moim projekcie ${project}. Ma być rzeczowy i wytykać błędy.`, ANSWER, ANSWER], "bot_create");
    const bot = newest(before);
    console.log(serializeBot(bot));
    expect(bot.folders).toContain(project);
    expect(bot.tools.read).toBe(true);
  }, 600_000);

  it("bot-postać bez narzędzi", async () => {
    const before = ids();
    await talk(["Zrób mi bota-postać: zrzędliwy stary latarnik, z którym mogę pogadać wieczorem. Bez dostępu do plików, sieci ani powłoki.", ANSWER, ANSWER], "bot_create");
    const bot = newest(before);
    console.log(serializeBot(bot));
    expect(bot.tools).toMatchObject({ web: false, read: false, write: false, bash: false });
  }, 600_000);

  it("bot_update: Rusty mniej gadatliwy", async () => {
    await talk(["Zrób Rusty'ego mniej gadatliwym – ma odpowiadać krótko.", ANSWER], "bot_update");
    const rusty = store.load("rusty")!;
    console.log(serializeBot(rusty), asked.at(-1)?.preview?.changed);
    expect(rusty.style).not.toBe("Długo i kwieciście, jak pirat.");
    expect(asked.at(-1)?.preview?.changed).toContain("style");
  }, 600_000);
});
