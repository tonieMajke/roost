//! Narzędzia wykonywane w oknie (rozmowa głosowa) dla claude/codex CLI: CLI woła serwer MCP
//! (`bridge.ts`), proces główny wysyła prośbę zdarzeniem `tool_request` w strumieniu `chat_event`,
//! okno wykonuje narzędzie i odpowiada przez `chat_tool_result`.

import { randomUUID } from "node:crypto";
import type { ChatEvent } from "../../../src/chat";

export type WindowToolResult = { ok: boolean; text: string };

export class WindowTools {
  private pending = new Map<string, { owner: string; resolve: (r: WindowToolResult) => void }>();

  /** Prośba do okna; `owner` = żądanie czatu (żeby przy końcu odpowiedzi zamknąć to, co wisi). */
  call(owner: string, emit: (e: ChatEvent) => void, name: string, args: Record<string, unknown>): Promise<WindowToolResult> {
    const id = randomUUID();
    return new Promise((resolve) => {
      this.pending.set(id, { owner, resolve });
      emit({ type: "tool_request", id, name, args });
    });
  }

  /** Odpowiedź okna; nieznane id (już zamknięte) = nic. */
  resolve(id: string, ok: unknown, text: unknown): boolean {
    const p = this.pending.get(id);
    if (!p) return false;
    this.pending.delete(id);
    p.resolve({ ok: ok === true, text: typeof text === "string" ? text : "" });
    return true;
  }

  /** Koniec odpowiedzi (także Stop): wiszące prośby dostają błąd, CLI już ich nie czeka. */
  end(owner: string): void {
    for (const [id, p] of [...this.pending]) {
      if (p.owner !== owner) continue;
      this.pending.delete(id);
      p.resolve({ ok: false, text: "rozmowa się skończyła" });
    }
  }
}
