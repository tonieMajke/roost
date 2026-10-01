import { describe, expect, it } from "vitest";
import { THEME_IDS, THEMES, isLight, termTheme } from "./themes";
import css from "./themes.css?raw";
import chatCss from "./themes-chat.css?raw";

const HEX = /^#[0-9a-f]{6}$/;

describe("THEMES", () => {
  it("jeden wpis na id, id zgodne z kluczem", () => {
    expect(Object.keys(THEMES)).toEqual([...THEME_IDS]);
    for (const id of THEME_IDS) {
      expect(THEMES[id].id).toBe(id);
      expect(THEMES[id].label).not.toBe("");
    }
  });

  it("kolory to #rrggbb (xterm i --term-bg biorą wartości)", () => {
    for (const t of Object.values(THEMES)) {
      expect(t.accent).toMatch(HEX);
      expect(t.term.background).toMatch(HEX);
      expect(t.term.foreground).toMatch(HEX);
      for (const c of t.swatch) expect(c).toMatch(HEX);
    }
  });

  it("każdy motyw poza wzorem D ma blok tokenów w themes.css, z tym samym akcentem", () => {
    for (const id of THEME_IDS) {
      if (id === "d") continue;
      const m = css.match(new RegExp(`:root\\[data-theme="${id}"\\] \\{([^}]*)\\}`));
      expect(m, id).not.toBeNull();
      expect(m![1], id).toContain(`--accent: ${THEMES[id].accent};`);
    }
  });

  it("themes.css i themes-chat.css nie znają motywów spoza listy", () => {
    for (const file of [css, chatCss]) {
      const used = new Set([...file.matchAll(/data-theme="([a-z0-9]+)"/g)].map((m) => m[1]));
      for (const id of used) expect(THEME_IDS as readonly string[]).toContain(id);
    }
  });

  it("każdy motyw poza wzorem D ma coś w Czacie i Bocie (themes-chat.css)", () => {
    for (const id of THEME_IDS) if (id !== "d") expect(chatCss, id).toContain(`[data-theme="${id}"]`);
  });

  it("tekst terminala odcina się od tła (jasny na ciemnym albo odwrotnie)", () => {
    for (const t of Object.values(THEMES)) {
      expect(isLight(t.term.foreground), t.id).toBe(!isLight(t.term.background));
    }
  });
});

describe("termTheme", () => {
  it("kursor i chwycony suwak w kolorze akcentu, tło z motywu", () => {
    const x = termTheme(THEMES.wieza, "#123456");
    expect(x.cursor).toBe("#123456");
    expect(x.scrollbarSliderActiveBackground).toBe("#123456");
    expect(x.background).toBe(THEMES.wieza.term.background);
    expect(x.green).toBe("#49f2a8");
  });

  it("suwak na jasnym terminalu ciemny, na ciemnym jasny (Pulpit 95: jasne okno, czarny terminal)", () => {
    expect(termTheme(THEMES.kreslarnia, "#000000").scrollbarSliderBackground).toContain("0, 0, 0");
    expect(termTheme(THEMES.pulpit95, "#000000").scrollbarSliderBackground).toContain("255, 255, 255");
  });
});
