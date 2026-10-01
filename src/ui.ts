/** Appearance settings (`workspace.json` -> `ui`). Pure: no React, no DOM.
 *  Class names follow docs/design/wzor-d.html; CSS for them lives in styles.css. */

import { THEME_IDS, THEMES, type ThemeId } from "./themes";
import { t } from "./i18n";
import type { LangPref } from "./i18n";
import { DEFAULT_DOCK_ORDER, parseDockOrder, type DockSection } from "./dockOrder";

export type Ui = {
  theme: ThemeId; // src/themes.ts + themes.css
  accent: "theme" | "orange" | "acid" | "violet" | "mint"; // "theme" = akcent motywu
  head: "fill" | "line"; // focused pane header
  work: "glow" | "scan"; // working indicator
  edge: "sharp" | "soft";
  title: "big" | "compact"; // project name in the area header
  grid: "on" | "off"; // background grid
  motion: "full" | "lite";
  dock: boolean; // desktop panel visible
  rail: "open" | "closed"; // left rail: full width or 56 px of keys and dots
  feed: "all" | "project"; // dock „Na żywo”: every project or only the active one
  dockOrder: DockSection[]; // kolejność sekcji pulpitu, przeciągana za uchwyt
  fontSize: number; // terminal font px, FONT_MIN..FONT_MAX (Ctrl+Alt+= / - / 0)
  lang: LangPref; // język interfejsu; "auto" = język systemu (polski albo angielski)
  mode: "code" | "chat" | "bot"; // zakładka: siatka terminali, Czat (M3), Bot (M5); Ctrl+Alt+C po kolei
};

export const FONT_MIN = 10;
export const FONT_MAX = 20;

export const DEFAULT_UI: Ui = {
  theme: "d",
  accent: "theme",
  head: "fill",
  work: "glow",
  edge: "sharp",
  title: "big",
  grid: "on",
  motion: "full",
  dock: true,
  rail: "open",
  feed: "all",
  dockOrder: DEFAULT_DOCK_ORDER,
  fontSize: 13,
  lang: "auto",
  mode: "code",
};

/** Keys with a fixed list of values (the „Wygląd” window); the rest have their own controls. */
type ChoiceKey = Exclude<keyof Ui, "dock" | "fontSize" | "feed" | "mode" | "dockOrder">;

/** Choice lists, in the table order of the plan (the „Wygląd” window renders them). */
export const UI_CHOICES = {
  theme: THEME_IDS,
  accent: ["theme", "orange", "acid", "violet", "mint"],
  head: ["fill", "line"],
  work: ["glow", "scan"],
  edge: ["sharp", "soft"],
  title: ["big", "compact"],
  grid: ["on", "off"],
  motion: ["full", "lite"],
  rail: ["open", "closed"],
  lang: ["auto", "pl", "en"],
} as const satisfies Record<ChoiceKey, readonly string[]>;

/** Hex of each accent, kept in sync with the `.acc-*` classes in styles.css (xterm needs the value). */
export const ACCENT_HEX: Record<Exclude<Ui["accent"], "theme">, string> = {
  orange: "#ff8a4c",
  acid: "#e4ff3a",
  violet: "#b39bff",
  mint: "#3dffa2",
};

/** Akcent, który faktycznie widać: własny albo motywu (xterm potrzebuje wartości). */
export function accentHex(ui: Ui): string {
  return ui.accent === "theme" ? THEMES[ui.theme].accent : ACCENT_HEX[ui.accent];
}

type Row<K extends keyof Ui> = {
  key: K;
  /** Etykieta wiersza w oknie „Wygląd” (po polsku). */
  label: string;
  choices: {
    value: Ui[K];
    label: string;
    /** kółko koloru zamiast napisu (akcent) */
    swatch?: string;
    /** próbka motywu: tło, panel, tekst + akcent */
    theme?: { colors: [string, string, string]; accent: string };
  }[];
};

/** Wiersz okna „Wygląd”: bez `dock` (przycisk „Pulpit”, Ctrl+Alt+D), `fontSize` (Ctrl+Alt+= / - / 0)
 *  i `feed` (przełącznik w nagłówku „Na żywo”). */
export type UiRow = { [K in ChoiceKey]: Row<K> }[ChoiceKey];

/** Wiersze okna „Wygląd” w kolejności tabeli z planu (wzor D: tablica `SET`), w bieżącym języku.
 *  Funkcja, nie stała: etykiety zależą od języka, który użytkownik może zmienić w trakcie pracy. */
export function uiRows(): UiRow[] {
  const accents = Object.keys(ACCENT_HEX) as Exclude<Ui["accent"], "theme">[];
  return [
    {
      key: "theme",
      label: t("ui.row.theme"),
      choices: THEME_IDS.map((id) => ({
        value: id,
        label: t(`ui.theme.${id}`),
        theme: { colors: THEMES[id].swatch, accent: THEMES[id].accent },
      })),
    },
    {
      key: "accent",
      label: t("ui.row.accent"),
      choices: [
        { value: "theme", label: t("ui.accent.theme") },
        ...accents.map((v) => ({ value: v, label: t(`ui.accent.${v}`), swatch: ACCENT_HEX[v] })),
      ],
    },
    { key: "head", label: t("ui.row.head"), choices: [{ value: "fill", label: t("ui.head.fill") }, { value: "line", label: t("ui.head.line") }] },
    { key: "work", label: t("ui.row.work"), choices: [{ value: "glow", label: t("ui.work.glow") }, { value: "scan", label: t("ui.work.scan") }] },
    { key: "edge", label: t("ui.row.edge"), choices: [{ value: "sharp", label: t("ui.edge.sharp") }, { value: "soft", label: t("ui.edge.soft") }] },
    { key: "title", label: t("ui.row.title"), choices: [{ value: "big", label: t("ui.title.big") }, { value: "compact", label: t("ui.title.compact") }] },
    { key: "grid", label: t("ui.row.grid"), choices: [{ value: "on", label: t("ui.yes") }, { value: "off", label: t("ui.no") }] },
    { key: "motion", label: t("ui.row.motion"), choices: [{ value: "full", label: t("ui.motion.full") }, { value: "lite", label: t("ui.motion.lite") }] },
    { key: "rail", label: t("ui.row.rail"), choices: [{ value: "open", label: t("ui.rail.open") }, { value: "closed", label: t("ui.rail.closed") }] },
    // Nazwy języków zawsze we własnym języku, żeby dało się je znaleźć, gdy interfejs jest obcy.
    { key: "lang", label: t("ui.row.lang"), choices: [{ value: "auto", label: t("ui.lang.auto") }, { value: "pl", label: "Polski" }, { value: "en", label: "English" }] },
  ];
}

/** Akcja `setUi` dla wyboru z wiersza: `{ [klucz]: wartość }` jako `Partial<Ui>`. */
export function uiPatch(key: keyof Ui, value: string): Partial<Ui> {
  // Nowy motyw przynosi swój akcent; własny można potem wybrać jeszcze raz.
  if (key === "theme") return { theme: value as ThemeId, accent: "theme" };
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
  if (r.dockOrder !== undefined) {
    const { order, error } = parseDockOrder(r.dockOrder);
    ui.dockOrder = order;
    if (error) errors.push(error);
  }
  if (r.mode !== undefined) {
    if (r.mode === "code" || r.mode === "chat" || r.mode === "bot") ui.mode = r.mode;
    else errors.push(`ui.mode: \`${String(r.mode)}\` is not one of code, chat, bot, using \`${DEFAULT_UI.mode}\``);
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
    `acc-${ui.accent}`, // acc-theme: bez reguły w CSS, akcent przychodzi z [data-theme]
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

const MODES: Ui["mode"][] = ["code", "chat", "bot"];
/** Ctrl+Alt+C: Code → Czat → Bot → Code. */
export const nextMode = (m: Ui["mode"]): Ui["mode"] => MODES[(MODES.indexOf(m) + 1) % MODES.length];
