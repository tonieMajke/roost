import { describe, expect, it } from "vitest";
import { DEFAULT_DOCK_ORDER, moveSection, parseDockOrder, stepSection } from "./dockOrder";

describe("dockOrder", () => {
  it("domyślnie: limity, kontekst, panele, na żywo", () => {
    expect(DEFAULT_DOCK_ORDER).toEqual(["limits", "context", "board", "live"]);
  });

  it("parse: permutacja przechodzi, reszta wraca do domyślnej z błędem", () => {
    expect(parseDockOrder(["live", "board", "context", "limits"])).toEqual({ order: ["live", "board", "context", "limits"] });
    for (const bad of [["limits"], ["limits", "limits", "board", "live"], ["a", "b", "c", "d"], "x", null]) {
      const r = parseDockOrder(bad);
      expect(r.order).toEqual(DEFAULT_DOCK_ORDER);
      expect(r.error).toMatch(/ui\.dockOrder/);
    }
  });

  it("move: przed i za celem, w obie strony", () => {
    const o = DEFAULT_DOCK_ORDER;
    expect(moveSection(o, "live", "limits", "before")).toEqual(["live", "limits", "context", "board"]);
    expect(moveSection(o, "limits", "board", "after")).toEqual(["context", "board", "limits", "live"]);
    expect(moveSection(o, "context", "context", "after")).toEqual(o);
  });

  it("step: zamiana z sąsiadem, na krańcu bez zmian", () => {
    expect(stepSection(DEFAULT_DOCK_ORDER, "context", -1)).toEqual(["context", "limits", "board", "live"]);
    expect(stepSection(DEFAULT_DOCK_ORDER, "limits", -1)).toEqual(DEFAULT_DOCK_ORDER);
    expect(stepSection(DEFAULT_DOCK_ORDER, "live", 1)).toEqual(DEFAULT_DOCK_ORDER);
  });
});
