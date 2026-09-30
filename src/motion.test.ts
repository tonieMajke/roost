import { describe, expect, it } from "vitest";
import { ENTER_STAGGER_MS, ENTER_WINDOW_MS, enterClass, enterDelayMs, flipTransform, maxOrigin, motionAllowed, mountOrder } from "./motion";

describe("mountOrder", () => {
  it("zamiana nie zmienia kolejności w DOM", () => {
    const prev = ["a", "b", "c"];
    expect(mountOrder(prev, ["c", "b", "a"])).toBe(prev);
  });

  it("nowe na końcu, zamknięte wypadają", () => {
    expect(mountOrder(["a", "b", "c"], ["c", "x", "a"])).toEqual(["a", "c", "x"]);
    expect(mountOrder([], ["a", "b"])).toEqual(["a", "b"]);
  });
});

describe("flipTransform", () => {
  it("przesunięcie i skala z nowego pudełka do starego", () => {
    expect(flipTransform({ x: 0, y: 0, w: 200, h: 100 }, { x: 100, y: 50, w: 100, h: 100 })).toBe(
      "translate(-100px, -50px) scale(2, 1)",
    );
  });

  it("bez widocznej różnicy = null", () => {
    expect(flipTransform({ x: 10, y: 10, w: 300, h: 200 }, { x: 10.4, y: 9.6, w: 301, h: 200 })).toBeNull();
  });

  it("ukryta komórka (0 px) = null", () => {
    expect(flipTransform({ x: 0, y: 0, w: 0, h: 0 }, { x: 5, y: 5, w: 100, h: 100 })).toBeNull();
    expect(flipTransform({ x: 5, y: 5, w: 100, h: 100 }, { x: 0, y: 0, w: 0, h: 0 })).toBeNull();
  });
});

describe("maxOrigin", () => {
  it("środek komórki w siatce 2×2", () => {
    expect(maxOrigin(0, 4)).toBe("25% 25%");
    expect(maxOrigin(3, 4)).toBe("75% 75%");
  });

  it("siatka 3×2 (5 paneli), ostatni wiersz", () => {
    expect(maxOrigin(4, 5)).toBe("50% 75%");
  });

  it("jeden panel i indeks poza siatką = środek", () => {
    expect(maxOrigin(0, 1)).toBe("50% 50%");
    expect(maxOrigin(7, 3)).toBe("50% 50%");
  });
});

describe("enterClass", () => {
  const order = ["a", "b", "c"];

  it("dalej na szynie = z dołu, wcześniej = z góry", () => {
    expect(enterClass(order, "a", "c")).toBe("enter-next");
    expect(enterClass(order, "c", "b")).toBe("enter-prev");
  });

  it("bez zmiany albo bez projektu = brak wjazdu", () => {
    expect(enterClass(order, "a", "a")).toBeNull();
    expect(enterClass(order, null, "a")).toBeNull();
    expect(enterClass(order, "a", null)).toBeNull();
    expect(enterClass(order, "a", "x")).toBeNull();
  });

  it("poprzedni projekt usunięty = jak następny", () => {
    expect(enterClass(order, "gone", "a")).toBe("enter-next");
  });
});

describe("enterDelayMs", () => {
  it("kolejno po przełączeniu", () => {
    expect(enterDelayMs(0, 0)).toBe(0);
    expect(enterDelayMs(3, 10)).toBe(3 * ENTER_STAGGER_MS);
  });

  it("po oknie wjazdu i bez przełączenia = 0", () => {
    expect(enterDelayMs(3, ENTER_WINDOW_MS)).toBe(0);
    expect(enterDelayMs(3, null)).toBe(0);
  });
});

describe("motionAllowed", () => {
  it("tylko pełny ruch bez prefers-reduced-motion", () => {
    expect(motionAllowed("full", false)).toBe(true);
    expect(motionAllowed("lite", false)).toBe(false);
    expect(motionAllowed("full", true)).toBe(false);
  });
});
