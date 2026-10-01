//! Ścieżki w wyjściu terminala (`src/foo.ts:41`): czysty parser linii i plan otwarcia pliku.

export type PathRef = {
  /** Zakres w linii: `start` włącznie, `end` wyłącznie (indeksy znaków). Obejmuje też `:41:7`. */
  start: number;
  end: number;
  /** Sama ścieżka, bez `:linia:kolumna`. */
  path: string;
  line?: number;
  col?: number;
};

// Znaki ścieżki; dwukropek tylko jako początek sufiksu `:linia[:kolumna]`.
const TOKEN = /[\p{L}\p{N}_.~@+\-/]+(?::\d{1,7}(?::\d{1,7})?)?/gu;
const MAX_REFS = 40;
const MAX_LINE = 2000;

/** Ma sens szukać pliku: zawiera `/` albo kończy się rozszerzeniem z literą (nie `1.5`, nie `e.g.`). */
function looksLikePath(p: string): boolean {
  if (p.length < 2 || p.endsWith("/")) return false;
  if (/^[.~/]+$/.test(p)) return false;
  if (p.startsWith("//")) return false; // reszta adresu URL
  if (p.includes("/")) return true;
  return /\.[A-Za-z][A-Za-z0-9]{0,9}$/.test(p) && !p.startsWith(".");
}

/** Kandydaci na ścieżki plików w jednej linii terminala; istnienie pliku sprawdza dopiero backend. */
export function findPathRefs(text: string): PathRef[] {
  const refs: PathRef[] = [];
  const src = text.length > MAX_LINE ? text.slice(0, MAX_LINE) : text;
  for (const m of src.matchAll(TOKEN)) {
    let tok = m[0];
    const start = m.index!;
    let line: number | undefined;
    let col: number | undefined;
    const suffix = /:(\d+)(?::(\d+))?$/.exec(tok);
    if (suffix) {
      line = Number(suffix[1]);
      if (suffix[2] !== undefined) col = Number(suffix[2]);
      tok = tok.slice(0, suffix.index);
    }
    // Interpunkcja doklejona do ścieżki: „plik.ts.” „a/b.ts,”.
    const trimmed = tok.replace(/[.,;]+$/, "");
    if (trimmed !== tok) {
      if (suffix) continue; // `plik.:3` to nie ścieżka z numerem
      tok = trimmed;
    }
    if (!looksLikePath(tok)) continue;
    if (line !== undefined && line < 1) line = undefined;
    const end = start + tok.length + (suffix && line !== undefined ? suffix[0].length : 0);
    refs.push({
      start,
      end,
      path: tok,
      ...(line !== undefined ? { line } : {}),
      ...(line !== undefined && col !== undefined && col >= 1 ? { col } : {}),
    });
    if (refs.length >= MAX_REFS) break;
  }
  return refs;
}

/** Ścieżka bezwzględna z `~/`, względnej do `cwd` albo bezwzględnej; bez dotykania dysku. */
export function absolutePath(p: string, cwd: string, home: string): string {
  const joined = p === "~" ? home : p.startsWith("~/") ? `${home}/${p.slice(2)}` : p.startsWith("/") ? p : `${cwd}/${p}`;
  const out: string[] = [];
  for (const part of joined.split("/")) {
    if (part === "" || part === ".") continue;
    if (part === "..") out.pop();
    else out.push(part);
  }
  return `/${out.join("/")}`;
}

const at = (f: string, l?: number, c?: number) => (l ? `${f}:${l}${c ? `:${c}` : ""}` : f);

/** Programy z GUI, które rozumieją plik:linia; reszta ($EDITOR=vim, nano…) nie otwiera się bez terminala. */
const GUI_EDITORS: Record<string, (file: string, line?: number, col?: number) => string[]> = {
  code: (f, l, c) => (l ? ["-g", at(f, l, c)] : [f]),
  codium: (f, l, c) => (l ? ["-g", at(f, l, c)] : [f]),
  "code-oss": (f, l, c) => (l ? ["-g", at(f, l, c)] : [f]),
  cursor: (f, l, c) => (l ? ["-g", at(f, l, c)] : [f]),
  subl: (f, l, c) => [at(f, l, c)],
  zed: (f, l, c) => [at(f, l, c)],
  kate: (f, l, c) => (l ? ["-l", String(l), ...(c ? ["-c", String(c)] : []), f] : [f]),
  gedit: (f, l) => (l ? [`+${l}`, f] : [f]),
  xed: (f, l) => (l ? [`+${l}`, f] : [f]),
  pluma: (f, l) => (l ? [`+${l}`, f] : [f]),
  mousepad: (f, l) => (l ? [`+${l}`, f] : [f]),
  geany: (f, l) => (l ? [`--line=${l}`, f] : [f]),
};

/** Polecenie otwarcia pliku jako tablica argumentów (bez powłoki). `editor` to $VISUAL/$EDITOR. */
export function openPlan(file: string, line: number | undefined, col: number | undefined, editor: string | undefined): { command: string; args: string[] } {
  // Tylko nazwa programu z listy: `code --wait`, ścieżki i reszta $EDITOR nie są wykonywane wprost.
  const name = (editor ?? "").trim().split(/\s+/)[0]?.split("/").pop() ?? "";
  const build = Object.hasOwn(GUI_EDITORS, name) ? GUI_EDITORS[name] : undefined;
  if (build) return { command: name, args: build(file, line, col) };
  return { command: "xdg-open", args: [file] };
}
