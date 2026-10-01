import fs from "node:fs";
import http from "node:http";
import type { AddressInfo } from "node:net";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { ChatEvent, ChatRequest, ToolCall, ToolSpec } from "../../../src/chat";
import { anthropicBody, anthropicEvents, anthropicMessages, streamAnthropic } from "../chat/anthropic";
import { CallParts } from "../chat/http";
import { openaiBody, openaiEvents, streamOpenAI } from "../chat/openai";
import { SseParser } from "../chat/sse";
import { MAX_STEPS, runBotTurn, type RunTool, type Step } from "./loop";

// Nagrane z llama-server (Qwen, `--jinja`): krok 1 wywołuje list_dir, krok 2 odpowiada po wyniku.
const fixture = (name: string) => fs.readFileSync(path.join(__dirname, "fixtures", name), "utf8");
const sse = (text: string) => {
  const p = new SseParser();
  return [...p.push(new TextEncoder().encode(text)), ...p.end()].map((e) => e.data);
};
const LIST_DIR: ToolSpec = { name: "list_dir", description: "Lista plików", parameters: { type: "object", properties: { path: { type: "string" } } } };

describe("składanie wywołań", () => {
  it("OpenAI: argumenty z kawałków nagranego strumienia, myślenie i bez tekstu", () => {
    const calls = new CallParts();
    const events = sse(fixture("openai-tools-1.sse")).flatMap((d) => openaiEvents(d, calls));
    expect(calls.calls()).toEqual([{ id: "UbtkojabCnGYEn0JNw0Y97SMioebJD95", name: "list_dir", args: { path: "." } }]);
    expect(events.some((e) => e.type === "thinking")).toBe(true);
    expect(events.some((e) => e.type === "text")).toBe(false);
  });

  it("Anthropic: tekst, dwa bloki tool_use, input_json_delta w kawałkach", () => {
    const calls = new CallParts();
    const events = sse(fixture("anthropic-tools.sse")).flatMap((d) => anthropicEvents(d, calls));
    expect(events).toEqual([{ type: "text", text: "Sprawdzę katalog." }]);
    expect(calls.calls()).toEqual([
      { id: "toolu_01A", name: "list_dir", args: { path: "src" } },
      { id: "toolu_01B", name: "web_search", args: { query: "rust 2026" } },
    ]);
  });

  it("brak id = unikalne zastępcze, puste argumenty = {}, zły JSON = `bad`", () => {
    const calls = new CallParts();
    calls.add(0, { name: "list_dir" });
    calls.add(1, { name: "bash", json: '{"command": "ls"' });
    calls.add(2, { name: "x", json: "[1]" });
    calls.add(3, { json: "{}" }); // bez nazwy: pominięte
    const [a, b, c] = calls.calls();
    expect(a).toMatchObject({ name: "list_dir", args: {} });
    expect(a.id).toMatch(/^call_[0-9a-f]{8}$/);
    expect(b).toMatchObject({ name: "bash", args: {}, bad: '{"command": "ls"' });
    expect(c.bad).toBe("[1]");
    expect(calls.calls()).toHaveLength(3);
  });
});

describe("ciała żądań z narzędziami", () => {
  const turns = [
    { role: "user" as const, content: "Co jest w src?" },
    { role: "assistant" as const, content: "", calls: [{ id: "t1", name: "list_dir", args: { path: "src" } }] },
    { role: "tool" as const, id: "t1", content: "main.rs" },
    { role: "tool" as const, id: "t2", content: "nie ma", error: true },
    { role: "user" as const, content: "Dzięki" },
  ];
  const req = (): ChatRequest => ({
    provider: { id: "t", name: "t", kind: "openai", group: "local", models: [] },
    model: "m",
    system: "sys",
    messages: [],
    prompt: "",
    search: false,
    turns,
    tools: [LIST_DIR],
  });

  it("OpenAI: tool_calls z argumentami jako tekst, content null, role tool", () => {
    const b = openaiBody(req());
    expect(b.tools).toEqual([{ type: "function", function: LIST_DIR }]);
    expect((b.messages as unknown[]).slice(2, 4)).toEqual([
      { role: "assistant", content: null, tool_calls: [{ id: "t1", type: "function", function: { name: "list_dir", arguments: '{"path":"src"}' } }] },
      { role: "tool", tool_call_id: "t1", content: "main.rs" },
    ]);
    expect(openaiBody({ ...req(), tools: [] }).tools).toBeUndefined();
  });

  it("Anthropic: tool_use, wyniki i tekst w jednej wiadomości użytkownika, input_schema", () => {
    expect(anthropicMessages(turns)).toEqual([
      { role: "user", content: [{ type: "text", text: "Co jest w src?" }] },
      { role: "assistant", content: [{ type: "tool_use", id: "t1", name: "list_dir", input: { path: "src" } }] },
      {
        role: "user",
        content: [
          { type: "tool_result", tool_use_id: "t1", content: "main.rs" },
          { type: "tool_result", tool_use_id: "t2", content: "nie ma", is_error: true },
          { type: "text", text: "Dzięki" },
        ],
      },
    ]);
    expect(anthropicBody(req()).tools).toEqual([{ name: "list_dir", description: "Lista plików", input_schema: LIST_DIR.parameters }]);
  });
});

// Atrapa serwera odtwarza nagrania: bez wyniku narzędzia w historii krok 1, z wynikiem krok 2.
let server: http.Server;
let base = "";
const bodies: Record<string, unknown>[] = [];

beforeAll(async () => {
  server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (d) => (body += d));
    req.on("end", () => {
      const b = JSON.parse(body) as { model: string; messages: { role: string }[]; tools?: unknown };
      bodies.push(b);
      if (req.url === "/v1/messages") {
        res.writeHead(200, { "content-type": "text/event-stream" });
        return res.end(fixture("anthropic-tools.sse"));
      }
      if (b.model === "no-tools" && b.tools) {
        res.writeHead(500, { "content-type": "application/json" });
        return res.end(JSON.stringify({ error: { message: "tools param requires --jinja flag" } }));
      }
      res.writeHead(200, { "content-type": "text/event-stream" });
      const done = b.messages.some((m) => m.role === "tool") || !b.tools;
      res.end(fixture(done ? "openai-tools-2.sse" : "openai-tools-1.sse"));
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`;
});
afterAll(() => {
  server.closeAllConnections();
  server.close();
});

const request = (model = "qwen", kind: "openai" | "anthropic" = "openai"): ChatRequest => ({
  provider: { id: "t", name: "t", kind, group: "local", baseUrl: base, models: [] },
  model,
  system: "sys",
  messages: [{ role: "user", content: "Jaki plik jest w katalogu roboczym?" }],
  prompt: "",
  search: false,
});

const textOf = (out: ChatEvent[]) => out.map((e) => (e.type === "text" ? e.text : "")).join("");

describe("runBotTurn na nagranym strumieniu", () => {
  it("model → list_dir → wynik → odpowiedź; drugie żądanie ma wywołanie i wynik", async () => {
    bodies.length = 0;
    const ran: [string, unknown][] = [];
    const run: RunTool = async (name, args) => (ran.push([name, args]), { ok: true, text: "notatki.md  (120 B)", approval: "auto" });
    const out: ChatEvent[] = [];
    await runBotTurn(request(), [LIST_DIR], (r, s, e) => streamOpenAI(r, null, s, e), run, new AbortController().signal, (e) => out.push(e));
    expect(ran).toEqual([["list_dir", { path: "." }]]);
    const id = "UbtkojabCnGYEn0JNw0Y97SMioebJD95";
    expect(out.filter((e) => e.type === "tool_call" || e.type === "tool_result")).toEqual([
      { type: "tool_call", id, name: "list_dir", args: { path: "." } },
      { type: "tool_result", id, text: "notatki.md  (120 B)", error: false, approval: "auto" },
    ]);
    expect(textOf(out)).toBe("W katalogu roboczym znajduje się plik **notatki.md** o rozmiarze 120 B.");
    expect(bodies).toHaveLength(2);
    expect((bodies[1].messages as unknown[]).slice(-2)).toEqual([
      { role: "assistant", content: null, tool_calls: [{ id, type: "function", function: { name: "list_dir", arguments: '{"path":"."}' } }] },
      { role: "tool", tool_call_id: id, content: "notatki.md  (120 B)" },
    ]);
  });

  it("serwer odrzuca `tools` (500): ten sam krok bez narzędzi, `tools_unsupported`", async () => {
    bodies.length = 0;
    const out: ChatEvent[] = [];
    await runBotTurn(request("no-tools"), [LIST_DIR], (r, s, e) => streamOpenAI(r, null, s, e), async () => fail(), new AbortController().signal, (e) => out.push(e));
    expect(out.filter((e) => e.type === "tools_unsupported")).toHaveLength(1);
    expect(textOf(out)).toContain("notatki.md");
    expect(bodies.map((b) => !!b.tools)).toEqual([true, false]);
  });

  it("Anthropic: wywołania z nagrania idą do narzędzi po kolei", async () => {
    const ran: string[] = [];
    const run: RunTool = async (name) => (ran.push(name), { ok: true, text: "ok", approval: "auto" });
    // Atrapa zawsze odpowiada wywołaniami: po 2 krokach Stop.
    const ctl = new AbortController();
    const out: ChatEvent[] = [];
    await runBotTurn(
      request("claude", "anthropic"),
      [LIST_DIR],
      (r, s, e) => streamAnthropic(r, "sk-ant", s, e),
      async (name, args) => {
        const res = await run(name, args);
        if (ran.length === 4) ctl.abort();
        return res;
      },
      ctl.signal,
      (e) => out.push(e),
    );
    expect(ran).toEqual(["list_dir", "web_search", "list_dir", "web_search"]);
    expect(textOf(out)).toBe("Sprawdzę katalog.\n\nSprawdzę katalog.");
  });
});

const fail = (): never => {
  throw new Error("narzędzie nie powinno ruszyć");
};

describe("runBotTurn: granice", () => {
  const call = (id: string, name = "list_dir", args: Record<string, unknown> = {}): ToolCall => ({ id, name, args });
  const collect = async (step: Step, run: RunTool = async () => ({ ok: true, text: "ok", approval: "auto" }), signal = new AbortController().signal) => {
    const out: ChatEvent[] = [];
    await runBotTurn(request(), [LIST_DIR], step, run, signal, (e) => out.push(e));
    return out;
  };

  it(`najwyżej ${MAX_STEPS} kroków, potem komunikat`, async () => {
    let n = 0;
    const out = await collect(async () => [call(`c${++n}`)]);
    expect(n).toBe(MAX_STEPS);
    expect(out.filter((e) => e.type === "tool_result")).toHaveLength(MAX_STEPS);
    expect(textOf(out)).toContain(`Przerwałem po ${MAX_STEPS} krokach`);
  });

  it("zły JSON argumentów: błąd do modelu bez uruchamiania narzędzia", async () => {
    let n = 0;
    const seen: ChatRequest[] = [];
    const out = await collect(async (r) => (seen.push(r), n++ === 0 ? [{ id: "b", name: "bash", args: {}, bad: "{zle" }] : []), async () => fail());
    expect(out.find((e) => e.type === "tool_result")).toMatchObject({ error: true, text: expect.stringContaining("{zle") });
    expect(seen[1].turns!.at(-1)).toMatchObject({ role: "tool", id: "b", error: true });
  });

  it("401 i błąd po udanym kroku z narzędziami nie wyłączają narzędzi", async () => {
    const http401 = Object.assign(new Error("zły klucz"), { status: 401 });
    await expect(collect(async () => Promise.reject(http401))).rejects.toThrow("zły klucz");
    let n = 0;
    const later = Object.assign(new Error("za długi kontekst"), { status: 400 });
    await expect(collect(async () => (n++ === 0 ? [call("a")] : Promise.reject(later)))).rejects.toThrow("za długi kontekst");
    expect(n).toBe(2);
  });

  it("bez narzędzi też błąd: pierwotny komunikat", async () => {
    const first = Object.assign(new Error("tools nieobsługiwane"), { status: 400 });
    await expect(collect(async (r) => Promise.reject(r.tools ? first : new Error("inny")))).rejects.toThrow("tools nieobsługiwane");
  });

  it("szablon wywołania wypisany tekstem = `tools_unsupported`", async () => {
    const out = await collect(async (_r, _s, emit) => (emit({ type: "text", text: '<tool_call>{"name":"list_dir"}</tool_call>' }), []));
    expect(out.at(-1)).toEqual({ type: "tools_unsupported" });
  });

  it("Stop w trakcie narzędzia: wynik zgłoszony, dalszych wywołań i kroków nie ma", async () => {
    const ctl = new AbortController();
    let steps = 0;
    const out = await collect(
      async () => (steps++, [call("a"), call("b")]),
      async () => (ctl.abort(), { ok: false, text: "przerwane (Stop)", approval: "deny" }),
      ctl.signal,
    );
    expect(steps).toBe(1);
    expect(out.filter((e) => e.type === "tool_call").map((e) => (e as { id: string }).id)).toEqual(["a"]);
    expect(out.at(-1)).toEqual({ type: "tool_result", id: "a", text: "przerwane (Stop)", error: true, approval: "deny" });
  });

  it("wynik dłuższy niż 4 KB: model dostaje całość, zdarzenie skrót", async () => {
    let n = 0;
    const long = "x".repeat(10_000);
    const seen: ChatRequest[] = [];
    const out = await collect(async (r) => (seen.push(r), n++ === 0 ? [call("a")] : []), async () => ({ ok: true, text: long, approval: "auto" }));
    expect((out.find((e) => e.type === "tool_result") as { text: string }).text.length).toBeLessThan(4200);
    expect(seen[1].turns!.at(-1)).toMatchObject({ content: long });
  });
});
