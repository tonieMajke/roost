//! Serwer MCP `bot` bez SDK: JSON-RPC 2.0, jedna wiadomość na linię (transport stdio).
//! Obsługuje tylko to, czego potrzebują claude i codex: `initialize`, `ping`, `tools/list`,
//! `tools/call`. Narzędzia i ich wykonanie są w procesie głównym (`bridge.ts`).

import type { ToolSpec } from "../../../src/chat";

export type McpBackend = {
  list(): Promise<ToolSpec[]>;
  call(name: string, args: Record<string, unknown>): Promise<{ ok: boolean; text: string }>;
};

const PROTOCOL = "2025-06-18";
const KNOWN_PROTOCOLS = ["2025-11-25", PROTOCOL, "2025-03-26", "2024-11-05"];

type Rpc = { jsonrpc?: string; id?: string | number | null; method?: string; params?: Record<string, unknown> };
type Reply = { jsonrpc: "2.0"; id: string | number | null; result?: unknown; error?: { code: number; message: string } };

const ok = (id: Reply["id"], result: unknown): Reply => ({ jsonrpc: "2.0", id, result });
const err = (id: Reply["id"], code: number, message: string): Reply => ({ jsonrpc: "2.0", id, error: { code, message } });

/** Odpowiedź na jedną linię; `null` = powiadomienie albo odpowiedź klienta (bez odpowiedzi). */
export async function handleLine(line: string, backend: McpBackend): Promise<Reply | null> {
  let msg: Rpc;
  try {
    msg = JSON.parse(line) as Rpc;
  } catch {
    return err(null, -32700, "parse error");
  }
  if (!msg || typeof msg !== "object" || typeof msg.method !== "string") return null;
  const id = msg.id;
  if (id === undefined || id === null) return null; // powiadomienie (`notifications/initialized` itd.)
  const params = msg.params ?? {};
  try {
    switch (msg.method) {
      case "initialize": {
        const asked = params.protocolVersion;
        return ok(id, {
          protocolVersion: typeof asked === "string" && KNOWN_PROTOCOLS.includes(asked) ? asked : PROTOCOL,
          capabilities: { tools: {} },
          serverInfo: { name: "bot", version: "1.0.0" },
        });
      }
      case "ping":
        return ok(id, {});
      case "tools/list": {
        const tools = await backend.list();
        return ok(id, { tools: tools.map((t) => ({ name: t.name, description: t.description, inputSchema: t.parameters })) });
      }
      case "tools/call": {
        const name = params.name;
        if (typeof name !== "string") return err(id, -32602, "brak `name`");
        const a = params.arguments;
        const args = a && typeof a === "object" && !Array.isArray(a) ? (a as Record<string, unknown>) : {};
        const out = await backend.call(name, args);
        return ok(id, { content: [{ type: "text", text: out.text }], isError: !out.ok });
      }
      default:
        return err(id, -32601, `nieznana metoda: ${msg.method}`);
    }
  } catch (e) {
    return err(id, -32603, e instanceof Error ? e.message : String(e));
  }
}
