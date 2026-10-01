import { useEffect, useMemo, useState } from "react";
import { RefreshCw } from "lucide-react";
import type { AccountDef } from "./accounts";
import { Dialog } from "./Dialog";
import { locale, t, tp } from "./i18n";
import { useT } from "./i18n/useT";
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

const rangeLabel = (r: Range) => t(`stats.range.${r}`);
const sourceLabel = (s: UsageSource) => t(`stats.source.${s}`);
const DIMS: Dim[] = ["model", "project", "provider", "account", "source"];
const dimLabel = (d: Dim) => t(`stats.dim.${d}`);
const CHART_DAYS = 90;

/** Pełna liczba z odstępami (podpowiedź na skróconej wartości). */
const full = (n: number) => n.toLocaleString(locale());

const pct = (share: number) => (share > 0 && share < 0.001 ? `<${(0.1).toLocaleString(locale())}%` : `${(share * 100).toLocaleString(locale(), { maximumFractionDigits: 1 })}%`);

const dayShort = (day: string) => `${day.slice(8, 10)}.${day.slice(5, 7)}`;

function groupLabel(dim: Dim, key: string, accounts: AccountDef[]): string {
  if (dim === "project") return key === "" ? t("stats.group.noProject") : key;
  if (dim === "account") return key === "" ? t("stats.group.defaultAccount") : (accounts.find((a) => a.id === key)?.name ?? key);
  if (dim === "source") return sourceLabel(key as UsageSource);
  return key || "?";
}

/** Okno „Statystyki”: zużycie tokenów z Czatu, Botów i paneli terminalowych. */
export function StatsDialog({ load, projects, accounts, onClose }: Props) {
  useT(); // przerysowanie po zmianie języka
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
    <Dialog label={t("stats.title")} className="is-stats" onClose={onClose}>
      {() => (
        <>
          <div className="stats-head">
            <h2>{t("stats.title")}</h2>
            <button type="button" className="btn" disabled={busy} onClick={() => refresh()} title={t("stats.refresh.tip")}>
              <RefreshCw strokeWidth={1.75} aria-hidden /> {busy ? t("stats.refresh.busy") : t("stats.refresh")}
            </button>
          </div>
          <p>{t("stats.intro")}</p>
          {error && <p className="stats-err" role="alert">{t("stats.loadFailed", { error })}</p>}

          <div className="stats-filters">
            <div className="seg" role="group" aria-label={t("stats.range.group")}>
              {RANGES.map((r) => (
                <button key={r} type="button" className={filter.range === r ? "is-on" : ""} aria-pressed={filter.range === r} onClick={() => setFilter({ ...filter, range: r })}>
                  {rangeLabel(r)}
                </button>
              ))}
            </div>
            <select className="pm-input stats-source" aria-label={t("stats.source.label")} value={filter.source ?? ""} onChange={(e) => setFilter({ ...filter, source: (e.target.value || undefined) as UsageSource | undefined })}>
              <option value="">{t("stats.source.all")}</option>
              {SOURCES.map((s) => (
                <option key={s} value={s}>{sourceLabel(s)}</option>
              ))}
            </select>
          </div>

          {stats === null && !error && <p className="stats-empty">{t("stats.loading")}</p>}
          {stats !== null && shown.length === 0 && <p className="stats-empty">{t("stats.empty")}</p>}

          {shown.length > 0 && (
            <>
              <div className="stats-tiles">
                <Tile label={t("stats.tile.total")} value={compact(sum.total)} title={full(sum.total)} note={tp("stats.note.days", sum.days)} />
                <Tile label={t("stats.tile.fresh")} value={compact(fresh)} title={full(fresh)} note={t("stats.note.output", { n: compact(u.output) })} />
                <Tile label={t("stats.tile.cache")} value={compact(cache)} title={full(cache)} note={sum.total > 0 ? t("stats.note.cacheShare", { pct: pct(cache / sum.total) }) : undefined} />
                <Tile label={t("stats.tile.top")} value={sum.topModel ?? "—"} small note={tp("stats.note.calls", sum.n, { n: full(sum.n) })} />
                {sum.costUsd > 0 && (
                  <Tile label={t("stats.tile.cost")} value={`$${sum.costUsd.toLocaleString(locale(), { maximumFractionDigits: 2 })}`} note={t("stats.note.costScope")} />
                )}
              </div>

              <Breakdown input={u.input} output={u.output} cacheRead={u.cacheRead} cacheWrite={u.cacheWrite} />

              <Chart series={series} hover={hover} onHover={setHover} capped={filter.range === "all"} />

              <div className="seg stats-dims" role="group" aria-label={t("stats.dim.group")}>
                {DIMS.map((d) => (
                  <button key={d} type="button" className={dim === d ? "is-on" : ""} aria-pressed={dim === d} onClick={() => setDim(d)}>
                    {dimLabel(d)}
                  </button>
                ))}
              </div>
              <GroupTable groups={groups} dim={dim} accounts={accounts} />

              <details className="stats-days">
                <summary>{t("stats.daily")}</summary>
                <table className="stats-table">
                  <thead>
                    <tr><th scope="col">{t("stats.col.day")}</th><th scope="col" className="num">{t("stats.col.fresh")}</th><th scope="col" className="num">{t("stats.col.cache")}</th><th scope="col" className="num">{t("stats.col.total")}</th></tr>
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
              ? `${tp("stats.foot.files", stats.scan.files, { n: full(stats.scan.files) })}${stats.scan.parsed > 0 ? t("stats.foot.parsed", { n: full(stats.scan.parsed) }) : ""}${stats.scan.skipped > 0 ? t("stats.foot.skipped", { n: full(stats.scan.skipped) }) : ""}. `
              : ""}
            {t("stats.foot.note")}
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
  { key: "input", cls: "p-input" },
  { key: "output", cls: "p-output" },
  { key: "cacheRead", cls: "p-cread" },
  { key: "cacheWrite", cls: "p-cwrite" },
] as const;
const SOURCES: UsageSource[] = ["pane", "chat", "bot"];

/** Jeden pasek z podziałem na rodzaje tokenów; legenda z liczbami (kolor nie jest jedynym nośnikiem). */
function Breakdown(u: { input: number; output: number; cacheRead: number; cacheWrite: number }) {
  const total = totalTokens({ ...u, reasoning: 0 });
  if (total === 0) return null;
  return (
    <div className="stats-break">
      <div className="stats-break-bar" role="img" aria-label={PARTS.map((p) => `${t(`stats.part.${p.key}`)} ${pct(u[p.key] / total)}`).join(", ")}>
        {PARTS.filter((p) => u[p.key] > 0).map((p) => (
          <span key={p.key} className={p.cls} style={{ flexGrow: u[p.key] }} />
        ))}
      </div>
      <ul className="stats-legend">
        {PARTS.map((p) => (
          <li key={p.key}>
            <i className={p.cls} aria-hidden /> {t(`stats.part.${p.key}`)} <b title={full(u[p.key])}>{compact(u[p.key])}</b> <span>{pct(u[p.key] / total)}</span>
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
        <span>{capped && series.length >= CHART_DAYS ? t("stats.chart.titleCapped") : t("stats.chart.title")}</span>
        <span className="stats-readout" aria-live="polite">
          {sel
            ? t("stats.chart.readout", { day: sel.day, total: compact(sel.total), fresh: compact(sel.usage.input + sel.usage.output), cache: compact(sel.usage.cacheRead + sel.usage.cacheWrite) })
            : t("stats.chart.peak", { n: compact(max === 1 ? 0 : max) })}
        </span>
      </figcaption>
      <svg viewBox={`0 0 ${W} ${H + 16}`} role="img" aria-label={t("stats.chart.aria")} onMouseLeave={() => onHover(null)}>
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
        <li><i className="bar-fresh-key" aria-hidden /> {t("stats.tile.fresh")}</li>
        <li><i className="bar-cache-key" aria-hidden /> {t("stats.chart.cache")}</li>
      </ul>
    </figure>
  );
}

function GroupTable({ groups, dim, accounts }: { groups: Group[]; dim: Dim; accounts: AccountDef[] }) {
  const head = dimLabel(dim);
  const top = groups.slice(0, 12);
  const rest = groups.slice(12);
  const other = rest.reduce((s, g) => ({ total: s.total + g.total, n: s.n + g.n, share: s.share + g.share }), { total: 0, n: 0, share: 0 });
  return (
    <table className="stats-table">
      <thead>
        <tr><th scope="col">{head}</th><th scope="col" className="num">{t("stats.col.tokens")}</th><th scope="col" className="num">{t("stats.col.share")}</th><th scope="col" className="num">{t("stats.col.calls")}</th></tr>
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
            <th scope="row"><span className="stats-name">{t("stats.rest", { n: rest.length })}</span></th>
            <td className="num">{compact(other.total)}</td>
            <td className="num">{pct(other.share)}</td>
            <td className="num">{full(other.n)}</td>
          </tr>
        )}
      </tbody>
    </table>
  );
}
