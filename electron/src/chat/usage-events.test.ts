//! Zdarzenia `usage` z parserów wszystkich dostawców, na prawdziwych fixture'ach.

import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { ChatEvent, ChatRequest } from "../../../src/chat";
import { UsageAcc, anthropicEvents } from "./anthropic";
import { ClaudeParser } from "./claude";
import { CodexParser } from "./codex";
import { openaiBody, openaiEvents } from "./openai";
import { PiParser } from "./pi";
import { ChatService } from "./service";

const lines = (file: string) =>
  fs
    .readFileSync(file, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l) as unknown);
const fx = (name: string) => lines(path.join(__dirname, "fixtures", name));
const usageOf = (events: ChatEvent[]) => events.filter((e): e is Extract<ChatEvent, { type: "usage" }> => e.type === "usage");

describe("Anthropic API", () => {
  it("wejście z message_start, wyjście narastająco z message_delta", () => {
    const acc = new UsageAcc();
    const sse = fs.readFileSync(path.join(__dirname, "..", "bot", "fixtures", "anthropic-tools.sse"), "utf8");
    for (const block of sse.split("\n\n")) {
      const data = block.split("\n").find((l) => l.startsWith("data: "));
      if (data) anthropicEvents(data.slice(6), undefined, acc);
    }
    expect(acc.seen).toBe(true);
    expect(acc.model).toBe("claude-sonnet-5-5");
    expect(acc.usage).toMatchObject({ input: 410, output: 89, cacheRead: 0, cacheWrite: 0 });
  });
  it("cache z message_start", () => {
    const acc = new UsageAcc();
    anthropicEvents(JSON.stringify({ type: "message_start", message: { usage: { input_tokens: 5, cache_read_input_tokens: 900, cache_creation_input_tokens: 40, output_tokens: 1 } } }), undefined, acc);
    expect(acc.usage).toMatchObject({ input: 5, cacheRead: 900, cacheWrite: 40 });
  });
  it("bez zużycia w strumieniu nie ma zdarzenia", () => {
    const acc = new UsageAcc();
    anthropicEvents(JSON.stringify({ type: "content_block_delta", delta: { type: "text_delta", text: "x" } }), undefined, acc);
    expect(acc.seen).toBe(false);
  });
});

describe("OpenAI-compat", () => {
  it("prosi o zużycie w strumieniu", () => {
    expect(openaiBody({ provider: { baseUrl: "x" }, model: "m", system: "s", messages: [] } as unknown as ChatRequest).stream_options).toEqual({ include_usage: true });
  });
  it("końcowy chunk bez choices; cache odjęty od wejścia, rozumowanie osobno", () => {
    const ev = openaiEvents(
      JSON.stringify({ choices: [], model: "Qwen", usage: { prompt_tokens: 1000, completion_tokens: 80, prompt_tokens_details: { cached_tokens: 600 }, completion_tokens_details: { reasoning_tokens: 30 } } }),
    );
    expect(ev).toEqual([{ type: "usage", model: "Qwen", usage: { input: 400, output: 80, cacheRead: 600, cacheWrite: 0, reasoning: 30 } }]);
  });
  it("zwykły chunk i `usage: null` nie dają zdarzenia", () => {
    expect(openaiEvents(JSON.stringify({ choices: [{ delta: { content: "a" } }], usage: null }))).toEqual([{ type: "text", text: "a" }]);
  });
});

describe("claude -p", () => {
  it("linia result: zużycie per model i koszt", () => {
    const p = new ClaudeParser();
    const u = usageOf(fx("claude-text.jsonl").flatMap((l) => p.line(l)));
    expect(u).toHaveLength(1);
    expect(u[0]).toMatchObject({ model: "claude-haiku-4-5-20251001", usage: { input: 453, output: 143, cacheRead: 0, cacheWrite: 0, reasoning: 94 }, costUsd: 0.001168 });
  });
  it("bez modelUsage: sumarycznie z usage", () => {
    const p = new ClaudeParser();
    const u = usageOf(p.line({ type: "result", usage: { input_tokens: 7, output_tokens: 3 }, total_cost_usd: 0 }));
    expect(u).toEqual([{ type: "usage", usage: { input: 7, output: 3, cacheRead: 0, cacheWrite: 0, reasoning: 0 } }]);
  });
  it("błąd modelu nadal zgłasza błąd, a zużycie i tak idzie", () => {
    const p = new ClaudeParser();
    const ev = p.line({ type: "result", is_error: true, result: "boom", usage: { input_tokens: 1, output_tokens: 1 } });
    expect(usageOf(ev)).toHaveLength(1);
    expect(p.failure()).toBe("boom");
  });
});

describe("codex exec", () => {
  it("turn.completed: wejście bez cache, rozumowanie", () => {
    const p = new CodexParser();
    const u = usageOf(fx("codex-search.jsonl").flatMap((l) => p.line(l)));
    expect(u).toHaveLength(1);
    expect(u[0].usage).toEqual({ input: 28814, output: 237, cacheRead: 0, cacheWrite: 0, reasoning: 63 });
  });
  it("cache odejmowany od wejścia", () => {
    const u = usageOf(new CodexParser().line({ type: "turn.completed", usage: { input_tokens: 1000, cached_input_tokens: 700, output_tokens: 10 } }));
    expect(u[0].usage).toMatchObject({ input: 300, cacheRead: 700 });
  });
});

describe("pi", () => {
  it("message_end asystenta niesie zużycie", () => {
    const p = new PiParser();
    const u = usageOf(fx("pi-search.jsonl").flatMap((l) => p.line(l)));
    expect(u.length).toBeGreaterThan(0);
    expect(u.every((e) => e.usage.input + e.usage.output > 0)).toBe(true);
  });
});

describe("ChatService", () => {
  const req = { provider: { id: "chatgpt", name: "ChatGPT", kind: "codex-cli", group: "sub", models: [] }, model: "gpt-5.6-luna", system: "", messages: [], prompt: "", search: false } as ChatRequest;

  it("zgłasza zużycie z dostawcą i modelem z żądania (adapter nie podał modelu)", async () => {
    const seen: unknown[] = [];
    const svc = new ChatService(
      { "codex-cli": async (_r, _s, emit) => void emit({ type: "usage", usage: { input: 1, output: 2, cacheRead: 0, cacheWrite: 0, reasoning: 0 } }) },
      {},
      (r) => seen.push(r),
    );
    await svc.send("1", req, () => {});
    expect(seen).toEqual([{ provider: "codex", model: "gpt-5.6-luna", usage: { input: 1, output: 2, cacheRead: 0, cacheWrite: 0, reasoning: 0 } }]);
  });
  it("zużycie po Stop też jest zapisane, choć nie idzie do okna", async () => {
    const seen: unknown[] = [];
    const out: ChatEvent[] = [];
    const svc = new ChatService(
      {
        "codex-cli": async (_r, signal, emit) => {
          svc.abort("1");
          expect(signal.aborted).toBe(true);
          emit({ type: "usage", usage: { input: 5, output: 5, cacheRead: 0, cacheWrite: 0, reasoning: 0 } });
        },
      },
      {},
      (r) => seen.push(r),
    );
    await svc.send("1", req, (e) => out.push(e));
    expect(seen).toHaveLength(1);
    expect(usageOf(out)).toHaveLength(0);
  });
});
