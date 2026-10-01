//! Rozmiar kontekstu rozmowy agenta, z jego własnego pliku sesji.
//! Tylko odczyt: nic nie jest zapisywane w `~/.claude` ani `~/.pi`.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { expand } from "./env";

export type Kind = "claude" | "pi";

/** Czytany jest tylko koniec: najnowsze usage jest na końcu, a pliki sesji rosną do wielu MB. */
export const TAIL_BYTES = 256 * 1024;
/** Dość wywołań narzędzi na 5 s między odczytami; starsze już są w feedzie. */
export const MAX_TOOLS = 10;
export const COMMAND_CHARS = 60;
const TITLE_CHARS = 80;

export type ToolUse = { id: string; name: string; file: string | null; command: string | null };

export type SessionContext = {
  tokens: number;
  model: string | null;
  /** Okno modelu, gdy podaje je konfiguracja agenta (pi); claude: z nazwy modelu w TS. */
  window: number | null;
  /** Najnowsze wywołania narzędzi z końca pliku, od najstarszego (feed „Na żywo”). */
  tools: ToolUse[];
  /** Nazwa rozmowy (dok): claude `/rename` albo tytuł AI, pi `/name` albo pierwsze polecenie. */
  title: string | null;
};

type Json = Record<string, unknown>;
const obj = (v: unknown): Json | null => (v !== null && typeof v === "object" && !Array.isArray(v) ? (v as Json) : null);
const str = (v: unknown): string | null => (typeof v === "string" ? v : null);
/** Jak `as_u64` w serde: tylko nieujemne liczby całkowite, reszta = 0. */
const num = (v: unknown): number => (typeof v === "number" && Number.isInteger(v) && v >= 0 ? v : 0);

function parse(line: string): Json | null {
  try {
    return obj(JSON.parse(line));
  } catch {
    return null;
  }
}

const words = (text: string) => text.split(/\s+/).filter(Boolean).join(" ");
/** Pierwsze `n` znaków (punktów kodowych, jak `chars()` w Ruście). */
export const takeChars = (text: string, n: number) => Array.from(text).slice(0, n).join("");

/** Jedna linia, przycięta do `TITLE_CHARS`; pusta = brak. */
function oneLine(text: string): string | null {
  const line = takeChars(words(text), TITLE_CHARS);
  return line === "" ? null : line;
}

/** Id sesji to UUID; cokolwiek innego mogłoby wyjść poza katalog (`../x`). */
export function validId(id: string): boolean {
  return id !== "" && /^[0-9a-f-]+$/.test(id);
}

function readDir(dir: string): fs.Dirent[] {
  try {
    return fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
}

const isFile = (p: string) => fs.statSync(p, { throwIfNoEntry: false })?.isFile() ?? false;

/** claude: `<root>/<cwd>/<id>.jsonl`; pi: `<root>/<cwd>/<znacznik czasu>_<id>.jsonl`. */
export function findSession(root: string, kind: Kind, id: string): string | null {
  for (const dir of readDir(root)) {
    const d = path.join(root, dir.name);
    if (kind === "claude") {
      const file = path.join(d, `${id}.jsonl`);
      if (isFile(file)) return file;
    } else {
      const suffix = `_${id}.jsonl`;
      const hit = readDir(d).find((f) => f.name.endsWith(suffix));
      if (hit) return path.join(d, hit.name);
    }
  }
  return null;
}

/** Ostatnie `bytes` pliku, od początku pełnej linii. */
export function readLast(file: string, bytes: number): string | null {
  let fd: number;
  try {
    fd = fs.openSync(file, "r");
  } catch {
    return null;
  }
  try {
    const len = fs.fstatSync(fd).size;
    const start = Math.max(0, len - bytes);
    const buf = Buffer.alloc(len - start);
    let read = 0;
    while (read < buf.length) {
      const n = fs.readSync(fd, buf, read, buf.length - read, start + read);
      if (n === 0) break;
      read += n;
    }
    let text = buf.subarray(0, read).toString("utf8");
    if (start > 0) {
      // Odczyt zaczął się w środku linii: ten kawałek to nie JSON.
      const nl = text.indexOf("\n");
      text = nl < 0 ? "" : text.slice(nl + 1);
    }
    return text;
  } catch {
    return null;
  } finally {
    fs.closeSync(fd);
  }
}

const linesOf = (text: string) => text.split("\n").map((l) => (l.endsWith("\r") ? l.slice(0, -1) : l));

type Usage = { tokens: number; model: string | null; provider: string | null };

/** Najnowsza linia z `message.usage`, zsumowana w rozmiar kontekstu, który widział model. */
export function lastUsage(text: string, kind: Kind): Usage | null {
  const lines = linesOf(text);
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i];
    if (!line.includes('"usage"')) continue; // tanio: większość linii to wyniki narzędzi
    const entry = parse(line);
    // Tury podagentów claude mają własny, mniejszy kontekst.
    if (!entry || entry.isSidechain === true) continue;
    const message = obj(entry.message);
    const usage = obj(message?.usage);
    if (!message || !usage) continue;
    const tokens =
      kind === "claude"
        ? num(usage.input_tokens) + num(usage.cache_read_input_tokens) + num(usage.cache_creation_input_tokens)
        : num(usage.input) + num(usage.cacheRead) + num(usage.cacheWrite);
    // Przerwane albo syntetyczne tury mają zera; nic nie mówią o kontekście.
    if (tokens === 0) continue;
    return { tokens, model: str(message.model), provider: str(message.provider) };
  }
  return null;
}

/** claude: `message.content[]` `{"type":"tool_use","id","name","input":{file_path|command}}`;
 *  pi: `{"type":"toolCall","id","name","arguments":{path|command}}`. Najnowsze `MAX_TOOLS`, od najstarszego. */
export function lastTools(text: string, kind: Kind): ToolUse[] {
  const [marker, blockType, argsKey, fileKey] =
    kind === "claude" ? ['"tool_use"', "tool_use", "input", "file_path"] : ['"toolCall"', "toolCall", "arguments", "path"];
  const out: ToolUse[] = [];
  const lines = linesOf(text);
  lines: for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i];
    if (!line.includes(marker)) continue;
    const entry = parse(line);
    if (!entry || entry.isSidechain === true) continue;
    const blocks = obj(entry.message)?.content;
    if (!Array.isArray(blocks)) continue;
    for (let j = blocks.length - 1; j >= 0; j--) {
      const block = obj(blocks[j]);
      if (!block || block.type !== blockType) continue;
      const id = str(block.id);
      const name = str(block.name);
      if (id === null || name === null) continue;
      const args = obj(block[argsKey]) ?? {};
      const cmd = str(args.command);
      out.push({ id, name, file: str(args[fileKey]), command: cmd === null ? null : takeChars(words(cmd), COMMAND_CHARS) });
      if (out.length === MAX_TOOLS) break lines;
    }
  }
  return out.reverse();
}

/** claude co kilka tur dopisuje `{"type":"custom-title","customTitle"}` (`/rename`) i
 *  `{"type":"ai-title","aiTitle"}`, więc są w końcówce; własny tytuł wygrywa. */
export function claudeTitle(text: string): string | null {
  const lines = linesOf(text);
  const newest = (kind: string, key: string) => {
    const prefix = `{"type":"${kind}"`;
    for (let i = lines.length - 1; i >= 0; i--) {
      if (!lines[i].startsWith(prefix)) continue;
      const t = str(parse(lines[i])?.[key]);
      const line = t === null ? null : oneLine(t);
      if (line !== null) return line;
    }
    return null;
  };
  return newest("custom-title", "customTitle") ?? newest("ai-title", "aiTitle");
}

/** Części tytułu, które mogą leżeć MB przed końcem: pierwsze polecenie (claude i pi) i pi
 *  `{"type":"session_info","name"}` (raz na `/name`). Plik czytany cały, ale każdy bajt raz:
 *  `offset` = koniec ostatniej pełnej linii. */
export type TitleScan = { offset: number; name: string | null; firstPrompt: string | null };
export const newTitleScan = (): TitleScan => ({ offset: 0, name: null, firstPrompt: null });

/** Tekst wpisany przez użytkownika: string albo pierwszy blok tekstu. claude zapisuje też wyniki
 *  narzędzi, tury podagentów i wstrzyknięte notatki (`isMeta`, `<command-name>…`) jako tury użytkownika. */
function userPrompt(entry: Json, kind: Kind): string | null {
  if (entry.isSidechain === true || entry.isMeta === true) return null;
  const message = obj(entry.message);
  if (!message || message.role !== "user") return null;
  let text: string | null = null;
  if (typeof message.content === "string") text = message.content;
  else if (Array.isArray(message.content)) {
    const block = message.content.map(obj).find((b) => b?.type === "text");
    text = str(block?.text);
  }
  if (text === null) return null;
  if (kind === "claude" && text.trimStart().startsWith("<")) return null;
  return oneLine(text);
}

const NL = 0x0a;

export function titleScan(file: string, kind: Kind, state: TitleScan): void {
  let fd: number;
  try {
    fd = fs.openSync(file, "r");
  } catch {
    return;
  }
  try {
    const len = fs.fstatSync(fd).size;
    if (len < state.offset) Object.assign(state, newTitleScan()); // plik przepisany
    const chunk = Buffer.alloc(64 * 1024);
    let pending: Buffer[] = [];
    let pos = state.offset;
    for (;;) {
      const n = fs.readSync(fd, chunk, 0, chunk.length, pos);
      if (n === 0) return; // koniec, albo linia jeszcze zapisywana: poczeka na następny odczyt
      pos += n;
      let from = 0;
      for (let nl = chunk.indexOf(NL, from); nl !== -1 && nl < n; nl = chunk.indexOf(NL, from)) {
        pending.push(chunk.subarray(from, nl + 1));
        const lineBuf = Buffer.concat(pending);
        pending = [];
        from = nl + 1;
        state.offset += lineBuf.length;
        scanLine(lineBuf.toString("utf8"), kind, state);
      }
      if (from < n) pending.push(Buffer.from(chunk.subarray(from, n)));
    }
  } finally {
    fs.closeSync(fd);
  }
}

function scanLine(line: string, kind: Kind, state: TitleScan): void {
  if (kind === "pi" && line.includes('"session_info"')) {
    const entry = parse(line);
    // Pusta nazwa ją kasuje (wraca pierwsze polecenie).
    if (entry?.type === "session_info") state.name = str(entry.name) === null ? null : oneLine(entry.name as string);
  } else if (state.firstPrompt === null && line.includes('"role":"user"')) {
    const entry = parse(line);
    if (entry) state.firstPrompt = userPrompt(entry, kind);
  }
}

const scans = new Map<string, TitleScan>();

/** claude: `/rename` > tytuł AI (oba w końcówce) > pierwsze polecenie; pi: `/name` > pierwsze polecenie. */
export function sessionTitle(file: string, kind: Kind, tail: string): string | null {
  if (kind === "claude") {
    const title = claudeTitle(tail);
    if (title !== null) return title;
  }
  let state = scans.get(file);
  if (!state) scans.set(file, (state = newTitleScan()));
  titleScan(file, kind, state);
  return state.name ?? state.firstPrompt;
}

/** Znalezione ścieżki są pamiętane: pi wymaga przejrzenia katalogów, a UI pyta co 5 s. */
const found = new Map<string, string>();

export function contextIn(root: string, kind: Kind, id: string): (SessionContext & { provider: string | null }) | null {
  if (!validId(id)) return null;
  const key = path.join(root, id);
  let file = found.get(key);
  if (file === undefined || !isFile(file)) {
    const hit = findSession(root, kind, id);
    if (hit === null) return null;
    found.set(key, (file = hit));
  }
  const tail = readLast(file, TAIL_BYTES);
  if (tail === null) return null;
  const usage = lastUsage(tail, kind);
  if (usage === null) return null;
  return { ...usage, window: null, tools: lastTools(tail, kind), title: sessionTitle(file, kind, tail) };
}

/** `contextWindow` każdego modelu, który zna pi: własny `models.json` (`providers.<p>.models[]`)
 *  i pobrany katalog `models-store.json` (`<p>.models[]`). Klucz: `provider\0id`. */
export function piWindows(files: [string, boolean][]): Map<string, number> {
  const out = new Map<string, number>();
  for (const [file, nested] of files) {
    let root: Json | null;
    try {
      root = obj(JSON.parse(fs.readFileSync(file, "utf8")));
    } catch {
      continue;
    }
    const providers = obj(nested ? root?.providers : root);
    if (!providers) continue;
    for (const [provider, entry] of Object.entries(providers)) {
      const models = obj(entry)?.models;
      if (!Array.isArray(models)) continue;
      for (const m of models.map(obj)) {
        const id = str(m?.id);
        const window = m?.contextWindow;
        if (id === null || typeof window !== "number" || !Number.isInteger(window) || window < 0) continue;
        // Własny models.json jest pierwszy i wygrywa z katalogiem.
        const k = `${provider}\0${id}`;
        if (!out.has(k)) out.set(k, window);
      }
    }
  }
  return out;
}

let windowCache: { dir: string; stamps: (number | null)[]; windows: Map<string, number> } | null = null;

/** Okno modelu pi; dostawca zawęża dopasowanie, samo id to rezerwa. */
export function piWindow(agentDir: string, provider: string | null, model: string): number | null {
  const own = path.join(agentDir, "models.json");
  const store = path.join(agentDir, "models-store.json");
  // Parsowane raz na zmianę pliku: katalog ma ~0,5 MB, a UI pyta co 5 s.
  const stamps = [own, store].map((f) => fs.statSync(f, { throwIfNoEntry: false })?.mtimeMs ?? null);
  const fresh = windowCache?.dir === agentDir && windowCache.stamps.every((s, i) => s === stamps[i]);
  if (!fresh) windowCache = { dir: agentDir, stamps, windows: piWindows([[own, true], [store, false]]) };
  const windows = windowCache!.windows;
  if (provider !== null) {
    const w = windows.get(`${provider}\0${model}`);
    if (w !== undefined) return w;
  }
  for (const [k, w] of windows) if (k.slice(k.indexOf("\0") + 1) === model) return w;
  return null;
}

/** `null`, gdy rodzaj nieznany, pliku jeszcze nie ma albo żadna tura nie ma usage. */
export function sessionContext(kind: string, sessionId: string, home = os.homedir(), claudeDir?: string): SessionContext | null {
  if (kind === "claude") {
    const ctx = contextIn(path.join(claudeDir ? expand(claudeDir) : path.join(home, ".claude"), "projects"), "claude", sessionId);
    if (!ctx) return null;
    const { provider: _, ...rest } = ctx;
    return rest;
  }
  if (kind !== "pi") return null;
  const agentDir = path.join(home, ".pi", "agent");
  const ctx = contextIn(path.join(agentDir, "sessions"), "pi", sessionId);
  if (!ctx) return null;
  const { provider, ...rest } = ctx;
  if (rest.model !== null) rest.window = piWindow(agentDir, provider, rest.model);
  return rest;
}
