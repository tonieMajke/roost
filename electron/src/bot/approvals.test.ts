import { describe, expect, it } from "vitest";
import { ApprovalBroker, type ApprovalRequest } from "./approvals";

const base = { bot: "b", chat: "c", tool: "bash" as const, title: "Uruchomić?", canGrant: true };

describe("ApprovalBroker", () => {
  it("prośba czeka na decyzję, UI dostaje zdarzenia", async () => {
    const events: string[] = [];
    let req: ApprovalRequest | null = null;
    const b = new ApprovalBroker((e) => {
      events.push(e.type);
      if (e.type === "request") req = e.req;
    });
    const p = b.request(base, new AbortController().signal);
    expect(b.list()).toHaveLength(1);
    expect(b.decide(req!.id, "once")).toBe(true);
    await expect(p).resolves.toBe("once");
    expect(b.list()).toEqual([]);
    expect(b.decide(req!.id, "deny")).toBe(false);
    expect(events).toEqual(["request", "resolved"]);
  });

  it("Stop = odmowa; już przerwany sygnał = od razu odmowa", async () => {
    const b = new ApprovalBroker();
    const ctl = new AbortController();
    const p = b.request(base, ctl.signal);
    ctl.abort();
    await expect(p).resolves.toBe("deny");
    expect(b.list()).toEqual([]);
    await expect(b.request(base, ctl.signal)).resolves.toBe("deny");
  });

  it("„w tej rozmowie” bez możliwości zgody = raz; śmieciowa decyzja = odmowa", async () => {
    const b = new ApprovalBroker();
    const p1 = b.request({ ...base, canGrant: false }, new AbortController().signal);
    b.decide(b.list()[0].id, "chat");
    await expect(p1).resolves.toBe("once");
    const p2 = b.request(base, new AbortController().signal);
    b.decide(b.list()[0].id, "tak" as "once");
    await expect(p2).resolves.toBe("deny");
  });

  it("denyAll przy zamknięciu", async () => {
    const b = new ApprovalBroker();
    const ps = [b.request(base, new AbortController().signal), b.request(base, new AbortController().signal)];
    b.denyAll();
    await expect(Promise.all(ps)).resolves.toEqual(["deny", "deny"]);
  });
});
