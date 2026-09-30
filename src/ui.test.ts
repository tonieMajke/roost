import { describe, expect, it } from "vitest";
import { ACCENT_HEX, DEFAULT_UI, parseUi, uiClasses, type Ui } from "./ui";

describe("parseUi", () => {
  it("missing key (or missing block) = defaults, no errors", () => {
    expect(parseUi(undefined)).toEqual({ ui: DEFAULT_UI, errors: [] });
    expect(parseUi({})).toEqual({ ui: DEFAULT_UI, errors: [] });
    expect(parseUi({ accent: "mint" }).ui).toEqual({ ...DEFAULT_UI, accent: "mint" });
  });

  it("bad value = default for that key + one error, good keys survive", () => {
    const { ui, errors } = parseUi({ accent: "pink", edge: "soft", dock: "yes" });
    expect(ui.accent).toBe(DEFAULT_UI.accent);
    expect(ui.edge).toBe("soft");
    expect(ui.dock).toBe(DEFAULT_UI.dock);
    expect(errors).toHaveLength(2);
    expect(errors[0]).toContain("ui.accent");
    expect(errors[1]).toContain("ui.dock");
  });

  it("non-object block = all defaults + one error", () => {
    const { ui, errors } = parseUi("neon");
    expect(ui).toEqual(DEFAULT_UI);
    expect(errors).toHaveLength(1);
  });

  it("unknown extra keys are ignored without errors", () => {
    expect(parseUi({ fontSize: 12 })).toEqual({ ui: DEFAULT_UI, errors: [] });
  });
});

describe("uiClasses", () => {
  it("defaults produce the wzor-D class list", () => {
    expect(uiClasses(DEFAULT_UI)).toBe("acc-orange fh-fill work-glow edge-sharp title-big bg-grid motion-full");
  });

  it("grid=off drops bg-grid, other classes follow their values", () => {
    const ui: Ui = { ...DEFAULT_UI, grid: "off", accent: "acid", title: "compact", edge: "soft" };
    expect(uiClasses(ui)).toBe("acc-acid fh-fill work-glow edge-soft title-compact motion-full");
  });
});

describe("ACCENT_HEX", () => {
  it("covers every accent choice", () => {
    for (const a of ["orange", "acid", "violet", "mint"] as const) {
      expect(ACCENT_HEX[a]).toMatch(/^#[0-9a-f]{6}$/);
    }
  });
});
