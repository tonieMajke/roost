/** Appearance settings (`workspace.json` -> `ui`). Pure: no React, no DOM.
 *  Class names follow docs/design/wzor-d.html; CSS for them lives in styles.css. */

export type Ui = {
  accent: "orange" | "acid" | "violet" | "mint";
  head: "fill" | "line"; // focused pane header
  work: "glow" | "scan"; // working indicator
  edge: "sharp" | "soft";
  title: "big" | "compact"; // project name in the area header
  grid: "on" | "off"; // background grid
  motion: "full" | "lite";
  dock: boolean; // desktop panel visible
  rail: "open" | "closed"; // left rail: full width or 56 px of keys and dots
};

export const DEFAULT_UI: Ui = {
  accent: "orange",
  head: "fill",
  work: "glow",
  edge: "sharp",
  title: "big",
  grid: "on",
  motion: "full",
  dock: true,
  rail: "open",
};

/** Choice lists, in the table order of the plan (the „Wygląd” window renders them). */
export const UI_CHOICES = {
  accent: ["orange", "acid", "violet", "mint"],
  head: ["fill", "line"],
  work: ["glow", "scan"],
  edge: ["sharp", "soft"],
  title: ["big", "compact"],
  grid: ["on", "off"],
  motion: ["full", "lite"],
  rail: ["open", "closed"],
} as const satisfies Record<Exclude<keyof Ui, "dock">, readonly string[]>;

/** Hex of each accent, kept in sync with the `.acc-*` classes in styles.css (xterm needs the value). */
export const ACCENT_HEX: Record<Ui["accent"], string> = {
  orange: "#ff8a4c",
  acid: "#e4ff3a",
  violet: "#b39bff",
  mint: "#3dffa2",
};

/** Missing keys fall back to defaults; a bad value falls back too and is reported. */
export function parseUi(raw: unknown): { ui: Ui; errors: string[] } {
  const errors: string[] = [];
  if (raw === undefined) return { ui: DEFAULT_UI, errors };
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return { ui: DEFAULT_UI, errors: ["workspace: `ui` must be an object, using defaults"] };
  }
  const r = raw as Record<string, unknown>;
  const ui: Record<keyof Ui, unknown> = { ...DEFAULT_UI };
  for (const key of Object.keys(UI_CHOICES) as (keyof typeof UI_CHOICES)[]) {
    const v = r[key];
    if (v === undefined) continue;
    const choices: readonly string[] = UI_CHOICES[key];
    // SAFETY: key indexes UI_CHOICES and v passed the choices.includes() check, so it is a legal Ui[key].
    if (typeof v === "string" && choices.includes(v)) ui[key] = v;
    else errors.push(`ui.${key}: \`${String(v)}\` is not one of ${choices.join(", ")}, using \`${DEFAULT_UI[key]}\``);
  }
  if (r.dock !== undefined) {
    if (typeof r.dock === "boolean") ui.dock = r.dock;
    else errors.push(`ui.dock: \`${String(r.dock)}\` is not true/false, using \`${DEFAULT_UI.dock}\``);
  }
  // SAFETY: every key of `ui` was copied from DEFAULT_UI or replaced by a value validated above,
  // so the record still has exactly the Ui shape.
  return { ui: ui as Ui, errors };
}

/** Classes on `.app` that realize the settings (dock is handled in the layout, not as a class). */
export function uiClasses(ui: Ui): string {
  return [
    `acc-${ui.accent}`,
    `fh-${ui.head}`,
    `work-${ui.work}`,
    `edge-${ui.edge}`,
    `title-${ui.title}`,
    ui.grid === "on" ? "bg-grid" : "",
    `motion-${ui.motion}`,
    ui.rail === "closed" ? "rail-closed" : "",
  ]
    .filter(Boolean)
    .join(" ");
}
