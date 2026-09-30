import { describe, expect, it } from "vitest";
import { dropTarget, follow, pastThreshold, shrinkTo, stretch } from "./drag";
import type { Box } from "./motion";

describe("pastThreshold", () => {
  it("dopiero ruch powyżej 6 px zaczyna przeciąganie", () => {
    expect(pastThreshold({ x: 0, y: 0 }, { x: 3, y: 4 })).toBe(false); // 5 px
    expect(pastThreshold({ x: 0, y: 0 }, { x: 6, y: 1 })).toBe(true);
  });
});

describe("dropTarget", () => {
  const boxes = new Map<string, Box>([
    ["a", { x: 0, y: 0, w: 100, h: 100 }],
    ["b", { x: 110, y: 0, w: 100, h: 100 }],
  ]);
  it("panel pod punktem, ale nie własny", () => {
    expect(dropTarget(boxes, { x: 150, y: 50 }, "a")).toBe("b");
    expect(dropTarget(boxes, { x: 50, y: 50 }, "a")).toBeNull();
  });
  it("przerwa między panelami i krawędź po prawej to brak celu", () => {
    expect(dropTarget(boxes, { x: 105, y: 50 }, "a")).toBeNull();
    expect(dropTarget(boxes, { x: 210, y: 50 }, "a")).toBeNull();
  });
});

describe("follow", () => {
  it("jedna klatka 60 Hz nadrabia 25%", () => {
    expect(follow({ x: 0, y: 0 }, { x: 100, y: 0 }, 1000 / 60).x).toBeCloseTo(25);
  });
  it("dwie klatki 120 Hz = jedna klatka 60 Hz", () => {
    const half = 1000 / 120;
    const twice = follow(follow({ x: 0, y: 0 }, { x: 100, y: 0 }, half), { x: 100, y: 0 }, half);
    expect(twice.x).toBeCloseTo(25);
  });
  it("dt 0 nie rusza kulki", () => {
    expect(follow({ x: 5, y: 5 }, { x: 100, y: 0 }, 0)).toEqual({ x: 5, y: 5 });
  });
});

describe("stretch", () => {
  it("bez ruchu okrągła, szybko maks. 1,15 wzdłuż ruchu", () => {
    expect(stretch({ x: 0, y: 0 })).toEqual({ angle: 0, scale: 1 });
    expect(stretch({ x: 0, y: 10 })).toEqual({ angle: 90, scale: 1.15 });
  });
});

describe("shrinkTo", () => {
  it("pudełko 480×240 do kulki 48 px o środku w punkcie", () => {
    expect(shrinkTo({ x: 100, y: 50, w: 480, h: 240 }, { x: 300, y: 200 })).toBe("translate(176px, 126px) scale(0.1, 0.2)");
  });
});
