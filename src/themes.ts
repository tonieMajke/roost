/** Motywy okna „Wygląd” (`ui.theme`). Pure: no React, no DOM.
 *  Wzory: makiety A–U z „Nowych wyglądów” (2026-10-01) + obecny wzór D. Każdy motyw zmienia
 *  tylko wygląd tego samego układu (tokeny i ozdoby w themes.css), nie układ ani zachowanie.
 *  Tu siedzi to, czego CSS nie dosięgnie: kolory i font xtermu oraz próbki do wyboru. */

import type { ITheme } from "@xterm/xterm";

export const THEME_IDS = [
  "d",
  "kreslarnia",
  "rozdzielnia",
  "rzeka",
  "cisza",
  "metro",
  "pulpit95",
  "plakat",
  "konstelacja",
  "akwarium",
  "skladanka",
  "wieza",
  "kuchnia",
  "druzyna",
  "oiom",
  "telegazeta",
  "zeszyt",
  "shonen",
  "karuzela",
  "mglawica",
  "biuro",
  "rtec",
] as const;

export type ThemeId = (typeof THEME_IDS)[number];

export type Theme = {
  id: ThemeId;
  /** Nazwa w oknie „Wygląd”. */
  label: string;
  /** Jasne tło okna (tylko informacja w podpowiedzi). */
  light: boolean;
  /** Akcent motywu (#rrggbb) – gdy `ui.accent` = "theme". Ta sama wartość co `--accent` w themes.css. */
  accent: string;
  /** Próbka w oknie „Wygląd”: tło, panel, tekst. */
  swatch: [bg: string, pane: string, text: string];
  /** Tło i tekst terminala; `--term-bg` dla `.pane-body` App bierze stąd (jedno źródło). */
  term: { background: string; foreground: string; selection: string; ansi?: Partial<ITheme> };
  /** Font xtermu (rodzina CSS); bez wpisu – JetBrains Mono. */
  termFont?: string;
};

export const DEFAULT_TERM_FONT = '"JetBrains Mono Variable", monospace';

/** Kolory ANSI na jasne tło: „biały” to szary, żeby tekst programów był czytelny. */
const LIGHT_ANSI: Partial<ITheme> = {
  black: "#1d1f21",
  red: "#c0262d",
  green: "#2f7d1a",
  yellow: "#9a6a00",
  blue: "#2456b0",
  magenta: "#8a3fa8",
  cyan: "#1f7f8a",
  white: "#5b6170",
  brightBlack: "#6b7280",
  brightRed: "#d23a2f",
  brightGreen: "#3c8f22",
  brightYellow: "#ad7a00",
  brightBlue: "#3466c8",
  brightMagenta: "#9b4fbf",
  brightCyan: "#2a909b",
  brightWhite: "#3a3f4a",
};

const PHOSPHOR_ANSI: Partial<ITheme> = {
  black: "#0a1d18",
  red: "#ff5a4a",
  green: "#49f2a8",
  yellow: "#ffb547",
  blue: "#5fc7d8",
  magenta: "#c79bff",
  cyan: "#7af0d0",
  white: "#cfeee2",
  brightBlack: "#3f8a6c",
  brightRed: "#ff7a6a",
  brightGreen: "#8affc8",
  brightYellow: "#ffd07a",
  brightBlue: "#8adcec",
  brightMagenta: "#ddbfff",
  brightCyan: "#a8fff0",
  brightWhite: "#effff8",
};

const TELETEXT_ANSI: Partial<ITheme> = {
  black: "#000000",
  red: "#ff0000",
  green: "#00ff00",
  yellow: "#ffff00",
  blue: "#3b5bff",
  magenta: "#ff00ff",
  cyan: "#00ffff",
  white: "#ffffff",
  brightBlack: "#9a9a9a",
  brightRed: "#ff5a5a",
  brightGreen: "#7aff7a",
  brightYellow: "#ffff8a",
  brightBlue: "#7a8aff",
  brightMagenta: "#ff7aff",
  brightCyan: "#8affff",
  brightWhite: "#ffffff",
};

const CGA_ANSI: Partial<ITheme> = {
  black: "#000000",
  red: "#aa0000",
  green: "#00aa00",
  yellow: "#aa5500",
  blue: "#3f3fd8",
  magenta: "#aa00aa",
  cyan: "#00aaaa",
  white: "#aaaaaa",
  brightBlack: "#555555",
  brightRed: "#ff5555",
  brightGreen: "#55ff55",
  brightYellow: "#ffff55",
  brightBlue: "#7a7aff",
  brightMagenta: "#ff55ff",
  brightCyan: "#55ffff",
  brightWhite: "#ffffff",
};

const light = (background: string, foreground: string, selection: string) => ({
  background,
  foreground,
  selection,
  ansi: LIGHT_ANSI,
});

export const THEMES: Record<ThemeId, Theme> = {
  d: {
    id: "d", label: "Wzór D", light: false, accent: "#ff8a4c",
    swatch: ["#0b0c0f", "#101216", "#eef1f4"],
    term: { background: "#0d0e11", foreground: "#c6ced8", selection: "rgba(255, 138, 76, 0.3)" },
  },
  kreslarnia: {
    id: "kreslarnia", label: "Kreślarnia", light: true, accent: "#1c3a9e",
    swatch: ["#eef1f5", "#fbfcfd", "#1c3a9e"],
    term: light("#fbfcfd", "#1a1f2b", "rgba(28, 58, 158, 0.2)"),
    termFont: '"IBM Plex Mono", monospace',
  },
  rozdzielnia: {
    id: "rozdzielnia", label: "Rozdzielnia", light: false, accent: "#ffb02e",
    swatch: ["#1b1a17", "#2a2824", "#ffb02e"],
    term: { background: "#0e0d0b", foreground: "#d8d2c4", selection: "rgba(255, 176, 46, 0.28)" },
  },
  rzeka: {
    id: "rzeka", label: "Rzeka", light: false, accent: "#ffd25c",
    swatch: ["#0f1218", "#141821", "#8fd3ff"],
    term: { background: "#10141b", foreground: "#c6ced8", selection: "rgba(143, 211, 255, 0.25)" },
  },
  cisza: {
    id: "cisza", label: "Cisza", light: false, accent: "#f2c14e",
    swatch: ["#17181a", "#1c1d20", "#e6e3dc"],
    term: { background: "#1c1d20", foreground: "#d3d0c8", selection: "rgba(242, 193, 78, 0.22)" },
    termFont: '"Martian Mono Variable", monospace',
  },
  metro: {
    id: "metro", label: "Metro", light: true, accent: "#e23b2e",
    swatch: ["#f4f4f1", "#ffffff", "#e23b2e"],
    term: light("#ffffff", "#121417", "rgba(31, 111, 209, 0.2)"),
    termFont: '"Red Hat Mono Variable", monospace',
  },
  pulpit95: {
    id: "pulpit95", label: "Pulpit 95", light: true, accent: "#0b1f8f",
    swatch: ["#2e8b88", "#c3c3c3", "#0b1f8f"],
    term: { background: "#000000", foreground: "#c0c0c0", selection: "rgba(11, 31, 143, 0.7)", ansi: CGA_ANSI },
  },
  plakat: {
    id: "plakat", label: "Plakat", light: true, accent: "#ff3b1f",
    swatch: ["#ffe100", "#0b0b0b", "#ff3b1f"],
    term: { background: "#0b0b0b", foreground: "#fffdf0", selection: "rgba(255, 225, 0, 0.3)" },
  },
  konstelacja: {
    id: "konstelacja", label: "Konstelacja", light: true, accent: "#e0622a",
    swatch: ["#eceae4", "#ffffff", "#e0622a"],
    term: light("#fbfaf7", "#2e2c28", "rgba(224, 98, 42, 0.18)"),
  },
  akwarium: {
    id: "akwarium", label: "Akwarium", light: false, accent: "#8cc8ff",
    swatch: ["#0d2235", "#131922", "#c9a86a"],
    term: { background: "#0f141c", foreground: "#c6ced8", selection: "rgba(140, 200, 255, 0.25)" },
  },
  skladanka: {
    id: "skladanka", label: "Składanka", light: true, accent: "#b8471a",
    swatch: ["#3a3f3a", "#fbfbf5", "#b8471a"],
    term: light("#fbfbf5", "#222222", "rgba(18, 122, 80, 0.2)"),
    termFont: '"Courier Prime", monospace',
  },
  wieza: {
    id: "wieza", label: "Wieża", light: false, accent: "#49f2a8",
    swatch: ["#06120f", "#0a1d18", "#49f2a8"],
    term: { background: "#07150f", foreground: "#cfeee2", selection: "rgba(73, 242, 168, 0.25)", ansi: PHOSPHOR_ANSI },
    termFont: '"Share Tech Mono", monospace',
  },
  kuchnia: {
    id: "kuchnia", label: "Kuchnia", light: false, accent: "#e3a21a",
    swatch: ["#2a2d31", "#fffdf6", "#e2402b"],
    term: { background: "#121416", foreground: "#d6dade", selection: "rgba(227, 162, 26, 0.28)" },
  },
  druzyna: {
    id: "druzyna", label: "Drużyna", light: false, accent: "#ffd84a",
    swatch: ["#0a0c1e", "#2238a8", "#ffd84a"],
    term: { background: "#0b1048", foreground: "#e8ecff", selection: "rgba(255, 216, 74, 0.3)" },
  },
  oiom: {
    id: "oiom", label: "OIOM", light: false, accent: "#39ff8a",
    swatch: ["#000000", "#050806", "#39ff8a"],
    term: { background: "#000000", foreground: "#b9c8be", selection: "rgba(57, 255, 138, 0.25)" },
  },
  telegazeta: {
    id: "telegazeta", label: "Telegazeta", light: false, accent: "#ffff00",
    swatch: ["#000000", "#0000ff", "#ffff00"],
    term: { background: "#000000", foreground: "#ffffff", selection: "rgba(0, 0, 255, 0.6)", ansi: TELETEXT_ANSI },
  },
  zeszyt: {
    id: "zeszyt", label: "Zeszyt", light: true, accent: "#1e3fbf",
    swatch: ["#fdfdf8", "#c9dcef", "#d8322a"],
    term: light("#fdfdf8", "#3a3a40", "rgba(255, 236, 90, 0.7)"),
  },
  shonen: {
    id: "shonen", label: "Shōnen", light: true, accent: "#ff2a4d",
    swatch: ["#fbf7ee", "#111111", "#ffd400"],
    term: light("#ffffff", "#111111", "rgba(255, 212, 0, 0.45)"),
  },
  karuzela: {
    id: "karuzela", label: "Karuzela", light: false, accent: "#8fd3ff",
    swatch: ["#061117", "#14222a", "#8fd3ff"],
    term: { background: "#08141a", foreground: "#cfe6ef", selection: "rgba(143, 211, 255, 0.28)" },
  },
  mglawica: {
    id: "mglawica", label: "Mgławica", light: false, accent: "#b39bff",
    swatch: ["#05060a", "#1a1430", "#b39bff"],
    term: { background: "#0b0d14", foreground: "#d4d8e6", selection: "rgba(179, 155, 255, 0.3)" },
  },
  biuro: {
    id: "biuro", label: "Biuro", light: false, accent: "#ffd25c",
    swatch: ["#2c2942", "#13121c", "#ffd25c"],
    term: { background: "#13121c", foreground: "#e3dff0", selection: "rgba(255, 210, 92, 0.25)" },
  },
  rtec: {
    id: "rtec", label: "Rtęć", light: false, accent: "#c9ced6",
    swatch: ["#1d2026", "#08090b", "#c9ced6"],
    term: { background: "#0e1013", foreground: "#d8dce2", selection: "rgba(201, 206, 214, 0.25)" },
  },
};

/** Motyw xtermu: tło/tekst/ANSI z motywu, kursor i chwycony suwak w kolorze akcentu.
 *  Suwak odpowiada tokenom `--line-strong` / `--faint` (xterm bierze wartości, nie klasy). */
export function termTheme(theme: Theme, accent: string): ITheme {
  const lightBg = isLight(theme.term.background);
  return {
    ...theme.term.ansi,
    background: theme.term.background,
    foreground: theme.term.foreground,
    cursor: accent,
    cursorAccent: theme.term.background,
    selectionBackground: theme.term.selection,
    scrollbarSliderBackground: lightBg ? "rgba(0, 0, 0, 0.18)" : "rgba(255, 255, 255, 0.15)",
    scrollbarSliderHoverBackground: lightBg ? "rgba(0, 0, 0, 0.35)" : "#6f7883",
    scrollbarSliderActiveBackground: accent,
  };
}

/** Jasny kolor #rrggbb (luminancja > 0,5) – terminal Pulpitu 95 jest czarny mimo jasnego okna. */
export function isLight(hex: string): boolean {
  const n = Number.parseInt(hex.slice(1, 7), 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255 > 0.5;
}
