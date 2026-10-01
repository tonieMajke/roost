import { describe, expect, it } from "vitest";
import type { ChatEvent } from "../../../src/chat";
import { WindowTools } from "./window-tools";

describe("WindowTools", () => {
  it("prośba idzie zdarzeniem, odpowiedź okna ją kończy; koniec rozmowy zamyka wiszące", async () => {
    const w = new WindowTools();
    const sent: ChatEvent[] = [];
    const a = w.call("r1", (e) => sent.push(e), "overview", {});
    const b = w.call("r2", (e) => sent.push(e), "read_pane", { id: "x" });
    expect(sent.map((e) => e.type)).toEqual(["tool_request", "tool_request"]);
    const id = (sent[0] as { id: string }).id;
    expect(w.resolve(id, true, "ok")).toBe(true);
    expect(w.resolve(id, true, "znowu")).toBe(false);
    expect(await a).toEqual({ ok: true, text: "ok" });
    w.end("r2");
    expect(await b).toEqual({ ok: false, text: "rozmowa się skończyła" });
  });
});
