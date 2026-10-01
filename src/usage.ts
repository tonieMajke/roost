/** Statystyki zużycia tokenów: typy wspólne z procesem głównym i czyste funkcje agregacji.
 *  Konwencja: `input` to tokeny wejścia BEZ cache (cache osobno), `output` zawiera rozumowanie
 *  (`reasoning` jest tylko jego wyróżnioną częścią, nie dodaje się do sumy). */

import { locale, t } from "./i18n";

export type Usage = {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  reasoning: number;
};

export const NO_USAGE: Usage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, reasoning: 0 };

/** Skąd pochodzi zużycie: Czat, Bot albo panel terminalowy (log sesji programu CLI). */
export type UsageSource = "chat" | "bot" | "pane";

/** Dzień + wymiary; wiersze z tego samego klucza są sumowane (`n` = liczba wywołań). */
export type UsageRow = Usage & {
  day: string; // YYYY-MM-DD, czas lokalny
  source: UsageSource;
  provider: string; // id dostawcy czatu albo rodzaj programu: claude-cli / codex-cli / pi
  model: string; // znormalizowane id
  account?: string; // id konta (accounts.json), brak = domyślne
  project?: string; // katalog roboczy panelu (cwd)
  costUsd?: number; // tylko gdy źródło je podało
  n: number;
};

export function addUsage(a: Usage, b: Partial<Usage>): Usage {
  return {
    input: a.input + (b.input ?? 0),
    output: a.output + (b.output ?? 0),
    cacheRead: a.cacheRead + (b.cacheRead ?? 0),
    cacheWrite: a.cacheWrite + (b.cacheWrite ?? 0),
    reasoning: a.reasoning + (b.reasoning ?? 0),
  };
}

/** Wszystkie tokeny przetworzone przez model (wejście, cache, wyjście). */
export const totalTokens = (u: Usage): number => u.input + u.output + u.cacheRead + u.cacheWrite;

export const isEmptyUsage = (u: Usage): boolean => totalTokens(u) === 0;

const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) && v > 0 ? Math.round(v) : 0);

/** Liczba z nieznanego JSON-a; cokolwiek innego niż skończona liczba dodatnia = 0. */
export const tokenCount = num;

/** Dzień lokalny `YYYY-MM-DD` z czasu w ms. */
export function dayOf(ts: number): string {
  const d = new Date(ts);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** Przesunięcie dnia o `n` dni (bez problemów ze zmianą czasu: liczone w południe). */
export function shiftDay(day: string, n: number): string {
  const [y, m, d] = day.split("-").map(Number);
  return dayOf(new Date(y, m - 1, d + n, 12).getTime());
}

/** Odpowiedź procesu głównego: wiersze z dziennika (Czat, Boty) i z logów paneli.
 *  `scan` jest ustawione tylko po skanowaniu logów (`rescan`). */
export type UsageStats = {
  rows: UsageRow[];
  scan?: { files: number; parsed: number; skipped: number };
  at: number;
};

export type Range = "7d" | "30d" | "90d" | "all";

export const RANGES: Range[] = ["7d", "30d", "90d", "all"];

/** Najstarszy dzień zakresu (włącznie) przy dzisiejszym `today`; `null` = bez ograniczenia. */
export function rangeStart(range: Range, today: string): string | null {
  if (range === "all") return null;
  return shiftDay(today, -(Number.parseInt(range, 10) - 1));
}

export type Filter = {
  range: Range;
  source?: UsageSource;
  provider?: string;
  model?: string;
  account?: string;
  project?: string;
};

export function filterRows(rows: UsageRow[], f: Filter, today: string): UsageRow[] {
  const from = rangeStart(f.range, today);
  return rows.filter(
    (r) =>
      (from === null || r.day >= from) &&
      (!f.source || r.source === f.source) &&
      (!f.provider || r.provider === f.provider) &&
      (!f.model || r.model === f.model) &&
      (f.account === undefined || (r.account ?? "") === f.account) &&
      (f.project === undefined || (r.project ?? "") === f.project),
  );
}

export type Dim = "model" | "project" | "provider" | "account" | "source";

export type Group = { key: string; usage: Usage; total: number; n: number; costUsd: number; share: number };

const keyOf = (r: UsageRow, dim: Dim): string => (dim === "project" || dim === "account" ? (r[dim] ?? "") : r[dim]);

/** Grupowanie po wymiarze, od największego zużycia; `share` to udział w sumie (0–1). */
export function groupBy(rows: UsageRow[], dim: Dim): Group[] {
  const map = new Map<string, Group>();
  let sum = 0;
  for (const r of rows) {
    const key = keyOf(r, dim);
    const g = map.get(key) ?? { key, usage: { ...NO_USAGE }, total: 0, n: 0, costUsd: 0, share: 0 };
    g.usage = addUsage(g.usage, r);
    g.total = totalTokens(g.usage);
    g.n += r.n;
    g.costUsd += r.costUsd ?? 0;
    map.set(key, g);
    sum += totalTokens(r);
  }
  const out = [...map.values()].sort((a, b) => b.total - a.total || a.key.localeCompare(b.key));
  for (const g of out) g.share = sum > 0 ? g.total / sum : 0;
  return out;
}

export type DayPoint = { day: string; usage: Usage; total: number };

/** Szereg dzienny od `from` do `to` włącznie, z zerami w dniach bez ruchu. */
export function dailySeries(rows: UsageRow[], from: string, to: string): DayPoint[] {
  const by = new Map<string, Usage>();
  for (const r of rows) by.set(r.day, addUsage(by.get(r.day) ?? NO_USAGE, r));
  const out: DayPoint[] = [];
  for (let d = from, i = 0; d <= to && i < 4000; d = shiftDay(d, 1), i++) {
    const usage = by.get(d) ?? NO_USAGE;
    out.push({ day: d, usage, total: totalTokens(usage) });
  }
  return out;
}

export type Summary = {
  usage: Usage;
  total: number;
  n: number;
  costUsd: number;
  days: number; // dni z jakimkolwiek ruchem
  topModel: string | null; // wg tokenów
  topModelByCalls: string | null;
};

export function summarize(rows: UsageRow[]): Summary {
  let usage = { ...NO_USAGE };
  let n = 0;
  let costUsd = 0;
  const days = new Set<string>();
  for (const r of rows) {
    usage = addUsage(usage, r);
    n += r.n;
    costUsd += r.costUsd ?? 0;
    if (totalTokens(r) > 0) days.add(r.day);
  }
  const models = groupBy(rows, "model");
  const byCalls = [...models].sort((a, b) => b.n - a.n || a.key.localeCompare(b.key));
  return {
    usage,
    total: totalTokens(usage),
    n,
    costUsd,
    days: days.size,
    topModel: models[0]?.key ?? null,
    topModelByCalls: byCalls[0]?.key ?? null,
  };
}

const KEY_SEP = "\u0000";

/** Sumuje wiersze o tym samym kluczu (dzień i wymiary). */
export function mergeRows(rows: UsageRow[]): UsageRow[] {
  const map = new Map<string, UsageRow>();
  for (const r of rows) {
    const key = [r.day, r.source, r.provider, r.model, r.account ?? "", r.project ?? ""].join(KEY_SEP);
    const prev = map.get(key);
    if (!prev) {
      map.set(key, { ...r });
      continue;
    }
    Object.assign(prev, addUsage(prev, r));
    prev.n += r.n;
    if (r.costUsd !== undefined) prev.costUsd = (prev.costUsd ?? 0) + r.costUsd;
  }
  return [...map.values()];
}

/** Aliasy z logów i `chat.json` → jedno id modelu, żeby „haiku” i pełne id nie były dwiema pozycjami. */
export function normalizeModel(model: string): string {
  const m = model.trim();
  if (m === "haiku") return "claude-haiku-4-5"; // alias z `chat.json`
  return m.replace(/-\d{8}$/, "").replace(/\[1m\]$/, "");
}

/** Krótkie liczby do kafelków: po polsku 1 234 → „1,2 tys.”, 3 400 000 → „3,4 mln”; po angielsku „1.2K”, „3.4M”. */
export function compact(n: number, loc = locale()): string {
  const fmt = (v: number) => v.toLocaleString(loc, { maximumFractionDigits: v >= 100 ? 0 : 1 });
  if (n >= 1e9) return `${fmt(n / 1e9)}${t("stats.unit.billion")}`;
  if (n >= 1e6) return `${fmt(n / 1e6)}${t("stats.unit.million")}`;
  if (n >= 1e3) return `${fmt(n / 1e3)}${t("stats.unit.thousand")}`;
  return String(Math.round(n));
}

/** Nazwa projektu z workspace dla katalogu roboczego panelu: najdłuższa pasująca ścieżka
 *  (podkatalog projektu należy do projektu), inaczej dwa ostatnie człony ścieżki. `""` = brak projektu. */
export function projectLabel(cwd: string, projects: { name: string; path: string }[]): string {
  if (cwd === "") return "";
  const hit = projects
    .filter((p) => p.path !== "" && (cwd === p.path || cwd.startsWith(`${p.path.replace(/\/+$/, "")}/`)))
    .sort((a, b) => b.path.length - a.path.length)[0];
  if (hit) return hit.name;
  return cwd.split("/").filter(Boolean).slice(-2).join("/") || cwd;
}

/** Wiersze z katalogiem roboczym zamienionym na projekt z workspace: katalogi jednego projektu
 *  (np. podkatalogi) sumują się w jedną pozycję. */
export function withProjectNames(rows: UsageRow[], projects: { name: string; path: string }[]): UsageRow[] {
  return mergeRows(rows.map((r) => (r.project === undefined ? r : { ...r, project: projectLabel(r.project, projects) || undefined })));
}
