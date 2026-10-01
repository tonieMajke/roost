//! Prośby bota o zgodę: narzędzie czeka, aż użytkownik kliknie w UI „Zezwól raz”,
//! „Zezwalaj w tej rozmowie” albo „Odrzuć”. Stop rozmowy (abort) = odmowa.

import { randomUUID } from "node:crypto";
import type { ApprovalDecision, ToolName } from "../../../src/bot";

export type ApprovalRequest = {
  id: string;
  bot: string;
  chat: string;
  tool: ToolName;
  /** Jedna linia do karty zgody: „Uruchomić `cargo test`?”. */
  title: string;
  /** Szczegóły pod spodem: polecenie, treść pliku, zmiana old→new, definicja bota. */
  detail?: string;
  /** Czy „Zezwalaj w tej rozmowie” ma sens (bash bez prostego prefiksu: nie). */
  canGrant: boolean;
  at: number;
};

type Pending = { req: ApprovalRequest; resolve: (d: ApprovalDecision) => void; cleanup: () => void };

export class ApprovalBroker {
  private pending = new Map<string, Pending>();

  constructor(
    /** Nowa prośba (do UI) i zakończona (decyzja, odmowa przez Stop): UI zdejmuje kartę. */
    private onChange: (e: { type: "request"; req: ApprovalRequest } | { type: "resolved"; id: string; decision: ApprovalDecision }) => void = () => {},
    private now: () => number = Date.now,
  ) {}

  request(r: Omit<ApprovalRequest, "id" | "at">, signal: AbortSignal): Promise<ApprovalDecision> {
    if (signal.aborted) return Promise.resolve("deny");
    const req: ApprovalRequest = { ...r, id: randomUUID(), at: this.now() };
    return new Promise((resolve) => {
      const onAbort = () => this.decide(req.id, "deny");
      signal.addEventListener("abort", onAbort, { once: true });
      this.pending.set(req.id, { req, resolve, cleanup: () => signal.removeEventListener("abort", onAbort) });
      this.onChange({ type: "request", req });
    });
  }

  /** Decyzja z UI; nieznane id (już rozstrzygnięte) = nic. */
  decide(id: string, decision: ApprovalDecision): boolean {
    const p = this.pending.get(id);
    if (!p) return false;
    if (decision !== "once" && decision !== "chat" && decision !== "deny") decision = "deny";
    if (decision === "chat" && !p.req.canGrant) decision = "once";
    this.pending.delete(id);
    p.cleanup();
    this.onChange({ type: "resolved", id, decision });
    p.resolve(decision);
    return true;
  }

  /** Czekające prośby (UI po przeładowaniu strony, kropka na liście botów). */
  list(): ApprovalRequest[] {
    return [...this.pending.values()].map((p) => p.req).sort((a, b) => a.at - b.at);
  }

  /** Zamknięcie aplikacji: wszystko odrzucone. */
  denyAll(): void {
    for (const id of [...this.pending.keys()]) this.decide(id, "deny");
  }
}
