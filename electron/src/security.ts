//! Twardnienie okna: CSP dla załadowanej aplikacji (file://) i decyzja o nawigacji. Czyste funkcje, bez Electrona.

/**
 * CSP strony z `dist-web`. Renderer nie łączy się z siecią (cały ruch idzie przez IPC do procesu głównego),
 * więc `connect-src 'none'`. `blob:` w script-src: AudioWorklet VAD ładowany z Blob URL (`src/voice/audio.ts`);
 * `'wasm-unsafe-eval'`: wasm podświetlacza shiki. Style inline: React (`style=`) i xterm.
 */
export function buildCsp(): string {
  return [
    "default-src 'none'",
    "script-src 'self' 'wasm-unsafe-eval' blob:",
    "worker-src 'self' blob:",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    "media-src 'self' data: blob:",
    "connect-src 'none'",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
    "frame-src 'none'",
  ].join("; ");
}

/** CSP stosujemy tylko do stron z dysku (file://); dev serwer Vite (http://localhost) jej nie dostaje, żeby HMR działał. */
export function shouldApplyCsp(url: string): boolean {
  return url.startsWith("file://");
}

/** Czy nawigacja okna do `target` jest dozwolona: tylko w obrębie bieżącej aplikacji (ten sam dev origin albo ta sama strona file://). */
export function allowNavigation(target: string, appUrl: { dev?: string; file: string }): boolean {
  let t: URL;
  try {
    t = new URL(target);
  } catch {
    return false;
  }
  if (appUrl.dev) {
    try {
      return t.origin !== "null" && t.origin === new URL(appUrl.dev).origin;
    } catch {
      return false;
    }
  }
  if (t.protocol !== "file:") return false;
  // Ta sama strona (hash/query dozwolone), nie dowolny plik z dysku.
  return t.pathname === new URL(appUrl.file).pathname;
}

/**
 * Czy żądanie IPC pochodzi z naszej strony: ramka musi mieć adres z `dist-web/index.html` (file://)
 * albo, przy `AGENTS_DEV_URL`, z tego samego originu. Obca ramka (nawigacja, iframe) nie dostaje nic.
 */
export function isTrustedSender(url: string | undefined | null, appUrl: { dev?: string; file: string }): boolean {
  return typeof url === "string" && url !== "" && allowNavigation(url, appUrl);
}

/**
 * Uprawnienia Chromium, które aplikacja naprawdę wykorzystuje (domyślnie Electron przyznaje wszystko):
 * mikrofon dla dyktowania i rozmowy głosowej (`getUserMedia({ audio })`) oraz zapis do schowka z poziomu strony.
 * Kamera, powiadomienia, geolokalizacja, pełny ekran, odczyt schowka itd. są odrzucane.
 */
export function allowPermission(
  permission: string,
  url: string | undefined | null,
  appUrl: { dev?: string; file: string },
  mediaTypes: readonly string[] = [],
): boolean {
  if (!isTrustedSender(url, appUrl)) return false;
  if (permission === "clipboard-sanitized-write") return true;
  if (permission === "media") return mediaTypes.length > 0 && mediaTypes.every((m) => m === "audio");
  return false;
}

/** Rodzaje argumentów IPC. */
export type ArgKind = "str" | "path" | "int" | "bool" | "strs" | "paths" | "obj" | "objs" | "bytes" | "any";
/** Rodzaj albo lista dozwolonych tekstów (enum); `?` na końcu rodzaju = opcjonalny. */
export type ArgSpec = ArgKind | `${ArgKind}?` | readonly string[];

const MAX_STR = 64 * 1024 * 1024;
const MAX_PATH = 4096;
const MAX_ITEMS = 10_000;

/** Lekka walidacja typów argumentów `invoke`; błąd mówi, który argument i czego brakuje. */
export function validateArgs(name: string, args: unknown[], spec: readonly ArgSpec[]): void {
  if (args.length > spec.length) throw new Error(`${name}: za dużo argumentów (${args.length} > ${spec.length})`);
  spec.forEach((raw, i) => {
    const v = args[i];
    const bad = (what: string) => new Error(`${name}: argument ${i + 1} musi być ${what}`);
    if (typeof raw !== "string") {
      if (typeof v !== "string" || !raw.includes(v)) throw bad(`jednym z: ${raw.join(", ")}`);
      return;
    }
    const optional = raw.endsWith("?");
    const kind = (optional ? raw.slice(0, -1) : raw) as ArgKind;
    if (v === undefined || v === null) {
      if (optional) return;
      throw bad("podany");
    }
    const str = (x: unknown, max: number, nul: boolean): void => {
      if (typeof x !== "string") throw bad("tekstem");
      if (x.length > max) throw bad(`krótszy niż ${max} znaków`);
      if (nul && x.includes("\0")) throw bad("bez bajtu zerowego");
    };
    switch (kind) {
      case "str":
        return str(v, MAX_STR, false);
      case "path":
        return str(v, MAX_PATH, true);
      case "int":
        if (!Number.isSafeInteger(v)) throw bad("liczbą całkowitą");
        return;
      case "bool":
        if (typeof v !== "boolean") throw bad("wartością logiczną");
        return;
      case "strs":
      case "paths":
        if (!Array.isArray(v) || v.length > MAX_ITEMS) throw bad(`tablicą tekstów (do ${MAX_ITEMS})`);
        for (const x of v) str(x, kind === "paths" ? MAX_PATH : MAX_STR, kind === "paths");
        return;
      case "obj":
        if (typeof v !== "object" || Array.isArray(v)) throw bad("obiektem");
        return;
      case "objs":
        if (!Array.isArray(v) || v.length > MAX_ITEMS || v.some((x) => typeof x !== "object" || x === null)) throw bad("tablicą obiektów");
        return;
      case "bytes":
        if (!(v instanceof Uint8Array)) throw bad("danymi binarnymi");
        return;
      case "any":
        return;
    }
  });
}

/** Kształt `SpawnSpec` z renderera: komenda, argumenty, katalog, rozmiar, para (klucz, wartość) środowiska. */
export function validateSpawnSpec(spec: unknown): void {
  const bad = (m: string) => new Error(`pty_spawn: ${m}`);
  if (typeof spec !== "object" || spec === null || Array.isArray(spec)) throw bad("spec musi być obiektem");
  const s = spec as Record<string, unknown>;
  const text = (v: unknown, what: string) => {
    if (typeof v !== "string" || v.length > MAX_PATH || v.includes("\0")) throw bad(`${what} musi być tekstem bez bajtu zerowego`);
  };
  text(s.command, "command");
  if (s.command === "") throw bad("command jest pusty");
  if (s.args !== undefined) {
    if (!Array.isArray(s.args) || s.args.length > MAX_ITEMS) throw bad("args musi być tablicą tekstów");
    for (const a of s.args) {
      if (typeof a !== "string" || a.length > MAX_STR || a.includes("\0")) throw bad("args musi zawierać teksty bez bajtu zerowego");
    }
  }
  if (s.cwd !== undefined && s.cwd !== null) text(s.cwd, "cwd");
  if (!Number.isSafeInteger(s.cols) || !Number.isSafeInteger(s.rows)) throw bad("cols i rows muszą być liczbami całkowitymi");
  if (s.env !== undefined) {
    if (!Array.isArray(s.env) || s.env.length > MAX_ITEMS) throw bad("env musi być tablicą par");
    for (const p of s.env) {
      if (!Array.isArray(p) || p.length !== 2) throw bad("env musi składać się z par [klucz, wartość]");
      text(p[0], "klucz env");
      text(p[1], "wartość env");
    }
  }
}

/** Zapamiętane ścieżki z `pick_image`: `bot_avatar_import` przyjmuje tylko wskazaną w dialogu, raz. */
export class PickedFiles {
  private readonly set = new Set<string>();
  add(file: string): void {
    this.set.add(file);
  }
  /** Zdejmuje ścieżkę ze zbioru; `false`, gdy nie pochodziła z dialogu (albo już ją zużyto). */
  take(file: string): boolean {
    return this.set.delete(file);
  }
}
