// Rozmowa głosowa na claude CLI z narzędziami okna, na żywo (Haiku z subskrypcji):
// `AW_LIVE=1 pnpm vitest run electron/src/chat/voice-cli-live.test.ts` (po `npm run build` w electron/).

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { ChatEvent, ChatRequest, ProviderDef } from "../../../src/chat";
import { overviewText, runVoiceTool, voiceTools, type VoiceHost, type VoiceProject } from "../../../src/voice/tools";
import { voicePrompt } from "../../../src/voice/voice";
import { ToolBridge } from "../bot/bridge";
import { streamClaude } from "./claude";
import { WindowTools } from "./window-tools";

const SERVER = path.join(__dirname, "..", "..", "out", "mcp-server.cjs");
const PROJECTS: VoiceProject[] = [
  {
    id: "p00001",
    name: "Sklep",
    active: true,
    panes: [{ id: "a1b2c3", agent: "Claude", title: "migracja bazy", working: false, unread: true, exited: 3 }],
  },
];

describe.skipIf(!process.env.AW_LIVE)("głos na claude CLI z narzędziami (na żywo)", () => {
  it("Haiku woła read_pane przez MCP, okno odpowiada, odpowiedź mówi o wyniku", async () => {
    const reads: string[] = [];
    const host = {
      projects: () => PROJECTS,
      agents: () => [],
      presets: () => [],
      read: (id: string) => (reads.push(id), "Error: relation \"orders_v2\" does not exist\nMigration 0042 failed"),
    } as unknown as VoiceHost;
    const bridge = await ToolBridge.start();
    const win = new WindowTools();
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "aw-voice-live-"));
    const events: ChatEvent[] = [];
    const emit = (e: ChatEvent) => {
      events.push(e);
      if (e.type === "tool_request")
        void runVoiceTool(e.name, e.args, host, new AbortController().signal).then((r) => win.resolve(e.id, r.ok, r.text));
    };
    const s = bridge.register({ tools: voiceTools(["claude"]), call: async (name, args) => ({ ...(await win.call("r", emit, name, args)), approval: "auto" }) });
    const provider = { id: "claude", name: "Claude", kind: "claude-cli", group: "sub", models: [] } as ProviderDef;
    const req: ChatRequest = {
      provider,
      model: "haiku",
      system: voicePrompt(new Date(), overviewText(PROJECTS)),
      messages: [],
      prompt: "Dlaczego padł panel od migracji? Przeczytaj jego ekran.",
      search: false,
      mcp: ToolBridge.serverSpec(process.execPath, SERVER, s.env),
    };
    try {
      await streamClaude(req, cwd, new AbortController().signal, emit);
    } finally {
      s.dispose();
      bridge.close();
      fs.rmSync(cwd, { recursive: true, force: true });
    }
    const text = events.flatMap((e) => (e.type === "text" ? [e.text] : [])).join("");
    console.log(events.filter((e) => e.type === "tool_request"), text);
    expect(reads).toEqual(["a1b2c3"]);
    expect(text).toMatch(/orders_v2|0042|tabel|relac/i);
  }, 180_000);
});
