//! Zużycie z logów sesji programów CLI uruchamianych w panelach: Claude Code, Codex, pi.
//! Logi to zwykłe JSONL na dysku (`~/.claude/projects`, `~/.codex/sessions`, `~/.pi/agent/sessions`,
//! u kont ich własne foldery). Format nie jest kontraktem tych programów: parsery pomijają
//! to, czego nie rozumieją, i liczą pominięte linie.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import readline from "node:readline";
import type { AccountDef } from "../../src/accounts";
import { isInsidePath } from "./platform";
import { dayOf, mergeRows, NO_USAGE, normalizeModel, tokenCount, type Usage, type UsageRow } from "../../src/usage";
import { writeAtomic } from "./config";
import { expand } from "./env";

export type LogKind = "claude" | "codex" | "pi";

/** Parser jednego pliku: linie wchodzą po kolei, na końcu wiersze zsumowane do dni. */
export interface LogParser {
  feed(line: string): void;
  rows(): UsageRow[];
  /** Linie, które wyglądały na zużycie, ale nie dały się odczytać. */
  skipped: number;
}

const ts = (v: unknown): number | null => {
  if (typeof v !== "string") return null;
  const t = Date.parse(v);
  return Number.isNaN(t) ? null : t;
};

const row = (day: string, provider: string, model: string, account: string | undefined, project: string | undefined, u: Usage): UsageRow => ({
  day,
  source: "pane",
  provider,
  model: normalizeModel(model),
  ...(account ? { account } : {}),
  ...(project ? { project } : {}),
  ...u,
  n: 1,
});

type ClaudeLine = {
  type?: string;
  timestamp?: string;
  cwd?: string;
  uuid?: string;
  requestId?: string;
  message?: {
    id?: string;
    model?: string;
    usage?: {
      input_tokens?: number;
      output_tokens?: number;
      cache_read_input_tokens?: number;
      cache_creation_input_tokens?: number;
      output_tokens_details?: { thinking_tokens?: number };
    };
  };
};

/** Claude Code zapisuje każdy blok odpowiedzi jako osobną linię z tym samym `message.id`
 *  i `requestId`, a `output_tokens` rośnie: liczy się jedno zużycie na parę, największe z pól. */
export class ClaudeLog implements LogParser {
  skipped = 0;
  private calls = new Map<string, { at: number; model: string; project?: string; u: Usage }>();

  constructor(private account?: string) {}

  feed(line: string): void {
    if (!line.includes('"usage"')) return;
    let d: ClaudeLine;
    try {
      d = JSON.parse(line) as ClaudeLine;
    } catch {
      this.skipped++;
      return;
    }
    const m = d.message;
    if (d.type !== "assistant" || !m?.usage) return;
    const model = m.model ?? "";
    if (model === "" || model.startsWith("<")) return; // <synthetic>: komunikaty programu, bez zużycia
    const at = ts(d.timestamp);
    if (at === null) {
      this.skipped++;
      return;
    }
    const k = m.usage;
    const u: Usage = {
      input: tokenCount(k.input_tokens),
      output: tokenCount(k.output_tokens),
      cacheRead: tokenCount(k.cache_read_input_tokens),
      cacheWrite: tokenCount(k.cache_creation_input_tokens),
      reasoning: tokenCount(k.output_tokens_details?.thinking_tokens),
    };
    const key = m.id || d.requestId ? `${m.id ?? ""}\u0000${d.requestId ?? ""}` : (d.uuid ?? line.length.toString());
    const prev = this.calls.get(key);
    if (!prev) {
      this.calls.set(key, { at, model, project: d.cwd, u });
      return;
    }
    prev.u = {
      input: Math.max(prev.u.input, u.input),
      output: Math.max(prev.u.output, u.output),
      cacheRead: Math.max(prev.u.cacheRead, u.cacheRead),
      cacheWrite: Math.max(prev.u.cacheWrite, u.cacheWrite),
      reasoning: Math.max(prev.u.reasoning, u.reasoning),
    };
  }

  rows(): UsageRow[] {
    return mergeRows([...this.calls.values()].map((c) => row(dayOf(c.at), "claude", c.model, this.account, c.project, c.u)));
  }
}

type CodexTotals = { input_tokens?: number; cached_input_tokens?: number; cache_write_input_tokens?: number; output_tokens?: number; reasoning_output_tokens?: number };
type CodexLine = {
  type?: string;
  timestamp?: string;
  payload?: { type?: string; cwd?: string; model?: string; info?: { total_token_usage?: CodexTotals; last_token_usage?: CodexTotals } | null };
};

/** Codex: model z ostatniego `turn_context`, zużycie jako przyrost `total_token_usage`
 *  (powtórzone zdarzenie z tą samą sumą nie liczy się drugi raz). `input_tokens` obejmuje cache. */
export class CodexLog implements LogParser {
  skipped = 0;
  private out: UsageRow[] = [];
  private cwd?: string;
  private model = "";
  private prev: Usage & { total: number } = { ...NO_USAGE, total: 0 };

  constructor(private account?: string) {}

  feed(line: string): void {
    if (!line.includes('"session_meta"') && !line.includes('"turn_context"') && !line.includes('"token_count"')) return;
    let d: CodexLine;
    try {
      d = JSON.parse(line) as CodexLine;
    } catch {
      this.skipped++;
      return;
    }
    const p = d.payload;
    if (!p) return;
    if (d.type === "session_meta" || d.type === "turn_context") {
      if (p.cwd) this.cwd = p.cwd;
      if (d.type === "turn_context" && p.model) this.model = p.model;
      return;
    }
    if (d.type !== "event_msg" || p.type !== "token_count" || !p.info) return;
    const at = ts(d.timestamp);
    const t = p.info.total_token_usage;
    if (at === null || !t) {
      if (at === null) this.skipped++;
      return;
    }
    const cached = tokenCount(t.cached_input_tokens);
    const write = tokenCount(t.cache_write_input_tokens);
    const cur = {
      input: Math.max(0, tokenCount(t.input_tokens) - cached - write),
      output: tokenCount(t.output_tokens),
      cacheRead: cached,
      cacheWrite: write,
      reasoning: tokenCount(t.reasoning_output_tokens),
    };
    const total = cur.input + cur.output + cur.cacheRead + cur.cacheWrite;
    if (total === this.prev.total) return;
    // Suma spadła (nowa sesja w tym samym pliku): przyrost to cała wartość.
    const reset = total < this.prev.total;
    const delta: Usage = {
      input: reset ? cur.input : Math.max(0, cur.input - this.prev.input),
      output: reset ? cur.output : Math.max(0, cur.output - this.prev.output),
      cacheRead: reset ? cur.cacheRead : Math.max(0, cur.cacheRead - this.prev.cacheRead),
      cacheWrite: reset ? cur.cacheWrite : Math.max(0, cur.cacheWrite - this.prev.cacheWrite),
      reasoning: reset ? cur.reasoning : Math.max(0, cur.reasoning - this.prev.reasoning),
    };
    this.prev = { ...cur, total };
    this.out.push(row(dayOf(at), "codex", this.model || "codex", this.account, this.cwd, delta));
  }

  rows(): UsageRow[] {
    return mergeRows(this.out);
  }
}

type PiLine = {
  type?: string;
  timestamp?: string;
  cwd?: string;
  message?: { role?: string; model?: string; usage?: { input?: number; output?: number; cacheRead?: number; cacheWrite?: number; reasoning?: number } };
};

/** pi: `session` niesie cwd, każda odpowiedź asystenta własne `usage` i model. */
export class PiLog implements LogParser {
  skipped = 0;
  private out: UsageRow[] = [];
  private cwd?: string;

  feed(line: string): void {
    if (!line.includes('"session"') && !line.includes('"usage"')) return;
    let d: PiLine;
    try {
      d = JSON.parse(line) as PiLine;
    } catch {
      this.skipped++;
      return;
    }
    if (d.type === "session") {
      if (d.cwd) this.cwd = d.cwd;
      return;
    }
    const m = d.message;
    if (d.type !== "message" || m?.role !== "assistant" || !m.usage) return;
    const at = ts(d.timestamp);
    if (at === null) {
      this.skipped++;
      return;
    }
    const u: Usage = {
      input: tokenCount(m.usage.input),
      output: tokenCount(m.usage.output),
      cacheRead: tokenCount(m.usage.cacheRead),
      cacheWrite: tokenCount(m.usage.cacheWrite),
      reasoning: tokenCount(m.usage.reasoning),
    };
    this.out.push(row(dayOf(at), "pi", m.model ?? "pi", undefined, this.cwd, u));
  }

  rows(): UsageRow[] {
    return mergeRows(this.out);
  }
}

export function newParser(kind: LogKind, account?: string): LogParser {
  return kind === "claude" ? new ClaudeLog(account) : kind === "codex" ? new CodexLog(account) : new PiLog();
}

/** Wiersze z całego tekstu logu (testy i małe pliki). */
export function parseLogText(kind: LogKind, text: string, account?: string): UsageRow[] {
  const p = newParser(kind, account);
  for (const line of text.split("\n")) if (line) p.feed(line);
  return p.rows();
}

async function parseFile(kind: LogKind, file: string, account?: string): Promise<{ rows: UsageRow[]; skipped: number }> {
  const p = newParser(kind, account);
  const rl = readline.createInterface({ input: fs.createReadStream(file, { encoding: "utf8" }), crlfDelay: Infinity });
  for await (const line of rl) if (line) p.feed(line);
  return { rows: p.rows(), skipped: p.skipped };
}

export type LogRoot = { kind: LogKind; dir: string; account?: string };

/** Foldery z logami: domyślne programy i konta z `accounts.json`. */
export function logRoots(accounts: AccountDef[], home = os.homedir()): LogRoot[] {
  const roots: LogRoot[] = [
    { kind: "claude", dir: path.join(home, ".claude", "projects") },
    { kind: "codex", dir: path.join(home, ".codex", "sessions") },
    { kind: "codex", dir: path.join(home, ".codex", "archived_sessions") },
    { kind: "pi", dir: path.join(home, ".pi", "agent", "sessions") },
  ];
  for (const a of accounts) {
    const dir = expand(a.dir);
    if (!dir) continue;
    if (a.kind === "claude") roots.push({ kind: "claude", dir: path.join(dir, "projects"), account: a.id });
    else {
      roots.push({ kind: "codex", dir: path.join(dir, "sessions"), account: a.id });
      roots.push({ kind: "codex", dir: path.join(dir, "archived_sessions"), account: a.id });
    }
  }
  // Konto wskazujące domyślny folder nie może policzyć go drugi raz.
  const seen = new Set<string>();
  return roots.filter((r) => {
    const key = path.resolve(r.dir);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function jsonlFiles(dir: string): string[] {
  const out: string[] = [];
  const walk = (d: string) => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(d, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.isFile() && e.name.endsWith(".jsonl")) out.push(p);
    }
  };
  walk(dir);
  return out;
}

type Entry = { mtime: number; size: number; kind: LogKind; rows: UsageRow[] };
type Index = { version: 1; files: Record<string, Entry> };
const INDEX_FILE = "usage-index.json";
const INDEX_VERSION = 1;

export type ScanResult = { rows: UsageRow[]; files: number; parsed: number; skipped: number };

/** Skanuje logi i pamięta wynik per plik (`usage-index.json`): przy kolejnym skanie czytane są tylko
 *  pliki, które się zmieniły. Wpisy zniklych plików zostają: programy czyszczą stare sesje,
 *  a statystyki mają je pamiętać. */
export class UsageScanner {
  private index: Index | null = null;
  private running: Promise<ScanResult> | null = null;

  constructor(
    private configDir: string,
    private roots: () => LogRoot[],
    /** Logi z tych katalogów robocza (Czat i Boty przez CLI) liczy dziennik, nie skaner. */
    private exclude: string[] = [],
  ) {}

  private load(): Index {
    if (this.index) return this.index;
    try {
      const j = JSON.parse(fs.readFileSync(path.join(this.configDir, INDEX_FILE), "utf8")) as Index;
      if (j.version === INDEX_VERSION && j.files) return (this.index = j);
    } catch {
      // brak albo zepsuty indeks: skan od zera
    }
    return (this.index = { version: INDEX_VERSION, files: {} });
  }

  /** Wiersze z indeksu, bez logów z katalogów wykluczonych. */
  rows(): UsageRow[] {
    const all = Object.values(this.load().files).flatMap((e) => e.rows);
    return all.filter((r) => !r.project || !this.exclude.some((d) => isInsidePath(r.project!, d)));
  }

  scan(): Promise<ScanResult> {
    return (this.running ??= this.run().finally(() => (this.running = null)));
  }

  private async run(): Promise<ScanResult> {
    const index = this.load();
    let files = 0;
    let parsed = 0;
    let skipped = 0;
    let dirty = false;
    for (const root of this.roots()) {
      for (const file of jsonlFiles(root.dir)) {
        files++;
        let st: fs.Stats;
        try {
          st = fs.statSync(file);
        } catch {
          continue;
        }
        const prev = index.files[file];
        if (prev && prev.mtime === st.mtimeMs && prev.size === st.size) continue;
        try {
          const r = await parseFile(root.kind, file, root.account);
          index.files[file] = { mtime: st.mtimeMs, size: st.size, kind: root.kind, rows: r.rows };
          skipped += r.skipped;
          parsed++;
          dirty = true;
        } catch (e) {
          console.error(`usage: ${file}: ${String(e)}`);
        }
      }
    }
    // Wpisy skasowanych plików znikają ze statystyk; "niewidziany" nie wystarcza (chwilowo niedostępny katalog logów).
    for (const file of Object.keys(index.files)) {
      if (!fs.existsSync(file)) {
        delete index.files[file];
        dirty = true;
      }
    }
    if (dirty) {
      try {
        fs.mkdirSync(this.configDir, { recursive: true });
        writeAtomic(path.join(this.configDir, INDEX_FILE), JSON.stringify(index));
      } catch (e) {
        console.error(`usage: indeks: ${String(e)}`);
      }
    }
    return { rows: this.rows(), files, parsed, skipped };
  }
}

/** Katalogi robocze Czatu i Botów (nowe i sprzed zmiany nazwy): ich logi sesji liczy dziennik, nie skaner. */
export function chatLogExcludes(dir: string, legacy: string): string[] {
  return [dir, legacy].flatMap((d) => [path.join(d, "chat-cwd"), path.join(d, "bots")]);
}
