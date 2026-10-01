//! Dostawca zgodny z OpenAI (`/chat/completions` ze strumieniem): llama-server, FreeToken,
//! OpenRouter, OpenAI. Sam `fetch`, bez SDK.

import type { ChatEvent, ChatRequest } from "../../../src/chat";
import { httpError, networkError } from "./http";
import { sseEvents } from "./sse";

type Delta = { content?: string | null; reasoning_content?: string | null; reasoning?: string | null };
type Chunk = { choices?: { delta?: Delta }[]; error?: { message?: string } | string };

export function openaiBody(req: ChatRequest): Record<string, unknown> {
  return {
    model: req.model,
    stream: true,
    messages: [{ role: "system", content: req.system }, ...req.messages],
  };
}

/** Zdarzenia z jednego `data:` strumienia; `[DONE]` i puste delty = nic. */
export function openaiEvents(data: string): ChatEvent[] {
  if (data === "[DONE]") return [];
  const chunk = JSON.parse(data) as Chunk;
  if (chunk.error) {
    const message = typeof chunk.error === "string" ? chunk.error : (chunk.error.message ?? "błąd modelu");
    return [{ type: "error", message }];
  }
  const d = chunk.choices?.[0]?.delta;
  if (!d) return [];
  const out: ChatEvent[] = [];
  const thinking = d.reasoning_content ?? d.reasoning;
  if (thinking) out.push({ type: "thinking", text: thinking });
  if (d.content) out.push({ type: "text", text: d.content });
  return out;
}

const headers = (key: string | null): Record<string, string> => ({
  "content-type": "application/json",
  ...(key ? { authorization: `Bearer ${key}` } : {}),
});

/** Strumień odpowiedzi. Odrzuca przy błędzie (komunikat po polsku); Stop = `AbortError`. */
export async function streamOpenAI(
  req: ChatRequest,
  key: string | null,
  signal: AbortSignal,
  emit: (e: ChatEvent) => void,
): Promise<void> {
  const url = `${req.provider.baseUrl}/chat/completions`;
  let res: Response;
  try {
    res = await fetch(url, { method: "POST", headers: headers(key), body: JSON.stringify(openaiBody(req)), signal });
  } catch (e) {
    if (signal.aborted) throw e;
    throw networkError(e, url);
  }
  if (!res.ok || !res.body) throw await httpError(res);
  for await (const ev of sseEvents(res.body)) {
    let events: ChatEvent[];
    try {
      events = openaiEvents(ev.data);
    } catch {
      continue; // linia, która nie jest JSON-em (niektóre serwery wysyłają statusy)
    }
    for (const e of events) {
      if (e.type === "error") throw new Error(e.message);
      emit(e);
    }
  }
}

/** Id modeli z `GET {baseUrl}/models`. */
export async function openaiModels(baseUrl: string, key: string | null, timeoutMs = 3000): Promise<string[]> {
  const url = `${baseUrl}/models`;
  let res: Response;
  try {
    res = await fetch(url, { headers: headers(key), signal: AbortSignal.timeout(timeoutMs) });
  } catch (e) {
    throw networkError(e, url);
  }
  if (!res.ok) throw await httpError(res);
  const j = (await res.json()) as { data?: { id?: unknown }[] };
  return (j.data ?? []).map((m) => m.id).filter((id): id is string => typeof id === "string");
}
