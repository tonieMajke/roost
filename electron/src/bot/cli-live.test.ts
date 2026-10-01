// Na żywo z claude i codex z subskrypcji: `AW_LIVE=1 pnpm vitest run electron/src/bot/cli-live.test.ts`
// (po `npm run build` w electron/). Bez AW_LIVE pominięte – zużywa limity i trwa kilka minut.

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { ChatEvent, ChatRequest, ProviderDef } from "../../../src/chat";
import { streamClaude } from "../chat/claude";
import { streamCodex } from "../chat/codex";
import { ToolBridge } from "./bridge";
import { reportedCall, type RunTool } from "./loop";

const SERVER = path.join(__dirname, "..", "..", "out", "mcp-server.cjs");
const TOOLS = [
  {
    name: "read_note",
    description: "Czyta notatkę użytkownika o podanym tytule.",
    parameters: { type: "object", properties: { title: { type: "string" } }, required: ["title"] },
  },
];
const PROMPT = "Przeczytaj notatkę „hasło dnia” narzędziem read_note i podaj dokładnie, co w niej jest. Nie zgaduj.";

/** Procesy serwera MCP. Nie `pgrep -f`: ścieżka serwera jest też w argumentach `-c` codex. */
const serverPids = () =>
  execFileSync("ps", ["-eo", "pid=,args="], { encoding: "utf8" })
    .split("\n")
    .map((l) => /^\s*(\d+) (.*)$/.exec(l))
    .filter((m): m is RegExpExecArray => m !== null && m[2] === `${process.execPath} ${SERVER}`)
    .map((m) => m[1]);

describe.skipIf(!process.env.AW_LIVE)("CLI z serwerem MCP bot (na żywo)", () => {
  let bridge: ToolBridge;
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "aw-live-"));
  beforeAll(async () => {
    bridge = await ToolBridge.start();
  });
  afterAll(() => {
    bridge.close();
    fs.rmSync(cwd, { recursive: true, force: true });
  });

  const turn = async (provider: ProviderDef, model: string, run: RunTool, signal = new AbortController().signal) => {
    const events: ChatEvent[] = [];
    let n = 0;
    const s = bridge.register({ tools: TOOLS, call: (name, args) => reportedCall({ id: `t${++n}`, name, args }, run, (e) => events.push(e)) });
    const req: ChatRequest = {
      provider,
      model,
      system: "Jesteś botem testowym. Masz narzędzie read_note.",
      messages: [],
      prompt: PROMPT,
      search: false,
      mcp: ToolBridge.serverSpec(process.execPath, SERVER, s.env),
    };
    const stream = provider.kind === "claude-cli" ? streamClaude : streamCodex;
    try {
      await stream(req, cwd, signal, (e) => events.push(e));
    } finally {
      s.dispose();
    }
    return events;
  };
  const text = (ev: ChatEvent[]) => ev.map((e) => (e.type === "text" ? e.text : "")).join("");
  const claude: ProviderDef = { id: "claude", name: "Claude", kind: "claude-cli", group: "sub", command: "claude", models: [] };
  const codex: ProviderDef = { id: "chatgpt", name: "ChatGPT", kind: "codex-cli", group: "sub", command: "codex", models: [] };

  it("claude czeka na „zgodę” 75 s bez zerwania wywołania", async () => {
    const ev = await turn(claude, "haiku", async (_n, a) => {
      await new Promise((r) => setTimeout(r, 75_000));
      return { ok: true, text: `Notatka „${String(a.title)}”: ZIELONY-JEŻ-42`, approval: "once" };
    });
    expect(ev.find((e) => e.type === "tool_call")).toMatchObject({ name: "read_note" });
    expect(text(ev)).toContain("ZIELONY-JEŻ-42");
  }, 240_000);

  it("codex ładuje serwer z -c, woła narzędzie bez własnej zgody i czeka 75 s", async () => {
    const ev = await turn(codex, "gpt-5.6-luna", async () => {
      await new Promise((r) => setTimeout(r, 75_000));
      return { ok: true, text: "ZIELONY-JEŻ-42", approval: "once" };
    });
    expect(ev.find((e) => e.type === "tool_call")).toMatchObject({ name: "read_note" });
    expect(text(ev)).toContain("ZIELONY-JEŻ-42");
  }, 240_000);

  it.each([
    ["claude", claude, "haiku"],
    ["codex", codex, "gpt-5.6-luna"],
  ] as const)("Stop w trakcie wywołania zabija %s i serwer MCP", async (_name, provider, model) => {
    const before = serverPids();
    const ctl = new AbortController();
    let seen: string[] = [];
    await turn(provider, model, async () => {
      seen = serverPids().filter((p) => !before.includes(p));
      ctl.abort();
      return { ok: false, text: "przerwane (Stop)", approval: "deny" };
    }, ctl.signal);
    expect(seen.length).toBe(1);
    await new Promise((r) => setTimeout(r, 1500));
    expect(serverPids().filter((p) => seen.includes(p))).toEqual([]);
  }, 240_000);
});
