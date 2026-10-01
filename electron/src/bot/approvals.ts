//! Prośby bota o zgodę: narzędzie czeka, aż użytkownik kliknie w UI „Zezwól raz”,
//! „Zezwalaj w tej rozmowie” albo „Odrzuć”. Stop rozmowy (abort) = odmowa.

import { randomUUID } from "node:crypto";
import type { ApprovalDecision, ApprovalRequest } from "../../../src/bot";

export type { ApprovalRequest };
/** Zmiana listy czekających próśb (do strony: `bot_approval`). */
export type ApprovalChange = { type: "request"; req: ApprovalRequest } | { type: "resolved"; id: string; decision: ApprovalDecision };

type Pending = { req: ApprovalRequest; resolve: (d: ApprovalDecision) => void; cleanup: () => void };

export class ApprovalBroker {
  private pending = new Map<string, Pending>();

  constructor(
    /** Nowa prośba (do UI) i zakończona (decyzja, odmowa przez Stop): UI zdejmuje kartę. */
    private onChange: (e: ApprovalChange) => void = () => {},
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

  /** Zamknięcie aplikacji: wszystko odrzucone. `keep`: prośby, które czekają dalej
   *  (przebiegi harmonogramu przy przeładowaniu strony – nowa strona pobierze je przez `list`). */
  denyAll(keep: (req: ApprovalRequest) => boolean = () => false): void {
    for (const [id, p] of [...this.pending]) if (!keep(p.req)) this.decide(id, "deny");
  }
}
