import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { applyEvent, type ChatEvent, type ChatRequest, type Message } from "../../../src/chat";
import { ChatService } from "./service";
import { PiParser, piArgs, piModelsJson } from "./pi";

const req = (extra: Partial<ChatRequest> = {}): ChatRequest => ({
  provider: { id: "llama", name: "llama", kind: "openai", group: "local", baseUrl: "http://127.0.0.1:8080/v1", models: [] },
  model: "Qwen",
  system: "sys",
  messages: [],
  prompt: "hej",
  search: true,
  ...extra,
});

describe("pi: konfiguracja", () => {
  it("models.json: jeden dostawca, klucz tylko jako zmienna", () => {
    const j = JSON.parse(piModelsJson(req()));
    expect(j.providers.aw).toMatchObject({ baseUrl: "http://127.0.0.1:8080/v1", api: "openai-completions", apiKey: "$AW_CHAT_API_KEY" });
    expect(j.providers.aw.models[0].id).toBe("Qwen");
    const a = JSON.parse(piModelsJson(req({ provider: { id: "a", name: "a", kind: "anthropic", group: "api", baseUrl: "https://api.anthropic.com/v1", models: [] } })));
    expect(a.providers.aw).toMatchObject({ baseUrl: "https://api.anthropic.com", api: "anthropic-messages" });
  });
  it("argumenty: tylko narzędzia wyszukiwania, bez sesji i rozszerzeń poza pi-web-access", () => {
    const a = piArgs(req(), "/ext");
    expect(a).toEqual(expect.arrayContaining(["--no-session", "-ne", "-nc"]));
    expect(a.slice(a.indexOf("-e"), a.indexOf("-e") + 2)).toEqual(["-e", "/ext"]);
    expect(a.slice(a.indexOf("--tools"), a.indexOf("--tools") + 2)).toEqual(["--tools", "web_search,fetch_content"]);
    expect(a.slice(-6)).toEqual(["--provider", "aw", "--model", "Qwen", "--system-prompt", "sys"]);
  });
});

describe("PiParser (nagrane wyjście pi 0.99, lokalny Qwen + Exa)", () => {
  it("zapytanie, znalezione strony, myślenie, tekst", () => {
    const p = new PiParser();
    const lines = fs.readFileSync(path.join(__dirname, "fixtures", "pi-search.jsonl"), "utf8").split("\n").filter(Boolean);
    const events: ChatEvent[] = lines.flatMap((l) => p.line(JSON.parse(l)));
    expect(p.failure()).toBeNull();
    const m = events.reduce(applyEvent, { id: "a", role: "assistant", text: "", at: 0 } as Message);
    expect(m.searches).toEqual(["latest stable version of Rust 2025"]);
    expect(m.found?.map((f) => f.url)).toEqual([
      "https://doc.rust-lang.org/stable/releases.html",
      "https://blog.rust-lang.org/2025/12/11/Rust-1.92.0/",
      "https://blog.rust-lang.org/2025/10/30/Rust-1.91.0/",
    ]);
    expect(m.thinking).toContain("latest stable version");
    expect(m.text).toBe("Najnowsza stabilna wersja Rusta to **1.98.1** (wydana 3 września 2026).");
  });
  it("błąd modelu w message_end", () => {
    const p = new PiParser();
    p.line({ type: "message_end", message: { role: "assistant", stopReason: "error", errorMessage: "Connection error." } });
    expect(p.failure()).toBe("Connection error.");
  });
});

it("ChatService: wyszukiwanie z dostawcą HTTP idzie przez adapter pi", async () => {
  const used: string[] = [];
  const s = new ChatService(
    {
      openai: async () => void used.push("openai"),
      pi: async () => void used.push("pi"),
      "claude-cli": async () => void used.push("claude"),
    },
    {},
  );
  await s.send("1", req({ search: false }), () => {});
  await s.send("2", req({ search: true }), () => {});
  await s.send("3", req({ search: true, provider: { id: "c", name: "c", kind: "claude-cli", group: "sub", models: [] } }), () => {});
  expect(used).toEqual(["openai", "pi", "claude"]);
});
