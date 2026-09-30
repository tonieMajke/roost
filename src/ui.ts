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
  feed: "all" | "project"; // dock „Na żywo”: every project or only the active one
  fontSize: number; // terminal font px, FONT_MIN..FONT_MAX (Ctrl+Alt+= / - / 0)
};

export const FONT_MIN = 10;
export const FONT_MAX = 20;

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
  feed: "all",
  fontSize: 13,
};

/** Keys with a fixed list of values (the „Wygląd” window); the rest have their own controls. */
type ChoiceKey = Exclude<keyof Ui, "dock" | "fontSize" | "feed">;

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
} as const satisfies Record<ChoiceKey, readonly string[]>;

/** Hex of each accent, kept in sync with the `.acc-*` classes in styles.css (xterm needs the value). */
export const ACCENT_HEX: Record<Ui["accent"], string> = {
  orange: "#ff8a4c",
  acid: "#e4ff3a",
  violet: "#b39bff",
  mint: "#3dffa2",
};

const ACCENT_LABELS: Record<Ui["accent"], string> = {
  orange: "Pomarańcz",
  acid: "Kwas",
  violet: "Fiolet",
  mint: "Mięta",
};

type Row<K extends keyof Ui> = {
  key: K;
  /** Etykieta wiersza w oknie „Wygląd” (po polsku). */
  label: string;
  choices: { value: Ui[K]; label: string; /** kółko koloru zamiast napisu (tylko akcent) */ swatch?: string }[];
};

/** Wiersz okna „Wygląd”: bez `dock` (przycisk „Pulpit”, Ctrl+Alt+D), `fontSize` (Ctrl+Alt+= / - / 0)
 *  i `feed` (przełącznik w nagłówku „Na żywo”). */
export type UiRow = { [K in ChoiceKey]: Row<K> }[ChoiceKey];

/** Wiersze okna „Wygląd” w kolejności tabeli z planu (wzor D: tablica `SET`). */
export const UI_ROWS: UiRow[] = [
  {
    key: "accent",
    label: "Akcent",
    choices: (Object.keys(ACCENT_HEX) as Ui["accent"][]).map((v) => ({ value: v, label: ACCENT_LABELS[v], swatch: ACCENT_HEX[v] })),
  },
  { key: "head", label: "Panel z fokusem", choices: [{ value: "fill", label: "Wypełniony" }, { value: "line", label: "Obrys" }] },
  { key: "work", label: "Agent pracuje", choices: [{ value: "glow", label: "Poświata" }, { value: "scan", label: "Skan" }] },
  { key: "edge", label: "Krawędzie", choices: [{ value: "sharp", label: "Ostre" }, { value: "soft", label: "Miękkie" }] },
  { key: "title", label: "Nazwa projektu", choices: [{ value: "big", label: "Duża" }, { value: "compact", label: "Zwarta" }] },
  { key: "grid", label: "Siatka w tle", choices: [{ value: "on", label: "Tak" }, { value: "off", label: "Nie" }] },
  { key: "motion", label: "Ruch", choices: [{ value: "full", label: "Pełny" }, { value: "lite", label: "Oszczędny" }] },
  { key: "rail", label: "Szyna", choices: [{ value: "open", label: "Otwarta" }, { value: "closed", label: "Zwinięta" }] },
];

/** Akcja `setUi` dla wyboru z wiersza: `{ [klucz]: wartość }` jako `Partial<Ui>`. */
export function uiPatch(key: keyof Ui, value: string): Partial<Ui> {
  // SAFETY: wiersze okna „Wygląd” dobierają wartość do swojego klucza (typ UiRow pilnuje pary),
  // więc { [key]: value } jest zawsze poprawnym Partial<Ui>.
  return { [key]: value } as Partial<Ui>;
}

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
  if (r.fontSize !== undefined) {
    const v = r.fontSize;
    if (typeof v === "number" && Number.isInteger(v) && v >= FONT_MIN && v <= FONT_MAX) ui.fontSize = v;
    else errors.push(`ui.fontSize: \`${String(v)}\` is not a whole number ${FONT_MIN}–${FONT_MAX}, using \`${DEFAULT_UI.fontSize}\``);
  }
  if (r.feed !== undefined) {
    if (r.feed === "all" || r.feed === "project") ui.feed = r.feed;
    else errors.push(`ui.feed: \`${String(r.feed)}\` is not one of all, project, using \`${DEFAULT_UI.feed}\``);
  }
  if (r.dock !== undefined) {
    if (typeof r.dock === "boolean") ui.dock = r.dock;
    else errors.push(`ui.dock: \`${String(r.dock)}\` is not true/false, using \`${DEFAULT_UI.dock}\``);
  }
  // SAFETY: every key of `ui` was copied from DEFAULT_UI or replaced by a value validated above,
  // so the record still has exactly the Ui shape.
  return { ui: ui as Ui, errors };
}

/** Font size after Ctrl+Alt+= (+1), Ctrl+Alt+- (-1) or Ctrl+Alt+0 (default), kept in range. */
export function stepFontSize(size: number, step: 1 | -1 | 0): number {
  if (step === 0) return DEFAULT_UI.fontSize;
  return Math.min(FONT_MAX, Math.max(FONT_MIN, size + step));
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
