//! Proces serwera MCP `bot` (`ELECTRON_RUN_AS_NODE=1 <exe> mcp-server.cjs`), uruchamiany przez
//! claude albo codex. Każde `tools/list` i `tools/call` idzie gniazdem unix do procesu głównego
//! (`AW_BOT_SOCKET`, sesja = `AW_BOT_TOKEN`). Koniec stdin (CLI zamknięte albo zabite) = koniec.

import net from "node:net";
import type { ToolSpec } from "../../../src/chat";
import { handleLine, type McpBackend } from "./mcp";
import { BridgeClient } from "./bridge-client";

const socketPath = process.env.AW_BOT_SOCKET ?? "";
const token = process.env.AW_BOT_TOKEN ?? "";

const client = new BridgeClient(net.connect(socketPath), token);
client.onClose(() => process.exit(0)); // aplikacja zamknięta: claude zobaczy zerwany serwer

const backend: McpBackend = {
  list: () => client.request({ op: "list" }) as Promise<ToolSpec[]>,
  call: (name, args) => client.request({ op: "call", name, args }) as Promise<{ ok: boolean; text: string }>,
};

let buf = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (d: string) => {
  buf += d;
  let nl: number;
  while ((nl = buf.indexOf("\n")) >= 0) {
    const line = buf.slice(0, nl).trim();
    buf = buf.slice(nl + 1);
    if (!line) continue;
    // Bez czekania: claude może wysłać `ping` w trakcie długiego `tools/call` (zgoda użytkownika).
    void handleLine(line, backend).then((reply) => {
      if (reply) process.stdout.write(`${JSON.stringify(reply)}\n`);
    });
  }
});
process.stdin.on("end", () => process.exit(0));
process.stdin.on("error", () => process.exit(0));
