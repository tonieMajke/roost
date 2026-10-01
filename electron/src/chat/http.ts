//! Wspólne dla dostawców HTTP: błędy po polsku z odpowiedzi i z `fetch`.

/** Komunikat z ciała błędu (`{error: {message}}`, `{error: "..."}`, `{message}`) albo sam kod. */
export async function httpError(res: Response): Promise<Error> {
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
  return new Error(detail.trim() ? `${what}: ${detail.trim()}` : what);
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
