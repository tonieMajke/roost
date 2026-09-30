import { describe, expect, it } from "vitest";
import { CONFIRM_MS, confirmClick, isArmed, type Arm } from "./confirm";

const arm = (key: string, at: number): Arm => ({ key, at });

describe("confirmClick", () => {
  it("first click arms, does not fire", () => {
    const r = confirmClick(null, "p:1", 1000);
    expect(r.fire).toBe(false);
    expect(r.arm).toEqual({ key: "p:1", at: 1000 });
  });

  it("second click inside the window fires and disarms", () => {
    const r = confirmClick(arm("p:1", 1000), "p:1", 1000 + CONFIRM_MS - 1);
    expect(r).toEqual({ fire: true, arm: null });
  });

  it("after the window the click only re-arms", () => {
    const r = confirmClick(arm("p:1", 1000), "p:1", 1000 + CONFIRM_MS);
    expect(r.fire).toBe(false);
    expect(r.arm).toEqual({ key: "p:1", at: 1000 + CONFIRM_MS });
  });

  it("arming another target never fires the first one", () => {
    const r = confirmClick(arm("p:1", 1000), "p:2", 1500);
    expect(r.fire).toBe(false);
    expect(r.arm).toEqual({ key: "p:2", at: 1500 });
  });
});

describe("isArmed", () => {
  it("reports the armed target only, inside the window", () => {
    expect(isArmed(arm("p:1", 1000), "p:1", 2000)).toBe(true);
    expect(isArmed(arm("p:1", 1000), "p:2", 2000)).toBe(false);
    expect(isArmed(arm("p:1", 1000), "p:1", 5000)).toBe(false);
    expect(isArmed(null, "p:1", 1000)).toBe(false);
  });
});
