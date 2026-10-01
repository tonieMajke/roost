//! Dostawca zgodny z OpenAI (`/chat/completions` ze strumieniem): llama-server, FreeToken,
//! OpenRouter, OpenAI. Sam `fetch`, bez SDK. Z `req.tools` także function calling (pętla bota).

import { t } from "../i18n";
import type { ChatEvent, ChatRequest, ToolCall, Turn } from "../../../src/chat";
import { CallParts, httpError, networkError } from "./http";
import { sseEvents } from "./sse";

type CallDelta = { index?: number; id?: string; function?: { name?: string; arguments?: string } };
type Delta = { content?: string | null; reasoning_content?: string | null; reasoning?: string | null; tool_calls?: CallDelta[] };
type Chunk = { choices?: { delta?: Delta }[]; error?: { message?: string } | string };

/** Rozmowa z wywołaniami w formacie OpenAI: `tool_calls` przy odpowiedzi, wynik jako `role: tool`. */
export function openaiMessages(turns: Turn[]): Record<string, unknown>[] {
  return turns.map((t) => {
    if (t.role === "tool") return { role: "tool", tool_call_id: t.id, content: t.content };
    if (t.role === "assistant" && t.calls?.length)
      return {
        role: "assistant",
        content: t.content || null,
        tool_calls: t.calls.map((c) => ({
          id: c.id,
          type: "function",
          function: { name: c.name, arguments: c.bad ?? JSON.stringify(c.args) },
        })),
      };
    return { role: t.role, content: t.content };
  });
}

export function openaiBody(req: ChatRequest): Record<string, unknown> {
  const history = req.turns ? openaiMessages(req.turns) : req.messages;
  return {
    model: req.model,
    stream: true,
    messages: [{ role: "system", content: req.system }, ...history],
    ...(req.tools?.length
      ? { tools: req.tools.map((t) => ({ type: "function", function: { name: t.name, description: t.description, parameters: t.parameters } })) }
      : {}),
  };
}

/** Zdarzenia z jednego `data:` strumienia; `[DONE]` i puste delty = nic.
 *  Kawałki wywołań narzędzi trafiają do `calls` (nie są zdarzeniami, dopóki nie są całe). */
export function openaiEvents(data: string, calls?: CallParts): ChatEvent[] {
  if (data === "[DONE]") return [];
  const chunk = JSON.parse(data) as Chunk;
  if (chunk.error) {
    const message = typeof chunk.error === "string" ? chunk.error : (chunk.error.message ?? t("chat.modelError"));
    return [{ type: "error", message }];
  }
  const d = chunk.choices?.[0]?.delta;
  if (!d) return [];
  const out: ChatEvent[] = [];
  const thinking = d.reasoning_content ?? d.reasoning;
  if (thinking) out.push({ type: "thinking", text: thinking });
  if (d.content) out.push({ type: "text", text: d.content });
  if (calls && Array.isArray(d.tool_calls))
    d.tool_calls.forEach((c, i) => calls.add(c.index ?? i, { id: c.id, name: c.function?.name, json: c.function?.arguments }));
  return out;
}

const headers = (key: string | null): Record<string, string> => ({
  "content-type": "application/json",
  ...(key ? { authorization: `Bearer ${key}` } : {}),
});

/** Strumień odpowiedzi; zwraca wywołania narzędzi (puste bez `req.tools`).
 *  Odrzuca przy błędzie (komunikat po polsku); Stop = `AbortError`. */
export async function streamOpenAI(
  req: ChatRequest,
  key: string | null,
  signal: AbortSignal,
  emit: (e: ChatEvent) => void,
): Promise<ToolCall[]> {
  const url = `${req.provider.baseUrl}/chat/completions`;
  let res: Response;
  try {
    res = await fetch(url, { method: "POST", headers: headers(key), body: JSON.stringify(openaiBody(req)), signal });
  } catch (e) {
    if (signal.aborted) throw e;
    throw networkError(e, url);
  }
  if (!res.ok || !res.body) throw await httpError(res);
  const calls = new CallParts();
  for await (const ev of sseEvents(res.body)) {
    let events: ChatEvent[];
    try {
      events = openaiEvents(ev.data, calls);
    } catch {
      continue; // linia, która nie jest JSON-em (niektóre serwery wysyłają statusy)
    }
    for (const e of events) {
      if (e.type === "error") throw new Error(e.message);
      emit(e);
    }
  }
  return calls.calls();
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
