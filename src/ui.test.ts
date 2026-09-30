import { describe, expect, it } from "vitest";
import {
  ACCENT_HEX,
  DEFAULT_UI,
  FONT_MAX,
  FONT_MIN,
  UI_CHOICES,
  UI_ROWS,
  parseUi,
  stepFontSize,
  uiClasses,
  uiPatch,
  type Ui,
} from "./ui";

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
    expect(parseUi({ fontSize2: 12, theme: "light" })).toEqual({ ui: DEFAULT_UI, errors: [] });
  });

  it("feed: project wczytuje się, zła wartość = all + błąd", () => {
    expect(parseUi({ feed: "project" }).ui.feed).toBe("project");
    expect(parseUi({ feed: "mine" })).toEqual({
      ui: DEFAULT_UI,
      errors: ["ui.feed: `mine` is not one of all, project, using `all`"],
    });
  });

  it("fontSize: liczba całkowita 10–20, inaczej 13 + błąd", () => {
    expect(parseUi({ fontSize: 10 }).ui.fontSize).toBe(10);
    expect(parseUi({ fontSize: 20 })).toEqual({ ui: { ...DEFAULT_UI, fontSize: 20 }, errors: [] });
    for (const bad of [9, 21, 12.5, "14", null]) {
      const { ui, errors } = parseUi({ fontSize: bad });
      expect(ui.fontSize).toBe(13);
      expect(errors).toHaveLength(1);
      expect(errors[0]).toContain("ui.fontSize");
    }
  });

  it("rail: closed wczytuje się, zła wartość = open + błąd", () => {
    expect(parseUi({ rail: "closed" }).ui.rail).toBe("closed");
    const { ui, errors } = parseUi({ rail: "narrow" });
    expect(ui.rail).toBe(DEFAULT_UI.rail);
    expect(errors).toEqual(["ui.rail: `narrow` is not one of open, closed, using `open`"]);
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

  it("rail=closed dodaje rail-closed, open nic nie dodaje", () => {
    expect(uiClasses({ ...DEFAULT_UI, rail: "closed" }).split(" ")).toContain("rail-closed");
    expect(uiClasses(DEFAULT_UI)).not.toContain("rail");
  });
});

describe("stepFontSize", () => {
  it("+1 / -1 w granicach 10–20, 0 = domyślne 13", () => {
    expect(stepFontSize(13, 1)).toBe(14);
    expect(stepFontSize(13, -1)).toBe(12);
    expect(stepFontSize(FONT_MAX, 1)).toBe(FONT_MAX);
    expect(stepFontSize(FONT_MIN, -1)).toBe(FONT_MIN);
    expect(stepFontSize(18, 0)).toBe(DEFAULT_UI.fontSize);
  });
});

describe("ACCENT_HEX", () => {
  it("covers every accent choice", () => {
    for (const a of ["orange", "acid", "violet", "mint"] as const) {
      expect(ACCENT_HEX[a]).toMatch(/^#[0-9a-f]{6}$/);
    }
  });
});

describe("UI_ROWS (okno „Wygląd”)", () => {
  it("każdy klucz ustawień (bez dock) ma dokładnie jeden wiersz, w kolejności UI_CHOICES", () => {
    const keys = UI_ROWS.map((r) => r.key);
    expect(keys).toEqual(Object.keys(UI_CHOICES));
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("wiersz pokrywa się z UI_CHOICES: te same wartości, etykieta przy każdej", () => {
    for (const row of UI_ROWS) {
      expect(row.label).not.toBe("");
      expect(row.choices.map((c) => c.value)).toEqual([...UI_CHOICES[row.key]]);
      for (const c of row.choices) {
        expect(c.label).not.toBe("");
        expect(c.value).not.toBe("");
      }
    }
  });

  it("tylko akcent ma kółka koloru, a ich barwy to ACCENT_HEX", () => {
    for (const row of UI_ROWS) {
      const swatches = row.choices.filter((c) => c.swatch !== undefined);
      expect(swatches.length).toBe(row.key === "accent" ? row.choices.length : 0);
    }
    const accent = UI_ROWS.find((r) => r.key === "accent")!;
    for (const c of accent.choices) expect(c.swatch).toBe(ACCENT_HEX[c.value as Ui["accent"]]);
  });

  it("uiPatch z pary wiersz/wartość daje Partial<Ui> do reduktora", () => {
    expect(uiPatch("edge", "soft")).toEqual({ edge: "soft" });
    const row = UI_ROWS.find((r) => r.key === "rail")!;
    expect(uiPatch(row.key, row.choices[1].value)).toEqual({ rail: "closed" });
  });
});
