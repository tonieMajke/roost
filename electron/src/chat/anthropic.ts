//! Claude przez API (klucz z console.anthropic.com): Messages API ze strumieniem, sam `fetch`.
//! Z `req.tools` także narzędzia (`tool_use` / `tool_result`, pętla bota).

import type { ChatEvent, ChatRequest, ToolCall, Turn } from "../../../src/chat";
import { CallParts, httpError, networkError } from "./http";
import { sseEvents } from "./sse";

const VERSION = "2023-06-01";
const MAX_TOKENS = 16_000;

const headers = (key: string | null): Record<string, string> => ({
  "content-type": "application/json",
  "anthropic-version": VERSION,
  ...(key ? { "x-api-key": key } : {}),
});

type Block = Record<string, unknown>;

/** Rozmowa w formacie Messages API: wywołania jako bloki `tool_use`, wyniki jako `tool_result`
 *  w wiadomości użytkownika. Sąsiednie wiadomości tej samej roli są łączone (API wymaga przemienności). */
export function anthropicMessages(turns: Turn[]): { role: "user" | "assistant"; content: Block[] }[] {
  const out: { role: "user" | "assistant"; content: Block[] }[] = [];
  for (const t of turns) {
    const role = t.role === "assistant" ? "assistant" : "user";
    const blocks: Block[] = [];
    if (t.role === "tool") blocks.push({ type: "tool_result", tool_use_id: t.id, content: t.content, ...(t.error ? { is_error: true } : {}) });
    else {
      if (t.content.trim()) blocks.push({ type: "text", text: t.content });
      if (t.role === "assistant") for (const c of t.calls ?? []) blocks.push({ type: "tool_use", id: c.id, name: c.name, input: c.args });
    }
    if (blocks.length === 0) continue;
    const last = out[out.length - 1];
    // Kolejność tur i tak stawia wyniki narzędzi przed tekstem użytkownika, jak wymaga API.
    if (last?.role === role) last.content.push(...blocks);
    else out.push({ role, content: blocks });
  }
  return out;
}

export function anthropicBody(req: ChatRequest): Record<string, unknown> {
  return {
    model: req.model,
    max_tokens: MAX_TOKENS,
    stream: true,
    system: req.system,
    messages: req.turns ? anthropicMessages(req.turns) : req.messages,
    ...(req.tools?.length ? { tools: req.tools.map((t) => ({ name: t.name, description: t.description, input_schema: t.parameters })) } : {}),
  };
}

type Event = {
  type?: string;
  index?: number;
  content_block?: { type?: string; id?: string; name?: string };
  delta?: { type?: string; text?: string; thinking?: string; partial_json?: string };
  error?: { message?: string };
};

/** Zdarzenia z jednego `data:`; bloki `tool_use` składane w `calls`. */
export function anthropicEvents(data: string, calls?: CallParts): ChatEvent[] {
  const e = JSON.parse(data) as Event;
  if (e.type === "error") return [{ type: "error", message: e.error?.message ?? "błąd API" }];
  if (e.type === "content_block_start" && e.content_block?.type === "tool_use")
    calls?.add(e.index ?? 0, { id: e.content_block.id, name: e.content_block.name });
  if (e.type !== "content_block_delta") return [];
  if (e.delta?.type === "input_json_delta") {
    calls?.add(e.index ?? 0, { json: e.delta.partial_json });
    return [];
  }
  if (e.delta?.type === "text_delta" && e.delta.text) return [{ type: "text", text: e.delta.text }];
  if (e.delta?.type === "thinking_delta" && e.delta.thinking) return [{ type: "thinking", text: e.delta.thinking }];
  return [];
}

export async function streamAnthropic(
  req: ChatRequest,
  key: string | null,
  signal: AbortSignal,
  emit: (e: ChatEvent) => void,
): Promise<ToolCall[]> {
  if (!key) throw new Error("brak klucza API – dodaj go w oknie „Dostawcy”");
  const url = `${req.provider.baseUrl}/messages`;
  let res: Response;
  try {
    res = await fetch(url, { method: "POST", headers: headers(key), body: JSON.stringify(anthropicBody(req)), signal });
  } catch (e) {
    if (signal.aborted) throw e;
    throw networkError(e, url);
  }
  if (!res.ok || !res.body) throw await httpError(res);
  const calls = new CallParts();
  for await (const ev of sseEvents(res.body)) {
    let events: ChatEvent[];
    try {
      events = anthropicEvents(ev.data, calls);
    } catch {
      continue;
    }
    for (const e of events) {
      if (e.type === "error") throw new Error(e.message);
      emit(e);
    }
  }
  return calls.calls();
}

export async function anthropicModels(baseUrl: string, key: string | null): Promise<string[]> {
  if (!key) throw new Error("brak klucza API");
  const url = `${baseUrl}/models?limit=100`;
  let res: Response;
  try {
    res = await fetch(url, { headers: headers(key), signal: AbortSignal.timeout(5000) });
  } catch (e) {
    throw networkError(e, url);
  }
  if (!res.ok) throw await httpError(res);
  const j = (await res.json()) as { data?: { id?: unknown }[] };
  return (j.data ?? []).map((m) => m.id).filter((id): id is string => typeof id === "string");
}
