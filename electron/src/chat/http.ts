//! Wspólne dla dostawców HTTP: błędy po polsku z odpowiedzi i z `fetch`, wywołania narzędzi
//! składane z kawałków strumienia.

import { randomUUID } from "node:crypto";
import type { ToolCall } from "../../../src/chat";

/** Błąd z odpowiedzi HTTP: kod zostaje, żeby pętla bota rozpoznała odrzucone narzędzia. */
export type HttpError = Error & { status: number };

/** Komunikat z ciała błędu (`{error: {message}}`, `{error: "..."}`, `{message}`) albo sam kod. */
export async function httpError(res: Response): Promise<HttpError> {
  let detail = "";
  try {
    const text = await res.text();
    try {
      const j = JSON.parse(text) as { error?: { message?: string } | string; message?: string };
      detail = (typeof j.error === "string" ? j.error : j.error?.message) ?? j.message ?? "";
    } catch {
      detail = text.slice(0, 200);
    }
  } catch {
    // ciało niedostępne
  }
  const what =
    res.status === 401 || res.status === 403
      ? "zły albo brakujący klucz API"
      : res.status === 404
        ? "nie ma takiego adresu albo modelu"
        : res.status === 429
          ? "przekroczony limit zapytań"
          : `błąd serwera ${res.status}`;
  return Object.assign(new Error(detail.trim() ? `${what}: ${detail.trim()}` : what), { status: res.status });
}

/** Błąd sieci z `fetch` (Node: `TypeError: fetch failed` z przyczyną w `cause`). */
export function networkError(e: unknown, url: string): Error {
  // `localhost` próbuje IPv6 i IPv4: wtedy kody są w `cause.errors` (AggregateError).
  const c = (e as { cause?: { code?: string; errors?: { code?: string }[] } })?.cause;
  const cause = c?.code ?? c?.errors?.[0]?.code;
  const host = (() => {
    try {
      return new URL(url).host;
    } catch {
      return url;
    }
  })();
  if (cause === "ECONNREFUSED") return new Error(`serwer ${host} nie odpowiada (nie działa?)`);
  if (cause === "ENOTFOUND" || cause === "EAI_AGAIN") return new Error(`nie znaleziono ${host} (sieć?)`);
  if (cause === "ECONNRESET" || cause === "UND_ERR_SOCKET") return new Error(`serwer ${host} zerwał połączenie`);
  return new Error(`połączenie z ${host}: ${e instanceof Error ? e.message : String(e)}`);
}

export const isAbort = (e: unknown) => (e as { name?: string })?.name === "AbortError";

/** Wywołania narzędzi z kawałków strumienia: OpenAI numeruje je `index`, Anthropic numerem bloku.
 *  Id i nazwa przychodzą raz, argumenty jako kolejne fragmenty tekstu JSON. */
export class CallParts {
  private parts = new Map<number, { id: string; name: string; json: string }>();

  add(index: number, part: { id?: string; name?: string; json?: string }): void {
    const p = this.parts.get(index) ?? { id: "", name: "", json: "" };
    if (part.id) p.id = part.id;
    if (part.name) p.name += part.name;
    if (part.json) p.json += part.json;
    this.parts.set(index, p);
  }

  calls(): ToolCall[] {
    return [...this.parts.entries()]
      .sort(([a], [b]) => a - b)
      .filter(([, p]) => p.name)
      .map(([, p]) => {
        // Niektóre serwery lokalne nie podają id; musi być unikalne w całej rozmowie.
        const id = p.id || `call_${randomUUID().slice(0, 8)}`;
        const raw = p.json.trim();
        if (raw === "") return { id, name: p.name, args: {} };
        try {
          const args = JSON.parse(raw) as unknown;
          if (args && typeof args === "object" && !Array.isArray(args)) return { id, name: p.name, args: args as Record<string, unknown> };
        } catch {
          // niżej
        }
        return { id, name: p.name, args: {}, bad: raw };
      });
  }
}
