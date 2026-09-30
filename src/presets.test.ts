import { describe, expect, it } from "vitest";
import { BUILT_IN_PRESETS, planPreset } from "./presets";

describe("BUILT_IN_PRESETS", () => {
  it("has the three built-in presets with agent ids from the default config", () => {
    expect(BUILT_IN_PRESETS.map((p) => [p.name, p.agents])).toEqual([
      ["Claude + pi", ["claude", "pi"]],
      ["2× Claude + 2× pi", ["claude", "claude", "pi", "pi"]],
      ["4× Claude", ["claude", "claude", "claude", "claude"]],
    ]);
  });

  it("has unique names and no empty agent lists", () => {
    const names = BUILT_IN_PRESETS.map((p) => p.name);
    expect(new Set(names).size).toBe(names.length);
    for (const p of BUILT_IN_PRESETS) {
      expect(p.agents.length).toBeGreaterThan(0);
      for (const a of p.agents) expect(typeof a).toBe("string");
    }
  });
});

describe("planPreset", () => {
  const p = (agents: string[]) => ({ name: "x", agents });

  it("keeps the preset order when everything fits", () => {
    expect(planPreset(p(["pi", "claude", "pi"]), ["claude", "pi"], 16)).toEqual({
      agents: ["pi", "claude", "pi"],
      skipped: [],
      dropped: 0,
    });
  });

  it("skips agents missing from the config, without duplicates in the message", () => {
    expect(planPreset(p(["claude", "codex", "codex", "pi"]), ["claude", "pi"], 16)).toEqual({
      agents: ["claude", "pi"],
      skipped: ["codex"],
      dropped: 0,
    });
  });

  it("cuts at the free slots and counts what did not fit", () => {
    expect(planPreset(p(["claude", "claude", "claude", "claude"]), ["claude"], 2)).toEqual({
      agents: ["claude", "claude"],
      skipped: [],
      dropped: 2,
    });
  });

  it("skipped agents do not eat slots, dropped counts only known agents", () => {
    expect(planPreset(p(["codex", "claude", "claude", "codex"]), ["claude"], 1)).toEqual({
      agents: ["claude"],
      skipped: ["codex"],
      dropped: 1,
    });
  });

  it("adds nothing when there is no room", () => {
    expect(planPreset(p(["claude", "pi"]), ["claude", "pi"], 0)).toEqual({
      agents: [],
      skipped: [],
      dropped: 2,
    });
  });

  it("treats a negative slot count as zero", () => {
    expect(planPreset(p(["claude"]), ["claude"], -3).agents).toEqual([]);
  });

  it("adds nothing when no agent is configured", () => {
    expect(planPreset(p(["claude", "pi"]), [], 16)).toEqual({
      agents: [],
      skipped: ["claude", "pi"],
      dropped: 0,
    });
  });
});
