import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ChatEvent, ChatRequest, ToolSpec } from "../../../src/chat";
import { claudeArgs, ClaudeParser } from "../chat/claude";
import { codexArgs } from "../chat/codex";
import { ToolBridge } from "./bridge";
import { reportedCall } from "./loop";
import { handleLine, type McpBackend } from "./mcp";

const TOOLS: ToolSpec[] = [{ name: "read_file", description: "Czyta plik", parameters: { type: "object", properties: { path: { type: "string" } } } }];

describe("handleLine (MCP)", () => {
  const backend: McpBackend = {
    list: async () => TOOLS,
    call: async (name, args) => (name === "read_file" ? { ok: true, text: `plik ${String(args.path)}` } : { ok: false, text: "nieznane" }),
  };
  const rpc = (o: unknown) => handleLine(JSON.stringify(o), backend);

  it("initialize odbija znaną wersję, nieznana = domyślna; powiadomienia bez odpowiedzi", async () => {
    expect(await rpc({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-03-26" } })).toMatchObject({
      id: 1,
      result: { protocolVersion: "2025-03-26", capabilities: { tools: {} }, serverInfo: { name: "bot" } },
    });
    expect(await rpc({ jsonrpc: "2.0", id: 2, method: "initialize", params: { protocolVersion: "1999-01-01" } })).toMatchObject({
      result: { protocolVersion: "2025-06-18" },
    });
    expect(await rpc({ jsonrpc: "2.0", method: "notifications/initialized" })).toBeNull();
    expect(await rpc({ jsonrpc: "2.0", id: 3, result: {} })).toBeNull(); // odpowiedź klienta
  });

  it("tools/list i tools/call; błąd narzędzia jako isError, nie błąd protokołu", async () => {
    expect(await rpc({ jsonrpc: "2.0", id: 1, method: "tools/list" })).toEqual({
      jsonrpc: "2.0",
      id: 1,
      result: { tools: [{ name: "read_file", description: "Czyta plik", inputSchema: TOOLS[0].parameters }] },
    });
    expect(await rpc({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "read_file", arguments: { path: "a" } } })).toMatchObject({
      result: { content: [{ type: "text", text: "plik a" }], isError: false },
    });
    expect(await rpc({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "x" } })).toMatchObject({ result: { isError: true } });
  });

  it("zły JSON, nieznana metoda, wyjątek z backendu", async () => {
    expect(await handleLine("{nie", backend)).toMatchObject({ id: null, error: { code: -32700 } });
    expect(await rpc({ jsonrpc: "2.0", id: 4, method: "resources/list" })).toMatchObject({ id: 4, error: { code: -32601 } });
    const broken: McpBackend = { list: () => Promise.reject(new Error("zerwane")), call: backend.call };
    expect(await handleLine(JSON.stringify({ jsonrpc: "2.0", id: 5, method: "tools/list" }), broken)).toMatchObject({ error: { message: "zerwane" } });
  });
});

// Prawdziwy zbudowany serwer (`npm run build`) jako proces, jak uruchamia go claude.
const SERVER = path.join(__dirname, "..", "..", "out", "mcp-server.cjs");

describe("ToolBridge + mcp-server.cjs", () => {
  let dir = "";
  let bridge: ToolBridge;
  let child: ChildProcessWithoutNullStreams | null = null;
  beforeEach(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "aw-bridge-"));
    bridge = await ToolBridge.start(dir);
  });
  afterEach(() => {
    child?.kill("SIGKILL");
    child = null;
    bridge.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  /** Serwer z env sesji; `send` zwraca odpowiedź o danym id. */
  const startServer = (env: Record<string, string>) => {
    const spec = ToolBridge.serverSpec(process.execPath, SERVER, env);
    const c = spawn(spec.command, spec.args, { env: { ...process.env, ...spec.env }, stdio: ["pipe", "pipe", "pipe"] });
    child = c;
    const replies = new Map<number, (r: Record<string, unknown>) => void>();
    let buf = "";
    c.stdout.setEncoding("utf8").on("data", (d: string) => {
      buf += d;
      let nl: number;
      while ((nl = buf.indexOf("\n")) >= 0) {
        const r = JSON.parse(buf.slice(0, nl)) as { id: number };
        buf = buf.slice(nl + 1);
        replies.get(r.id)?.(r);
      }
    });
    const send = (id: number, method: string, params?: unknown) =>
      new Promise<Record<string, unknown>>((resolve) => {
        replies.set(id, resolve);
        c.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
      });
    return { c, send };
  };

  it("gniazdo 0600; wywołanie przechodzi do sesji z kontekstem i zdarzeniami", async () => {
    // Windows: named pipe, bez pliku i praw uniksowych
    if (process.platform !== "win32") expect(fs.statSync(bridge.socketPath).mode & 0o777).toBe(0o600);
    const events: ChatEvent[] = [];
    let n = 0;
    const s = bridge.register({
      tools: TOOLS,
      call: (name, args) =>
        reportedCall({ id: `mcp-${++n}`, name, args }, async (_n, a) => ({ ok: true, text: `treść ${String(a.path)}`, approval: "once" }), (e) => events.push(e)),
    });
    const { send } = startServer(s.env);
    expect(await send(1, "initialize", { protocolVersion: "2025-06-18" })).toMatchObject({ result: { serverInfo: { name: "bot" } } });
    expect(await send(2, "tools/list")).toMatchObject({ result: { tools: [{ name: "read_file" }] } });
    expect(await send(3, "tools/call", { name: "read_file", arguments: { path: "/a" } })).toMatchObject({
      result: { content: [{ type: "text", text: "treść /a" }], isError: false },
    });
    expect(events).toEqual([
      { type: "tool_call", id: "mcp-1", name: "read_file", args: { path: "/a" } },
      { type: "tool_result", id: "mcp-1", text: "treść /a", error: false, approval: "once" },
    ]);
    s.dispose();
    expect(await send(4, "tools/list")).toMatchObject({ error: { message: "rozmowa bota już się zakończyła" } });
  });

  it("ping w trakcie długiego wywołania (czekanie na zgodę) dostaje odpowiedź od razu", async () => {
    let release: () => void = () => {};
    const s = bridge.register({
      tools: TOOLS,
      call: () => new Promise((r) => (release = () => r({ ok: true, text: "po zgodzie", approval: "once" }))),
    });
    const { send } = startServer(s.env);
    const slow = send(1, "tools/call", { name: "read_file", arguments: {} });
    expect(await send(2, "ping")).toMatchObject({ result: {} });
    release();
    expect(await slow).toMatchObject({ result: { content: [{ text: "po zgodzie" }] } });
  });

  it("zły token: błąd; koniec stdin i zamknięcie aplikacji kończą serwer", async () => {
    const { c, send } = startServer({ AW_BOT_SOCKET: bridge.socketPath, AW_BOT_TOKEN: "zly" });
    expect(await send(1, "tools/list")).toMatchObject({ error: { message: "rozmowa bota już się zakończyła" } });
    const exited = new Promise((r) => c.on("exit", r));
    c.stdin.end();
    expect(await exited).toBe(0);
    const second = startServer(bridge.register({ tools: [], call: async () => ({ ok: true, text: "", approval: "auto" }) }).env);
    await second.send(1, "ping");
    const gone = new Promise((r) => second.c.on("exit", r));
    bridge.close();
    expect(await gone).toBe(0);
  });
});

describe("argumenty CLI w trybie bota", () => {
  const req = (extra: Partial<ChatRequest> = {}): ChatRequest => ({
    provider: { id: "x", name: "x", kind: "claude-cli", group: "sub", models: [] },
    model: "m",
    system: "sys",
    messages: [],
    prompt: "hej",
    search: true,
    mcp: { command: "/opt/Agents/agents", args: ["/opt/Agents/mcp-server.cjs"], env: { ELECTRON_RUN_AS_NODE: "1", AW_BOT_TOKEN: 't"1' } },
    ...extra,
  });

  it("claude: plik konfiguracji, wbudowane tylko WebSearch/WebFetch, dozwolone mcp__bot__*", () => {
    const a = claudeArgs(req(), "/tmp/x/mcp.json");
    expect(a.slice(a.indexOf("--mcp-config"), a.indexOf("--mcp-config") + 2)).toEqual(["--mcp-config", "/tmp/x/mcp.json"]);
    expect(a).toContain("--strict-mcp-config");
    expect(a[a.indexOf("--tools") + 1]).toBe("WebSearch,WebFetch");
    expect(a[a.indexOf("--allowedTools") + 1]).toBe("mcp__bot__*,WebSearch,WebFetch");
    const off = claudeArgs(req({ search: false }), "/tmp/x/mcp.json");
    expect(off[off.indexOf("--tools") + 1]).toBe("");
    expect(off[off.indexOf("--allowedTools") + 1]).toBe("mcp__bot__*");
  });

  it("codex: serwer z -c, env jako tabela TOML, długi limit czasu, nadal read-only", () => {
    const a = codexArgs(req());
    expect(a).toContain('sandbox_mode="read-only"');
    expect(a).toContain('mcp_servers.bot.command="/opt/Agents/agents"');
    expect(a).toContain('mcp_servers.bot.args=["/opt/Agents/mcp-server.cjs"]');
    expect(a).toContain('mcp_servers.bot.env={ ELECTRON_RUN_AS_NODE = "1", AW_BOT_TOKEN = "t\\"1" }');
    expect(a.some((x) => /^mcp_servers\.bot\.tool_timeout_sec=\d+$/.test(x))).toBe(true);
    expect(codexArgs(req({ mcp: undefined })).some((x) => x.startsWith("mcp_servers"))).toBe(false);
  });

  it("parser claude nie myli wywołań mcp__bot__* z wyszukiwaniem", () => {
    const p = new ClaudeParser();
    const out = p.line({ type: "assistant", message: { content: [{ type: "tool_use", name: "mcp__bot__web_search", input: { query: "x" } }] } });
    expect(out).toEqual([]);
  });
});
