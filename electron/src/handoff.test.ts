import { describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { MAX_COMMANDS, MAX_PROMPTS, PROMPT_CHARS, digest, handoffIn, sessionHandoff } from "./handoff";

const ID = "3948700d-cd47-43c0-be0d-1db71d5d5e09";
const lines = (v: unknown[]) => v.map((x) => (typeof x === "string" ? x : JSON.stringify(x))).join("\n");
const claudeUser = (text: string) => ({ type: "user", message: { role: "user", content: text } });
const claudeAssistant = (content: unknown) => ({ type: "assistant", message: { role: "assistant", content } });

describe("handoff", () => {
  it("claude: polecenia, odpowiedzi, pliki i komendy", () => {
    const text = lines([
      claudeUser("napraw testy"),
      claudeUser("<command-name>/model</command-name>"),
      { type: "user", isMeta: true, message: { role: "user", content: "caveat" } },
      claudeAssistant([
        { type: "text", text: "Patrzę." },
        { type: "tool_use", id: "1", name: "Edit", input: { file_path: "/p/a.ts" } },
        { type: "tool_use", id: "2", name: "Read", input: { file_path: "/p/read-only.ts" } },
      ]),
      { type: "user", message: { role: "user", content: [{ type: "tool_result", tool_use_id: "1", content: "ok" }] } },
      claudeAssistant([{ type: "tool_use", id: "3", name: "Bash", input: { command: "pnpm   test\n --run" } }]),
      { type: "assistant", isSidechain: true, message: { role: "assistant", content: [{ type: "text", text: "subagent" }] } },
      claudeAssistant([
        { type: "tool_use", id: "4", name: "Write", input: { file_path: "/p/b.ts" } },
        { type: "tool_use", id: "5", name: "Edit", input: { file_path: "/p/a.ts" } },
      ]),
      { type: "user", message: { role: "user", content: [{ type: "text", text: "a teraz lint" }, { type: "image" }] } },
      claudeAssistant([{ type: "text", text: "Gotowe." }]),
      "not json",
    ]);
    const h = digest(text, "claude");
    expect(h.prompts).toEqual(["napraw testy", "a teraz lint"]);
    expect(h.replies).toEqual(["Patrzę.", "Gotowe."]);
    expect(h.files).toEqual(["/p/a.ts", "/p/b.ts"]); // od najnowszego, bez powtórzeń, Read to nie zmiana
    expect(h.commands).toEqual(["pnpm test --run"]);
  });

  it("pi: wiadomości i wywołania narzędzi", () => {
    const text = lines([
      { type: "session", id: ID },
      { type: "message", message: { role: "user", content: [{ type: "text", text: "dodaj eksport" }] } },
      { type: "message", message: { role: "assistant", content: [
        { type: "text", text: "Dodaję." },
        { type: "toolCall", id: "c1", name: "write", arguments: { path: "src/x.ts" } },
        { type: "toolCall", id: "c2", name: "bash", arguments: { command: "pnpm build" } },
      ] } },
      { type: "message", message: { role: "toolResult", content: [{ type: "text", text: "built" }] } },
    ]);
    const h = digest(text, "pi");
    expect(h).toEqual({ prompts: ["dodaj eksport"], replies: ["Dodaję."], files: ["src/x.ts"], commands: ["pnpm build"] });
  });

  it("zostawia najnowsze i tnie na granicy znaku", () => {
    const v: unknown[] = Array.from({ length: 8 }, (_, i) => claudeUser(`prompt ${i}`));
    v.push(claudeUser("ż".repeat(PROMPT_CHARS + 50)));
    for (let i = 0; i < MAX_COMMANDS + 3; i++) {
      v.push(claudeAssistant([{ type: "tool_use", id: String(i), name: "Bash", input: { command: `cmd ${i}` } }]));
    }
    const h = digest(lines(v), "claude");
    expect(h.prompts.length).toBe(MAX_PROMPTS);
    expect(h.prompts[0]).toBe("prompt 4");
    const last = h.prompts.at(-1)!;
    expect(Array.from(last).length).toBe(PROMPT_CHARS);
    expect(last.endsWith("ż…")).toBe(true);
    expect(h.commands[0]).toBe("cmd 3");
    expect(h.commands.length).toBe(MAX_COMMANDS);
  });

  it("sessionHandoff czyta folder konta, nie ~/.claude", () => {
    const acc = fs.mkdtempSync(path.join(os.tmpdir(), "aw-handoff-acc-"));
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "aw-handoff-home-"));
    try {
      fs.mkdirSync(path.join(acc, "projects", "-p"), { recursive: true });
      fs.writeFileSync(path.join(acc, "projects", "-p", `${ID}.jsonl`), lines([claudeUser("z konta")]));
      expect(sessionHandoff("claude", ID, home, acc)!.prompts).toEqual(["z konta"]);
      expect(sessionHandoff("claude", ID, home)).toBeNull();
    } finally {
      fs.rmSync(acc, { recursive: true, force: true });
      fs.rmSync(home, { recursive: true, force: true });
    }
  });

  it("znajduje plik, odrzuca pustą rozmowę i złe id", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "aw-handoff-"));
    try {
      fs.mkdirSync(path.join(root, "-home-x"));
      const file = path.join(root, "-home-x", `${ID}.jsonl`);
      fs.writeFileSync(file, lines([claudeUser("hej")]));
      expect(handoffIn(root, "claude", ID)!.prompts).toEqual(["hej"]);
      fs.writeFileSync(file, lines([claudeUser("<x>")]));
      expect(handoffIn(root, "claude", ID)).toBeNull();
      expect(handoffIn(root, "claude", "../x")).toBeNull();
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
