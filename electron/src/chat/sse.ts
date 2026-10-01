//! Parser Server-Sent Events: kawałki bajtów → zdarzenia `{ event, data }`.
//! Kawałki mogą przeciąć linię albo znak UTF-8 w środku – bufor czeka na resztę.

export type SseEvent = { event: string; data: string };

export class SseParser {
  private decoder = new TextDecoder();
  private buf = "";
  private event = "";
  private data: string[] = [];

  /** Zdarzenia zakończone pustą linią w tym kawałku. */
  push(chunk: Uint8Array): SseEvent[] {
    this.buf += this.decoder.decode(chunk, { stream: true });
    const out: SseEvent[] = [];
    let nl: number;
    while ((nl = this.buf.search(/\r\n|\n|\r/)) >= 0) {
      const line = this.buf.slice(0, nl);
      this.buf = this.buf.slice(nl + (this.buf.startsWith("\r\n", nl) ? 2 : 1));
      const ev = this.line(line);
      if (ev) out.push(ev);
    }
    return out;
  }

  /** Koniec strumienia: ostatnie zdarzenie bez pustej linii też się liczy. */
  end(): SseEvent[] {
    const out: SseEvent[] = [];
    if (this.buf !== "") {
      const ev = this.line(this.buf);
      this.buf = "";
      if (ev) out.push(ev);
    }
    const ev = this.line("");
    if (ev) out.push(ev);
    return out;
  }

  private line(line: string): SseEvent | null {
    if (line === "") {
      if (this.data.length === 0) return (this.event = ""), null;
      const ev = { event: this.event || "message", data: this.data.join("\n") };
      this.event = "";
      this.data = [];
      return ev;
    }
    if (line.startsWith(":")) return null; // komentarz (keep-alive)
    const colon = line.indexOf(":");
    const field = colon < 0 ? line : line.slice(0, colon);
    let value = colon < 0 ? "" : line.slice(colon + 1);
    if (value.startsWith(" ")) value = value.slice(1);
    if (field === "data") this.data.push(value);
    else if (field === "event") this.event = value;
    return null;
  }
}

/** Czyta ciało odpowiedzi `fetch` jako SSE. */
export async function* sseEvents(body: ReadableStream<Uint8Array>): AsyncGenerator<SseEvent> {
  const parser = new SseParser();
  const reader = body.getReader();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      yield* parser.push(value);
    }
    yield* parser.end();
  } finally {
    reader.releaseLock();
  }
}
