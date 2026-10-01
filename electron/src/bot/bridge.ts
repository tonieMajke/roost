//! Gniazdo unix w procesie głównym: serwery MCP `bot` (po jednym na uruchomienie claude/codex)
//! wołają przez nie rejestr narzędzi. Sesja = jedna odpowiedź bota, rozpoznawana po tokenie;
//! gniazdo ma prawa 0600, token chroni przed pomyłką sesji, nie przed innym użytkownikiem.

import { randomBytes } from "node:crypto";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import type { ToolSpec } from "../../../src/chat";
import { onLines } from "./bridge-client";
import type { ToolOutcome } from "./tools";

export type BridgeSession = {
  tools: ToolSpec[];
  /** Wywołanie z kontekstem bota i rozmowy (zgoda, zdarzenia `tool_call` / `tool_result`). */
  call(name: string, args: Record<string, unknown>): Promise<ToolOutcome>;
};

/** Serwer MCP do wpisania w konfigurację CLI (`ChatRequest.mcp`). */
export type McpServerSpec = { command: string; args: string[]; env: Record<string, string> };

export class ToolBridge {
  private sessions = new Map<string, BridgeSession>();
  private sockets = new Set<net.Socket>();

  private constructor(
    private server: net.Server,
    readonly socketPath: string,
  ) {}

  /** `dir`: `$XDG_RUNTIME_DIR` (prywatny katalog użytkownika); bez niego własny katalog w /tmp. */
  static async start(dir = process.env.XDG_RUNTIME_DIR || fs.mkdtempSync(path.join(os.tmpdir(), "agents-"))): Promise<ToolBridge> {
    const socketPath = path.join(dir, `agents-bot-${process.pid}.sock`);
    fs.rmSync(socketPath, { force: true }); // po awarii poprzedniego procesu o tym samym pid
    const server = net.createServer();
    const bridge = new ToolBridge(server, socketPath);
    server.on("connection", (s) => bridge.accept(s));
    const old = process.umask(0o177); // gniazdo od razu 0600, bez chwili z szerszymi prawami
    try {
      await new Promise<void>((resolve, reject) => {
        server.once("error", reject);
        server.listen(socketPath, () => resolve());
      });
    } finally {
      process.umask(old);
    }
    fs.chmodSync(socketPath, 0o600);
    return bridge;
  }

  /** Nowa sesja: zmienne środowiskowe dla serwera MCP. `dispose` po odpowiedzi (i przy Stop). */
  register(session: BridgeSession): { env: Record<string, string>; dispose(): void } {
    const token = randomBytes(24).toString("hex");
    this.sessions.set(token, session);
    return { env: { AW_BOT_SOCKET: this.socketPath, AW_BOT_TOKEN: token }, dispose: () => void this.sessions.delete(token) };
  }

  /** Polecenie serwera MCP: binarka aplikacji jako node z `mcp-server.cjs`. */
  static serverSpec(execPath: string, script: string, env: Record<string, string>): McpServerSpec {
    return { command: execPath, args: [script], env: { ELECTRON_RUN_AS_NODE: "1", ...env } };
  }

  private accept(sock: net.Socket): void {
    this.sockets.add(sock);
    sock.on("close", () => this.sockets.delete(sock));
    sock.on("error", () => {});
    onLines(sock, (line) => {
      let req: { id?: number; token?: string; op?: string; name?: unknown; args?: unknown };
      try {
        req = JSON.parse(line);
      } catch {
        return;
      }
      const reply = (r: { result?: unknown; error?: string }) => {
        if (!sock.destroyed) sock.write(`${JSON.stringify({ id: req.id, ...r })}\n`);
      };
      const s = typeof req.token === "string" ? this.sessions.get(req.token) : undefined;
      if (!s) return reply({ error: "rozmowa bota już się zakończyła" });
      if (req.op === "list") return reply({ result: s.tools });
      if (req.op === "call" && typeof req.name === "string") {
        const args = req.args && typeof req.args === "object" && !Array.isArray(req.args) ? (req.args as Record<string, unknown>) : {};
        s.call(req.name, args).then(
          (out) => reply({ result: { ok: out.ok, text: out.text } }),
          (e: unknown) => reply({ error: e instanceof Error ? e.message : String(e) }),
        );
        return;
      }
      reply({ error: "złe żądanie" });
    });
  }

  close(): void {
    for (const s of this.sockets) s.destroy();
    this.server.close();
    this.sessions.clear();
    fs.rmSync(this.socketPath, { force: true });
  }
}
