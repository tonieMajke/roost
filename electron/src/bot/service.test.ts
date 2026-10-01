import fs from "node:fs";
import http from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { newBot, newBotChat, serializeBot, type BotChat } from "../../../src/bot";
import type { ChatEvent, ChatRequest } from "../../../src/chat";
import { ApprovalBroker } from "./approvals";
import { BotService } from "./service";
import { BotStore } from "./store";

// Atrapa llama-server odtwarza nagranie z etapu 4: krok 1 woła list_dir("."), krok 2 odpowiada.
const fixture = (name: string) => fs.readFileSync(path.join(__dirname, "fixtures", name), "utf8");
let server: http.Server;
let base = "";
const bodies: { messages: { role: string; content: unknown }[]; tools?: unknown[] }[] = [];
beforeAll(async () => {
  server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (d) => (body += d));
    req.on("end", () => {
      const b = JSON.parse(body);
      bodies.push(b);
      res.writeHead(200, { "content-type": "text/event-stream" });
      res.end(fixture(b.messages.some((m: { role: string }) => m.role === "tool") ? "openai-tools-2.sse" : "openai-tools-1.sse"));
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`;
});
afterAll(() => {
  server.closeAllConnections();
  server.close();
});

let dir = "";
let store: BotStore;
beforeEach(() => {
  dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "aw-botsvc-")));
  store = new BotStore(path.join(dir, "bots"), path.join(dir, "trash"), () => 1000);
  store.create(serializeBot(newBot("rusty", 1, { name: "Rusty", persona: "Jestem piratem." })));
  store.memorySave("rusty", "memory", "Użytkownik lubi Rusta.");
  bodies.length = 0;
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

const service = () =>
  new BotService({
    store,
    broker: new ApprovalBroker(),
    bridge: () => Promise.reject(new Error("most niepotrzebny dla HTTP")),
    execPath: process.execPath,
    mcpScript: "",
    key: () => null,
    now: () => new Date(2026, 9, 1, 12).getTime(),
  });
const req = (): ChatRequest => ({
  provider: { id: "llama", name: "llama", kind: "openai", group: "local", baseUrl: base, models: [] },
  model: "qwen",
  system: "",
  messages: [],
  prompt: "",
  search: false,
});
const chatWith = (text: string): BotChat => ({
  ...newBotChat("c1", "rusty", 1, { provider: "llama", model: "qwen" }),
  messages: [{ id: "u1", role: "user", text, at: 1 }],
});

describe("BotService (HTTP)", () => {
  it("przebieg z harmonogramu: nazwa zadania w prompcie; abortAll z `keep` go nie przerywa", async () => {
    const s = service();
    const routine = { id: "r1", name: "Poranne newsy", prompt: "a", schedule: { kind: "every" as const, minutes: 5 }, allow: { writeWork: false, bash: [] }, enabled: true, created: 0 };
    const out: ChatEvent[] = [];
    const p = s.send("run:1", { ...chatWith("a"), routine: "r1" }, req(), (e) => out.push(e), routine);
    s.abortAll((id) => id.startsWith("run:"));
    await p;
    expect(out.at(-1)).toEqual({ type: "done" });
    expect(out.some((e) => e.type === "text")).toBe(true);
    expect(bodies[0].messages[0].content).toContain("# Zadanie z harmonogramu: Poranne newsy");
  });

  it("prompt bota z pamięcią, narzędzia z rejestru, list_dir w work/ bez pytania, kończy `done`", async () => {
    fs.writeFileSync(path.join(store.work("rusty"), "notatki.md"), "x");
    const out: ChatEvent[] = [];
    await service().send("r1", chatWith("Co jest w katalogu?"), req(), (e) => out.push(e));
    expect(out.at(-1)).toEqual({ type: "done" });
    const system = bodies[0].messages[0].content as string;
    expect(system).toContain("Nazywasz się Rusty. Jestem piratem.");
    expect(system).toContain("Użytkownik lubi Rusta.");
    expect((bodies[0].tools ?? []).length).toBeGreaterThan(5);
    expect(out.find((e) => e.type === "tool_result")).toMatchObject({ error: false, approval: "auto", text: expect.stringContaining("notatki.md") });
  });

  it("prompt to migawka z pierwszej odpowiedzi: zmiana pamięci w trakcie rozmowy go nie zmienia", async () => {
    const s = service();
    await s.send("r1", chatWith("a"), req(), () => {});
    store.memorySave("rusty", "memory", "Nowy fakt.");
    await s.send("r2", chatWith("b"), req(), () => {});
    const first = bodies[0].messages[0].content;
    expect(bodies.at(-1)!.messages[0].content).toBe(first);
  });

  it("rozmowa z `toolsUnsupported` idzie bez narzędzi; nieznany bot = błąd", async () => {
    await service().send("r1", { ...chatWith("a"), toolsUnsupported: true }, req(), () => {});
    expect(bodies[0].tools).toBeUndefined();
    const out: ChatEvent[] = [];
    await service().send("r2", { ...chatWith("a"), bot: "nie-ma" }, req(), (e) => out.push(e));
    expect(out).toEqual([{ type: "error", message: "nie ma bota „nie-ma”" }]);
  });
});
