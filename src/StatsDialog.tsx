import { useEffect, useMemo, useState } from "react";
import { RefreshCw } from "lucide-react";
import type { AccountDef } from "./accounts";
import { Dialog } from "./Dialog";
import {
  RANGES,
  compact,
  dailySeries,
  dayOf,
  filterRows,
  groupBy,
  shiftDay,
  summarize,
  totalTokens,
  withProjectNames,
  type DayPoint,
  type Dim,
  type Filter,
  type Group,
  type Range,
  type UsageSource,
  type UsageStats,
} from "./usage";

type Props = {
  /** Bez `rescan` od razu to, co już policzone; z `rescan` doczytuje nowe logi (może potrwać). */
  load(rescan: boolean): Promise<UsageStats>;
  /** Projekty z workspace: katalog roboczy panelu → nazwa projektu. */
  projects: { name: string; path: string }[];
  accounts: AccountDef[];
  onClose(): void;
};

const RANGE_LABEL: Record<Range, string> = { "7d": "7 dni", "30d": "30 dni", "90d": "90 dni", all: "Wszystko" };
const SOURCE_LABEL: Record<UsageSource, string> = { pane: "Panele (Code)", chat: "Czat", bot: "Boty" };
const DIMS: { dim: Dim; label: string }[] = [
  { dim: "model", label: "Modele" },
  { dim: "project", label: "Projekty" },
  { dim: "provider", label: "Dostawcy" },
  { dim: "account", label: "Konta" },
  { dim: "source", label: "Źródła" },
];
const CHART_DAYS = 90;

/** Pełna liczba z odstępami (podpowiedź na skróconej wartości). */
const full = (n: number) => n.toLocaleString("pl-PL");

const pct = (share: number) => (share > 0 && share < 0.001 ? "<0,1%" : `${(share * 100).toLocaleString("pl-PL", { maximumFractionDigits: 1 })}%`);

const dayShort = (day: string) => `${day.slice(8, 10)}.${day.slice(5, 7)}`;

function groupLabel(dim: Dim, key: string, accounts: AccountDef[]): string {
  if (dim === "project") return key === "" ? "Czat i Boty (bez projektu)" : key;
  if (dim === "account") return key === "" ? "Domyślne konto" : (accounts.find((a) => a.id === key)?.name ?? key);
  if (dim === "source") return SOURCE_LABEL[key as UsageSource] ?? key;
  return key || "?";
}

/** Okno „Statystyki”: zużycie tokenów z Czatu, Botów i paneli terminalowych. */
export function StatsDialog({ load, projects, accounts, onClose }: Props) {
  const [stats, setStats] = useState<UsageStats | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>({ range: "30d" });
  const [dim, setDim] = useState<Dim>("model");
  const [hover, setHover] = useState<DayPoint | null>(null);

  const refresh = (cancelled: () => boolean = () => false) => {
    setBusy(true);
    setError(null);
    // Najpierw to, co już policzone (od razu), potem skan nowych logów.
    load(false)
      .then((s) => !cancelled() && setStats((prev) => prev ?? s))
      .catch(() => {})
      .then(() => load(true))
      .then((s) => !cancelled() && setStats(s))
      .catch((e) => !cancelled() && setError(String(e)))
      .finally(() => !cancelled() && setBusy(false));
  };

  useEffect(() => {
    let dead = false;
    refresh(() => dead);
    return () => {
      dead = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- tylko przy otwarciu okna
  }, []);

  const today = dayOf(stats?.at ?? Date.now());
  const rows = useMemo(() => (stats ? withProjectNames(stats.rows, projects) : []), [stats, projects]);
  const shown = useMemo(() => filterRows(rows, filter, today), [rows, filter, today]);
  const sum = useMemo(() => summarize(shown), [shown]);
  const groups = useMemo(() => groupBy(shown, dim), [shown, dim]);
  const series = useMemo(() => {
    const first = shown.reduce((m, r) => (r.day < m ? r.day : m), today);
    const days = filter.range === "all" ? CHART_DAYS : Number.parseInt(filter.range, 10);
    // „Wszystko” bez ruchu sprzed 90 dni nie ma po co rozciągać wykresu.
    const from = shiftDay(today, -(days - 1));
    return dailySeries(shown, filter.range === "all" && first > from ? first : from, today);
  }, [shown, filter.range, today]);

  const u = sum.usage;
  const fresh = u.input + u.output;
  const cache = u.cacheRead + u.cacheWrite;

  return (
    <Dialog label="Statystyki" className="is-stats" onClose={onClose}>
      {() => (
        <>
          <div className="stats-head">
            <h2>Statystyki</h2>
            <button type="button" className="btn" disabled={busy} onClick={() => refresh()} title="Doczytaj nowe logi sesji">
              <RefreshCw strokeWidth={1.75} aria-hidden /> {busy ? "Czytam logi…" : "Odśwież"}
            </button>
          </div>
          <p>Zużycie tokenów z Czatu, Botów i paneli (logi sesji Claude Code, Codex i pi).</p>
          {error && <p className="stats-err" role="alert">Nie udało się wczytać statystyk: {error}</p>}

          <div className="stats-filters">
            <div className="seg" role="group" aria-label="Zakres czasu">
              {RANGES.map((r) => (
                <button key={r} type="button" className={filter.range === r ? "is-on" : ""} aria-pressed={filter.range === r} onClick={() => setFilter({ ...filter, range: r })}>
                  {RANGE_LABEL[r]}
                </button>
              ))}
            </div>
            <select className="pm-input stats-source" aria-label="Źródło" value={filter.source ?? ""} onChange={(e) => setFilter({ ...filter, source: (e.target.value || undefined) as UsageSource | undefined })}>
              <option value="">Wszystkie źródła</option>
              {(Object.keys(SOURCE_LABEL) as UsageSource[]).map((s) => (
                <option key={s} value={s}>{SOURCE_LABEL[s]}</option>
              ))}
            </select>
          </div>

          {stats === null && !error && <p className="stats-empty">Czytam logi sesji… pierwszy raz potrwa chwilę.</p>}
          {stats !== null && shown.length === 0 && <p className="stats-empty">Brak zużycia w tym zakresie.</p>}

          {shown.length > 0 && (
            <>
              <div className="stats-tiles">
                <Tile label="Tokeny łącznie" value={compact(sum.total)} title={full(sum.total)} note={`${sum.days} dni z ruchem`} />
                <Tile label="Świeże (wejście + wyjście)" value={compact(fresh)} title={full(fresh)} note={`wyjście ${compact(u.output)}`} />
                <Tile label="Cache (odczyt + zapis)" value={compact(cache)} title={full(cache)} note={sum.total > 0 ? `${pct(cache / sum.total)} całości` : undefined} />
                <Tile label="Najczęstszy model" value={sum.topModel ?? "—"} small note={`${full(sum.n)} wywołań`} />
                {sum.costUsd > 0 && (
                  <Tile label="Wartość wg cennika API" value={`$${sum.costUsd.toLocaleString("pl-PL", { maximumFractionDigits: 2 })}`} note="tylko Czat i Boty, bez paneli" />
                )}
              </div>

              <Breakdown input={u.input} output={u.output} cacheRead={u.cacheRead} cacheWrite={u.cacheWrite} />

              <Chart series={series} hover={hover} onHover={setHover} capped={filter.range === "all"} />

              <div className="seg stats-dims" role="group" aria-label="Podział">
                {DIMS.map((d) => (
                  <button key={d.dim} type="button" className={dim === d.dim ? "is-on" : ""} aria-pressed={dim === d.dim} onClick={() => setDim(d.dim)}>
                    {d.label}
                  </button>
                ))}
              </div>
              <GroupTable groups={groups} dim={dim} accounts={accounts} />

              <details className="stats-days">
                <summary>Dane dzienne</summary>
                <table className="stats-table">
                  <thead>
                    <tr><th scope="col">Dzień</th><th scope="col" className="num">Świeże</th><th scope="col" className="num">Cache</th><th scope="col" className="num">Razem</th></tr>
                  </thead>
                  <tbody>
                    {[...series].reverse().filter((p) => p.total > 0).map((p) => (
                      <tr key={p.day}>
                        <th scope="row">{p.day}</th>
                        <td className="num">{compact(p.usage.input + p.usage.output)}</td>
                        <td className="num">{compact(p.usage.cacheRead + p.usage.cacheWrite)}</td>
                        <td className="num">{compact(p.total)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </details>
            </>
          )}

          <p className="set-foot">
            {stats?.scan
              ? `Przejrzano ${full(stats.scan.files)} plików logów${stats.scan.parsed > 0 ? `, nowych lub zmienionych: ${full(stats.scan.parsed)}` : ""}${stats.scan.skipped > 0 ? `, pominięto nieczytelnych linii: ${full(stats.scan.skipped)}` : ""}. `
              : ""}
            Koszt widać tylko tam, gdzie program go podał; subskrypcje nie mają rachunku za tokeny. Dane z logów zostają w statystykach po ich usunięciu przez program.
          </p>
        </>
      )}
    </Dialog>
  );
}

function Tile({ label, value, note, title, small }: { label: string; value: string; note?: string; title?: string; small?: boolean }) {
  return (
    <div className="stats-tile">
      <span className="stats-tile-label">{label}</span>
      <strong className={small ? "stats-tile-value is-small" : "stats-tile-value"} title={title ?? value}>{value}</strong>
      {note && <span className="stats-tile-note">{note}</span>}
    </div>
  );
}

const PARTS = [
  { key: "input", label: "Wejście", cls: "p-input" },
  { key: "output", label: "Wyjście", cls: "p-output" },
  { key: "cacheRead", label: "Cache: odczyt", cls: "p-cread" },
  { key: "cacheWrite", label: "Cache: zapis", cls: "p-cwrite" },
] as const;

/** Jeden pasek z podziałem na rodzaje tokenów; legenda z liczbami (kolor nie jest jedynym nośnikiem). */
function Breakdown(u: { input: number; output: number; cacheRead: number; cacheWrite: number }) {
  const total = totalTokens({ ...u, reasoning: 0 });
  if (total === 0) return null;
  return (
    <div className="stats-break">
      <div className="stats-break-bar" role="img" aria-label={PARTS.map((p) => `${p.label} ${pct(u[p.key] / total)}`).join(", ")}>
        {PARTS.filter((p) => u[p.key] > 0).map((p) => (
          <span key={p.key} className={p.cls} style={{ flexGrow: u[p.key] }} />
        ))}
      </div>
      <ul className="stats-legend">
        {PARTS.map((p) => (
          <li key={p.key}>
            <i className={p.cls} aria-hidden /> {p.label} <b title={full(u[p.key])}>{compact(u[p.key])}</b> <span>{pct(u[p.key] / total)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

const W = 640;
const H = 132;
const PAD_L = 4;
const GAP = 2; // odstęp między słupkami i segmentami w kolorze tła karty

function Chart({ series, hover, onHover, capped }: { series: DayPoint[]; hover: DayPoint | null; onHover(p: DayPoint | null): void; capped: boolean }) {
  const max = Math.max(1, ...series.map((p) => p.total));
  const slot = (W - PAD_L) / Math.max(1, series.length);
  const bw = Math.max(1, slot - GAP);
  const y = (v: number) => (v / max) * (H - 4);
  const sel = hover ?? null;
  return (
    <figure className="stats-chart">
      <figcaption>
        <span>Tokeny dziennie{capped && series.length >= CHART_DAYS ? " (ostatnie 90 dni)" : ""}</span>
        <span className="stats-readout" aria-live="polite">
          {sel
            ? `${sel.day}: ${compact(sel.total)} (świeże ${compact(sel.usage.input + sel.usage.output)}, cache ${compact(sel.usage.cacheRead + sel.usage.cacheWrite)})`
            : `szczyt ${compact(max === 1 ? 0 : max)}`}
        </span>
      </figcaption>
      <svg viewBox={`0 0 ${W} ${H + 16}`} role="img" aria-label="Wykres słupkowy zużycia tokenów w dniach; dokładne wartości w tabeli „Dane dzienne”" onMouseLeave={() => onHover(null)}>
        <line className="stats-axis" x1={0} x2={W} y1={H} y2={H} />
        {series.map((p, i) => {
          const x = PAD_L + i * slot;
          const cache = p.usage.cacheRead + p.usage.cacheWrite;
          const fresh = p.usage.input + p.usage.output;
          const hc = y(cache);
          const hf = y(fresh);
          return (
            <g key={p.day} className={sel?.day === p.day ? "is-hover" : ""}>
              {cache > 0 && <rect className="bar-cache" x={x} y={H - hc} width={bw} height={hc} rx={Math.min(2, bw / 2)} />}
              {fresh > 0 && <rect className="bar-fresh" x={x} y={H - hc - hf - (cache > 0 ? GAP : 0)} width={bw} height={hf} rx={Math.min(2, bw / 2)} />}
              <rect className="bar-hit" x={x - GAP / 2} y={0} width={slot} height={H} onMouseEnter={() => onHover(p)} />
            </g>
          );
        })}
        {series.length > 0 && (
          <>
            <text className="stats-tick" x={PAD_L} y={H + 12}>{dayShort(series[0].day)}</text>
            <text className="stats-tick" x={W} y={H + 12} textAnchor="end">{dayShort(series[series.length - 1].day)}</text>
          </>
        )}
      </svg>
      <ul className="stats-legend">
        <li><i className="bar-fresh-key" aria-hidden /> Świeże (wejście + wyjście)</li>
        <li><i className="bar-cache-key" aria-hidden /> Cache</li>
      </ul>
    </figure>
  );
}

function GroupTable({ groups, dim, accounts }: { groups: Group[]; dim: Dim; accounts: AccountDef[] }) {
  const head = DIMS.find((d) => d.dim === dim)!.label;
  const top = groups.slice(0, 12);
  const rest = groups.slice(12);
  const other = rest.reduce((s, g) => ({ total: s.total + g.total, n: s.n + g.n, share: s.share + g.share }), { total: 0, n: 0, share: 0 });
  return (
    <table className="stats-table">
      <thead>
        <tr><th scope="col">{head}</th><th scope="col" className="num">Tokeny</th><th scope="col" className="num">Udział</th><th scope="col" className="num">Wywołań</th></tr>
      </thead>
      <tbody>
        {top.map((g) => (
          <tr key={g.key}>
            <th scope="row" title={groupLabel(dim, g.key, accounts)}>
              <span className="stats-name">{groupLabel(dim, g.key, accounts)}</span>
              <span className="stats-share" aria-hidden><i style={{ width: `${Math.max(1, g.share * 100)}%` }} /></span>
            </th>
            <td className="num" title={full(g.total)}>{compact(g.total)}</td>
            <td className="num">{pct(g.share)}</td>
            <td className="num">{full(g.n)}</td>
          </tr>
        ))}
        {rest.length > 0 && (
          <tr>
            <th scope="row"><span className="stats-name">Pozostałe ({rest.length})</span></th>
            <td className="num">{compact(other.total)}</td>
            <td className="num">{pct(other.share)}</td>
            <td className="num">{full(other.n)}</td>
          </tr>
        )}
      </tbody>
    </table>
  );
}
