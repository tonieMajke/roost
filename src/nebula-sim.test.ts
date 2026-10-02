import { describe, expect, it } from "vitest";
import { CORE_RADIUS, MAX_PARTICLES, rateFor, step, type Emitter } from "./nebula-sim";

const core = { x: 100, y: 100 };
const em = (rate: number, extra: Partial<Emitter> = {}): Emitter => ({ x: 300, y: 100, color: "1,2,3", rate, ...extra });
const seq = () => { let s = 0.1; return () => (s = (s * 9301 + 0.49297) % 1); };

describe("rateFor", () => {
  it("pracujący sypie gęsto, skończony daje falę, bezczynny ledwie się tli", () => {
    expect(rateFor("pane st-working").rate).toBeGreaterThan(rateFor("pane st-unread").rate);
    expect(rateFor("pane st-done")).toEqual({ rate: 0, ring: true });
    expect(rateFor("pane").rate).toBeLessThan(rateFor("pane st-unread").rate);
  });
});

describe("step", () => {
  it("emituje rate cząstek na klatkę", () => {
    expect(step([], [em(3)], core, seq())).toHaveLength(3);
  });
  it("emiter z falą nie sypie cząstek", () => {
    expect(step([], [em(5, { ring: true })], core, seq())).toHaveLength(0);
  });
  it("cząstki zbliżają się do rdzenia i są pochłaniane", () => {
    let ps = step([], [em(1)], core, seq());
    for (let i = 0; i < 2000 && ps.length > 0; i++) ps = step(ps, [], core, seq());
    expect(ps).toHaveLength(0);
  });
  it("pochłania cząstkę wewnątrz rdzenia", () => {
    const ps = [{ x: 100 + CORE_RADIUS - 5, y: 100, vx: 0, vy: 0, color: "1,2,3", age: 0, size: 1 }];
    expect(step(ps, [], core, seq())).toHaveLength(0);
  });
  it("nie przekracza limitu cząstek", () => {
    let ps = [] as ReturnType<typeof step>;
    for (let i = 0; i < 400; i++) ps = step(ps, [em(20)], core, seq());
    expect(ps.length).toBeLessThanOrEqual(MAX_PARTICLES);
  });
});
