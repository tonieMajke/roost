//! Klient gniazda narzędzi (strona serwera MCP): żądania z `id`, odpowiedzi w dowolnej kolejności.
//! Bez importów z Electrona – wchodzi do `mcp-server.cjs`.

import type { Socket } from "node:net";

export type BridgeRequest = { op: "list" } | { op: "call"; name: string; args: Record<string, unknown> };
export type BridgeReply = { id: number; result?: unknown; error?: string };

/** Linie JSON z gniazda (kawałki mogą przeciąć linię). */
export function onLines(sock: Socket, fn: (line: string) => void): void {
  let buf = "";
  sock.setEncoding("utf8");
  sock.on("data", (d: string) => {
    buf += d;
    let nl: number;
    while ((nl = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, nl);
      buf = buf.slice(nl + 1);
      if (line.trim()) fn(line);
    }
  });
}

export class BridgeClient {
  private next = 1;
  private pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
  private closed: string | null = null;
  private closeFns: (() => void)[] = [];

  constructor(
    private sock: Socket,
    private token: string,
  ) {
    onLines(sock, (line) => {
      let r: BridgeReply;
      try {
        r = JSON.parse(line) as BridgeReply;
      } catch {
        return;
      }
      const p = this.pending.get(r.id);
      if (!p) return;
      this.pending.delete(r.id);
      if (r.error !== undefined) p.reject(new Error(r.error));
      else p.resolve(r.result);
    });
    const close = (why: string) => {
      if (this.closed) return;
      this.closed = why;
      for (const p of this.pending.values()) p.reject(new Error(why));
      this.pending.clear();
      for (const fn of this.closeFns) fn();
    };
    sock.on("error", (e) => close(`brak połączenia z aplikacją: ${e.message}`));
    sock.on("close", () => close("aplikacja zamknęła połączenie"));
  }

  request(req: BridgeRequest): Promise<unknown> {
    if (this.closed) return Promise.reject(new Error(this.closed));
    const id = this.next++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.sock.write(`${JSON.stringify({ ...req, id, token: this.token })}\n`);
    });
  }

  onClose(fn: () => void): void {
    this.closeFns.push(fn);
  }
}
