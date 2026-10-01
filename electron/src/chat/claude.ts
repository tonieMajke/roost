//! Claude z subskrypcji: `claude -p` ze strumieniem JSON. Bez narzędzi poza wyszukiwaniem,
//! bez MCP, ustawień i CLAUDE.md (własny pusty katalog roboczy, ten sam dla `--resume`).
//! Tryb bota (`req.mcp`): dochodzi tylko serwer MCP `bot`, wbudowane Bash/Edit dalej wyłączone.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { ChatEvent, ChatRequest } from "../../../src/chat";
import { runCli, type LineParser } from "./cli";

const SEARCH_TOOLS = "WebSearch,WebFetch";
/** Folder użytkownika: tylko czytanie i szukanie, bez Bash/Edit/Write. */
const FOLDER_TOOLS = "Read,Grep,Glob";
/** Narzędzie czeka na zgodę użytkownika: claude nie może zerwać wywołania po domyślnym limicie. */
export const MCP_TOOL_TIMEOUT_MS = 6 * 60 * 60 * 1000;

const tools = (req: ChatRequest) => [...(req.folder ? [FOLDER_TOOLS] : []), ...(req.search ? [SEARCH_TOOLS] : [])].join(",");

/** `mcpConfig`: plik z serwerem `bot` (tryb bota). */
export function claudeArgs(req: ChatRequest, mcpConfig?: string): string[] {
  const args = [
    "-p", "--output-format", "stream-json", "--verbose", "--include-partial-messages",
    "--strict-mcp-config", "--disable-slash-commands", "--setting-sources", "",
    "--system-prompt", req.system,
    "--tools", tools(req),
  ];
  if (mcpConfig) args.push("--mcp-config", mcpConfig);
  const allowed = [...(mcpConfig ? ["mcp__bot__*"] : []), ...(tools(req) ? [tools(req)] : [])];
  if (allowed.length) args.push("--allowedTools", allowed.join(","));
  if (req.model) args.push("--model", req.model);
  if (req.session) args.push(req.session.resume ? "--resume" : "--session-id", req.session.id);
  return args;
}

type Block = { type?: string; name?: string; id?: string; input?: { query?: string; url?: string }; tool_use_id?: string; content?: unknown };
type Line = {
  type?: string;
  subtype?: string;
  session_id?: string;
  event?: { type?: string; delta?: { type?: string; text?: string; thinking?: string } };
  message?: { content?: Block[] };
  is_error?: boolean;
  result?: string;
  errors?: string[];
  rate_limit_info?: { status?: string; resetsAt?: number };
};

/** „Links: [{title, url}, …]” z wyniku narzędzia WebSearch. */
export function searchLinks(content: unknown): { url: string; title: string }[] {
  const text = typeof content === "string" ? content : Array.isArray(content) ? content.map((c: { text?: string }) => c?.text ?? "").join("\n") : "";
  const out: { url: string; title: string }[] = [];
  for (const m of text.matchAll(/Links: (\[.*?\])\s*(?:\n|$)/g)) {
    try {
      for (const l of JSON.parse(m[1]) as { url?: unknown; title?: unknown }[])
        if (typeof l.url === "string") out.push({ url: l.url, title: typeof l.title === "string" ? l.title : "" });
    } catch {
      // ucięty JSON: bez tych linków
    }
  }
  return out;
}

export class ClaudeParser implements LineParser {
  private error: string | null = null;

  line(obj: unknown): ChatEvent[] {
    const d = obj as Line;
    const out: ChatEvent[] = [];
    switch (d.type) {
      case "system":
        if (d.subtype === "init" && d.session_id) out.push({ type: "session", id: d.session_id });
        break;
      case "stream_event": {
        const delta = d.event?.type === "content_block_delta" ? d.event.delta : undefined;
        if (delta?.type === "text_delta" && delta.text) out.push({ type: "text", text: delta.text });
        else if (delta?.type === "thinking_delta" && delta.thinking) out.push({ type: "thinking", text: delta.thinking });
        break;
      }
      case "assistant":
        for (const b of d.message?.content ?? []) {
          if (b.type !== "tool_use") continue;
          if (b.name === "WebSearch" && b.input?.query) out.push({ type: "search", query: b.input.query });
          else if (b.name === "WebFetch" && b.input?.url) out.push({ type: "search", query: b.input.url });
        }
        break;
      case "user":
        for (const b of d.message?.content ?? [])
          if (b.type === "tool_result") for (const l of searchLinks(b.content)) out.push({ type: "found", ...l });
        break;
      case "rate_limit_event":
        if (d.rate_limit_info?.status === "rejected") {
          const at = d.rate_limit_info.resetsAt;
          const when = at ? ` (odnowienie ${new Date(at * 1000).toLocaleTimeString("pl-PL", { hour: "2-digit", minute: "2-digit" })})` : "";
          this.error = `limit subskrypcji Claude wyczerpany${when}`;
        }
        break;
      case "result":
        if (d.is_error) this.error ??= d.errors?.[0] ?? d.result ?? `błąd claude (${d.subtype ?? "?"})`;
        break;
    }
    return out;
  }

  failure(): string | null {
    return this.error;
  }
}

export async function streamClaude(req: ChatRequest, cwd: string, signal: AbortSignal, emit: (e: ChatEvent) => void): Promise<void> {
  const program = req.provider.command || "claude";
  cwd = req.folder ?? cwd;
  if (!req.mcp) return runCli(program, claudeArgs(req), req.prompt, cwd, new ClaudeParser(), signal, emit);
  // Konfiguracja z tokenem sesji: prywatny katalog, plik 0600, usuwany po odpowiedzi.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "agents-mcp-"));
  const file = path.join(dir, "mcp.json");
  try {
    fs.writeFileSync(file, JSON.stringify({ mcpServers: { bot: { type: "stdio", ...req.mcp } } }), { mode: 0o600 });
    const env = { MCP_TOOL_TIMEOUT: String(MCP_TOOL_TIMEOUT_MS) };
    await runCli(program, claudeArgs(req, file), req.prompt, cwd, new ClaudeParser(), signal, emit, env);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}
