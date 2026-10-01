import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { applyEvent, extractSources, type ChatEvent, type ChatRequest, type Message } from "../../../src/chat";
import { CodexParser, codexArgs } from "./codex";

const req = (extra: Partial<ChatRequest> = {}): ChatRequest => ({
  provider: { id: "chatgpt", name: "ChatGPT", kind: "codex-cli", group: "sub", models: [] },
  model: "gpt-5.6-luna",
  system: 'Mów "krótko"\nproszę',
  messages: [],
  prompt: "hej",
  search: false,
  ...extra,
});

describe("codexArgs", () => {
  it("nowa rozmowa: exec, bez wyszukiwania, instrukcje jako napis TOML", () => {
    const a = codexArgs(req());
    expect(a[0]).toBe("exec");
    expect(a[1]).toBe("--json");
    expect(a).toContain('web_search="disabled"');
    expect(a).toContain('developer_instructions="Mów \\"krótko\\"\\nproszę"');
    expect(a.slice(-2)).toEqual(["-m", "gpt-5.6-luna"]);
  });
  it("wznowienie z wyszukiwaniem: exec resume … <id> na końcu", () => {
    const a = codexArgs(req({ search: true, session: { id: "t1", resume: true } }));
    expect(a.slice(0, 2)).toEqual(["exec", "resume"]);
    expect(a).toContain('web_search="live"');
    expect(a.at(-1)).toBe("t1");
  });
});

describe("CodexParser (nagrane wyjście codex 0.153)", () => {
  it("wyszukiwanie: zapowiedź do przemyśleń, odpowiedź na końcu tury, źródła z sekcji", () => {
    const p = new CodexParser();
    const lines = fs.readFileSync(path.join(__dirname, "fixtures", "codex-search.jsonl"), "utf8").split("\n").filter(Boolean);
    const events: ChatEvent[] = lines.flatMap((l) => p.line(JSON.parse(l)));
    expect(p.failure()).toBeNull();
    expect(events[0]).toEqual({ type: "session", id: "01a0f760-3613-78b0-93b6-43b7ef9149f7" });
    const m = extractSources(events.reduce(applyEvent, { id: "a", role: "assistant", text: "", at: 0 } as Message));
    expect(m.thinking).toContain("Sprawdzę");
    expect(m.searches).toEqual(["site:rust-lang.org latest stable Rust version release"]);
    expect(m.text).toMatch(/^Najnowsza stabilna wersja Rusta/);
    expect(m.text).not.toContain("Źródła");
    expect(m.sources).toEqual([{ url: "https://blog.rust-lang.org/releases/latest/", title: "Oficjalny blog Rust — Rust 1.98.1" }]);
  });

  it("ponowienia nie są błędem; turn.failed z niedostępnym modelem po polsku", () => {
    const p = new CodexParser();
    p.line({ type: "error", message: "Reconnecting... 2/5" });
    expect(p.failure()).toBeNull();
    p.line({ type: "turn.failed", error: { message: "unexpected status 404 Not Found: The model `gpt-5.5` does not exist or you do not have access to it., url: https://x" } });
    expect(p.failure()).toBe("model gpt-5.5 niedostępny w tej subskrypcji ChatGPT");
  });
});
