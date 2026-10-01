//! Claude przez API (klucz z console.anthropic.com): Messages API ze strumieniem, sam `fetch`.

import type { ChatEvent, ChatRequest } from "../../../src/chat";
import { httpError, networkError } from "./http";
import { sseEvents } from "./sse";

const VERSION = "2023-06-01";
const MAX_TOKENS = 16_000;

const headers = (key: string | null): Record<string, string> => ({
  "content-type": "application/json",
  "anthropic-version": VERSION,
  ...(key ? { "x-api-key": key } : {}),
});

export function anthropicBody(req: ChatRequest): Record<string, unknown> {
  return { model: req.model, max_tokens: MAX_TOKENS, stream: true, system: req.system, messages: req.messages };
}

type Event = {
  type?: string;
  delta?: { type?: string; text?: string; thinking?: string };
  error?: { message?: string };
};

export function anthropicEvents(data: string): ChatEvent[] {
  const e = JSON.parse(data) as Event;
  if (e.type === "error") return [{ type: "error", message: e.error?.message ?? "błąd API" }];
  if (e.type !== "content_block_delta") return [];
  if (e.delta?.type === "text_delta" && e.delta.text) return [{ type: "text", text: e.delta.text }];
  if (e.delta?.type === "thinking_delta" && e.delta.thinking) return [{ type: "thinking", text: e.delta.thinking }];
  return [];
}

export async function streamAnthropic(
  req: ChatRequest,
  key: string | null,
  signal: AbortSignal,
  emit: (e: ChatEvent) => void,
): Promise<void> {
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
  for await (const ev of sseEvents(res.body)) {
    let events: ChatEvent[];
    try {
      events = anthropicEvents(ev.data);
    } catch {
      continue;
    }
    for (const e of events) {
      if (e.type === "error") throw new Error(e.message);
      emit(e);
    }
  }
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
