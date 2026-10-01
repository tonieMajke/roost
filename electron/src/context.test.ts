import { afterEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  COMMAND_CHARS, MAX_TOOLS, TAIL_BYTES, claudeTitle, contextIn, lastTools, lastUsage, newTitleScan, piWindow, readLast,
  sessionTitle, titleScan,
} from "./context";

const ID = "3948700d-cd47-43c0-be0d-1db71d5d5e09";

const dirs: string[] = [];
/** Świeży katalog na test; nigdy prawdziwe `~/.claude` ani `~/.pi`. */
const tempDir = () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "aw-context-"));
  dirs.push(d);
  return d;
};
afterEach(() => dirs.splice(0).forEach((d) => fs.rmSync(d, { recursive: true, force: true })));

const claudeLine = (input: number, read: number, create: number) =>
  JSON.stringify({
    type: "assistant", isSidechain: false,
    message: { model: "claude-opus-5-5", usage: { input_tokens: input, cache_read_input_tokens: read, cache_creation_input_tokens: create, output_tokens: 99 } },
  });
const piLine = (input: number, read: number, write: number) =>
  JSON.stringify({
    type: "message",
    message: { role: "assistant", provider: "local", model: "gpt-5", usage: { input, output: 7, cacheRead: read, cacheWrite: write, totalTokens: 1 } },
  });

describe("context", () => {
  it("claude: suma najnowszego usage", () => {
    const root = tempDir();
    fs.mkdirSync(path.join(root, "-home-x"));
    const text = [
      claudeLine(1, 2, 3),
      '{"type":"user","message":{"content":"hi"}}',
      claudeLine(10, 20_000, 300),
      '{"type":"user","message":{"content":"tool result"}}',
    ].join("\n");
    fs.writeFileSync(path.join(root, "-home-x", `${ID}.jsonl`), text);
    const got = contextIn(root, "claude", ID)!;
    expect([got.tokens, got.model]).toEqual([20_310, "claude-opus-5-5"]);
  });

  it("pi: plik po id za znacznikiem czasu", () => {
    const root = tempDir();
    const dir = path.join(root, "--home-x--");
    fs.mkdirSync(dir);
    fs.writeFileSync(path.join(dir, "2026-09-30T17-29-04-910Z_other.jsonl"), piLine(9, 9, 9));
    fs.writeFileSync(path.join(dir, `2026-09-30T17-29-04-910Z_${ID}.jsonl`), piLine(100, 2_000, 30));
    const got = contextIn(root, "pi", ID)!;
    expect([got.tokens, got.model, got.provider]).toEqual([2_130, "gpt-5", "local"]);
  });

  it("pomija podagentów, zera i zepsute linie", () => {
    const side = '{"isSidechain":true,"message":{"usage":{"input_tokens":5}}}';
    const text = [claudeLine(1, 1, 1), side, claudeLine(0, 0, 0), '{"usage": broken'].join("\n");
    expect(lastUsage(text, "claude")!.tokens).toBe(3);
    expect(lastUsage("no usage here", "claude")).toBeNull();
  });

  it("czyta tylko koniec i odrzuca uciętą linię", () => {
    const root = tempDir();
    const file = path.join(root, "s.jsonl");
    // usage tylko na początku, potem ponad TAIL_BYTES innych linii: poza zasięgiem
    const filler = `{"type":"user","text":"${"x".repeat(1000)}"}\n`;
    let text = claudeLine(1, 1, 1) + "\n";
    while (text.length < TAIL_BYTES + 5000) text += filler;
    fs.writeFileSync(file, text);
    const tail = readLast(file, TAIL_BYTES)!;
    expect(tail.length).toBeLessThanOrEqual(TAIL_BYTES);
    expect(tail.startsWith('{"type":"user"')).toBe(true);
    expect(lastUsage(tail, "claude")).toBeNull();
    text += claudeLine(5, 5, 5);
    fs.writeFileSync(file, text);
    expect(lastUsage(readLast(file, TAIL_BYTES)!, "claude")!.tokens).toBe(15);
  });

  it("okno pi: własny models.json i dostawca mają pierwszeństwo", () => {
    const dir = tempDir();
    const own = '{"providers":{"local":{"apiKey":"x","models":[{"id":"Flash","contextWindow":262144}]}}}';
    const store = `{"local":{"models":[{"id":"Flash","contextWindow":1000}]},
      "openrouter":{"models":[{"id":"Flash","contextWindow":64000},{"id":"big","contextWindow":1000000}]}}`;
    fs.writeFileSync(path.join(dir, "models.json"), own);
    fs.writeFileSync(path.join(dir, "models-store.json"), store);
    expect(piWindow(dir, "local", "Flash")).toBe(262_144);
    expect(piWindow(dir, "openrouter", "Flash")).toBe(64_000);
    expect(piWindow(dir, "gone", "big")).toBe(1_000_000);
    expect(piWindow(dir, null, "nope")).toBeNull();
    // zmieniony models.json jest czytany ponownie
    const later = new Date(Date.now() + 5000);
    fs.writeFileSync(path.join(dir, "models.json"), own.replace("262144", "131072"));
    fs.utimesSync(path.join(dir, "models.json"), later, later);
    expect(piWindow(dir, "local", "Flash")).toBe(131_072);
  });

  it("narzędzia claude: najnowsze na końcu, bez podagentów", () => {
    const long = `pnpm test \\\n  --run ${"x".repeat(100)}`;
    const text = [
      '{"type":"assistant","message":{"content":[{"type":"tool_use","id":"t1","name":"Read","input":{"file_path":"/p/src/a.ts"}}]}}',
      '{"type":"assistant","isSidechain":true,"message":{"content":[{"type":"tool_use","id":"side","name":"Grep","input":{}}]}}',
      '{"type":"user","message":{"content":[{"type":"tool_result","tool_use_id":"t1","content":"tool_use"}]}}',
      JSON.stringify({
        type: "assistant",
        message: { content: [
          { type: "text", text: "ok" },
          { type: "tool_use", id: "t2", name: "Bash", input: { command: long } },
          { type: "tool_use", id: "t3", name: "Glob", input: { pattern: "*.ts" } },
        ] },
      }),
    ].join("\n");
    const got = lastTools(text, "claude");
    expect(got.map((t) => t.id)).toEqual(["t1", "t2", "t3"]);
    expect(got[0].file).toBe("/p/src/a.ts");
    expect(got[1].command!.startsWith("pnpm test \\ --run xxx")).toBe(true);
    expect(Array.from(got[1].command!).length).toBe(COMMAND_CHARS);
    expect([got[2].file, got[2].command]).toEqual([null, null]);
  });

  it("narzędzia pi z bloków toolCall", () => {
    const call = (id: number) =>
      JSON.stringify({
        type: "message",
        message: { role: "assistant", content: [
          { type: "thinking", thinking: "toolCall" },
          { type: "toolCall", id: `c${id}`, name: "edit", arguments: { path: "src/x.ts", oldText: "a" } },
        ] },
      });
    const lines = Array.from({ length: 12 }, (_, i) => call(i));
    lines.push('{"type":"message","message":{"role":"toolResult","toolCallId":"c11","content":[]}}');
    const got = lastTools(lines.join("\n"), "pi");
    expect(got.length).toBe(MAX_TOOLS);
    expect([got[0].id, got[9].id]).toEqual(["c2", "c11"]);
    expect([got[9].name, got[9].file]).toEqual(["edit", "src/x.ts"]);
  });

  it("odczyt sesji niesie narzędzia", () => {
    const root = tempDir();
    fs.mkdirSync(path.join(root, "-home-x"));
    const tool = '{"type":"assistant","message":{"usage":{"input_tokens":4},"content":[{"type":"tool_use","id":"t9","name":"Write","input":{"file_path":"/a"}}]}}';
    fs.writeFileSync(path.join(root, "-home-x", `${ID}.jsonl`), [claudeLine(1, 1, 1), tool].join("\n"));
    const got = contextIn(root, "claude", ID)!;
    expect([got.tokens, got.tools.length, got.tools[0].name]).toEqual([4, 1, "Write"]);
  });

  it("tytuł claude: /rename wygrywa z tytułem AI", () => {
    const ai = (t: string) => `{"type":"ai-title","aiTitle":"${t}","sessionId":"x"}`;
    const text = [ai("Stary"), claudeLine(1, 1, 1), ai("Naprawa  paska\\nxterm")].join("\n");
    expect(claudeTitle(text)).toBe("Naprawa paska xterm");
    const renamed = ['{"type":"custom-title","customTitle":"Moja nazwa","sessionId":"x"}', text].join("\n");
    expect(claudeTitle(renamed)).toBe("Moja nazwa");
    // wynik narzędzia cytujący wpis to nie wpis (linia nie zaczyna się od niego)
    expect(claudeTitle('{"type":"user","content":"{\\"type\\":\\"ai-title\\"}"}')).toBeNull();
  });

  it("tytuł pi: nazwa albo pierwsze polecenie, czytane przyrostowo", () => {
    const root = tempDir();
    const file = path.join(root, "s.jsonl");
    const user = (t: string) => JSON.stringify({ type: "message", message: { role: "user", content: [{ type: "text", text: t }] } });
    let text = `${user("Pierwsze pytanie")}\n${piLine(1, 1, 1)}\n${user("drugie")}\n`;
    fs.writeFileSync(file, text);
    const state = newTitleScan();
    titleScan(file, "pi", state);
    expect([state.name, state.firstPrompt]).toEqual([null, "Pierwsze pytanie"]);
    expect(state.offset).toBe(Buffer.byteLength(text));
    // nazwa przychodzi później; niedopisana linia czeka na następny odczyt
    const half = '{"type":"session_info","na';
    text += '{"type":"session_info","name":"Etap 11"}\n' + half;
    fs.writeFileSync(file, text);
    titleScan(file, "pi", state);
    expect(state.name).toBe("Etap 11");
    expect(state.offset).toBe(Buffer.byteLength(text) - half.length);
    // krótszy (przepisany) plik: od nowa
    fs.writeFileSync(file, user("Nowy") + "\n");
    titleScan(file, "pi", state);
    expect([state.name, state.firstPrompt]).toEqual([null, "Nowy"]);
  });

  it("tytuł claude bez tytułu AI: pierwsze wpisane polecenie", () => {
    const root = tempDir();
    const file = path.join(root, "s.jsonl");
    const user = (content: unknown, extra: object = {}) =>
      JSON.stringify({ parentUuid: null, type: "user", message: { role: "user", content }, ...extra });
    const lines = [
      user("<local-command-caveat>Caveat</local-command-caveat>"),
      user("Wstęp z hooka", { isMeta: true }),
      user("zadanie podagenta", { isSidechain: true }),
      user([{ type: "tool_result", tool_use_id: "t", content: "x" }]),
      user("hej"),
      claudeLine(1, 1, 1),
      user("napisz historię"),
    ];
    fs.writeFileSync(file, lines.join("\n") + "\n");
    expect(sessionTitle(file, "claude", readLast(file, TAIL_BYTES)!)).toBe("hej");
    const ai = '{"type":"ai-title","aiTitle":"Powitanie i historia o koniach","sessionId":"x"}';
    fs.writeFileSync(file, lines.join("\n") + "\n" + ai + "\n");
    expect(sessionTitle(file, "claude", readLast(file, TAIL_BYTES)!)).toBe("Powitanie i historia o koniach");
  });

  it("polskie znaki na granicy kawałków odczytu zostają całe", () => {
    const root = tempDir();
    const file = path.join(root, "s.jsonl");
    const pad = JSON.stringify({ type: "x", pad: "a".repeat(64 * 1024 - 20) });
    const user = JSON.stringify({ type: "message", message: { role: "user", content: "żółć ".repeat(10) } });
    fs.writeFileSync(file, `${pad}\n${user}\n`);
    const state = newTitleScan();
    titleScan(file, "pi", state);
    expect(state.firstPrompt).toBe("żółć ".repeat(10).trim());
  });

  it("odrzuca id, które nie są UUID", () => {
    const root = tempDir();
    fs.writeFileSync(path.join(root, "..jsonl"), claudeLine(1, 1, 1));
    for (const id of ["", "..", "../x", "a/b", "ABC"]) expect(contextIn(root, "claude", id)).toBeNull();
    expect(contextIn(root, "claude", ID)).toBeNull();
  });
});
