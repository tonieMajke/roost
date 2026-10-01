import { describe, expect, it } from "vitest";
import { angleFor, blips, callsigns, radiusFor, RADAR_R } from "./radar";

describe("radiusFor", () => {
  it("trafia w pierścienie: 1, 5 i 15 minut", () => {
    expect(radiusFor(0)).toBe(0);
    expect(radiusFor(60_000)).toBe(70);
    expect(radiusFor(300_000)).toBe(140);
    expect(radiusFor(900_000)).toBe(210);
  });
  it("rośnie z ciszą i nie wychodzi poza tarczę", () => {
    expect(radiusFor(30_000)).toBeGreaterThan(0);
    expect(radiusFor(30_000)).toBeLessThan(70);
    expect(radiusFor(99_999_999)).toBe(RADAR_R);
    expect(radiusFor(null)).toBe(RADAR_R);
    expect(radiusFor(-5)).toBe(0);
  });
});

describe("angleFor", () => {
  it("jest stały dla panelu i różny między panelami", () => {
    expect(angleFor("a")).toBe(angleFor("a"));
    expect(angleFor("a")).not.toBe(angleFor("b"));
    expect(angleFor("x")).toBeGreaterThanOrEqual(0);
    expect(angleFor("x")).toBeLessThan(Math.PI * 2);
  });
});

describe("callsigns", () => {
  it("numeruje panele tego samego agenta", () => {
    expect(callsigns(["claude", "pi", "claude"])).toEqual(["CLA1", "PI1", "CLA2"]);
  });
});

describe("blips", () => {
  it("ustawia znak na promieniu z ciszy i oznacza tryb", () => {
    const [b] = blips([{ id: "p", agentName: "claude", color: "#fff", quietMs: 60_000, level: 41, working: true, done: false }]);
    expect(Math.hypot(b!.x - 280, b!.y - 280)).toBeCloseTo(70);
    expect(b).toMatchObject({ call: "CLA1", level: 41, mode: "work" });
  });
});
