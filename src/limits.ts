/** „Limity Claude” in the dock: windows from Claude Code's status line (Rust `limits.rs`). Pure. */
import type { AgentDef } from "./agents";
import { locale, t } from "./i18n";
import { programName } from "./paths";

/** `pct` 0–100 (above 100 once exceeded), `resetsAt` in Unix seconds. */
export type LimitWindow = { pct: number; resetsAt: number };
export type ClaudeLimits = { fiveHour: LimitWindow | null; sevenDay: LimitWindow | null; at: number };

/** The file is written by claude panes on their own; reading it is cheap. */
export const LIMITS_POLL_MS = 30_000;

/** `--settings <json>` for claude panes, unless the agent's own args already set settings. */
export function withClaudeSettings(agent: AgentDef, args: string[], settings: string | null): string[] {
  if (settings === null || programName(agent.command) !== "claude") return args;
  if (args.some((a) => a === "--settings" || a.startsWith("--settings="))) return args;
  return [...args, "--settings", settings];
}

const hhmm = (d: Date) => `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;

/** „reset o 22:40” today, „reset jutro 09:00”, else „reset w pon. 09:00” (local time). */
export function resetText(resetsAt: number, now: number): string {
  const at = new Date(resetsAt * 1000);
  const today = new Date(now);
  const dayDiff = Math.round(
    (new Date(at.getFullYear(), at.getMonth(), at.getDate()).getTime() -
      new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime()) /
      86_400_000,
  );
  if (dayDiff <= 0) return t("ui2.limits.resetToday", { time: hhmm(at) });
  if (dayDiff === 1) return t("ui2.limits.resetTomorrow", { time: hhmm(at) });
  return t("ui2.limits.resetDay", { day: at.toLocaleDateString(locale(), { weekday: "short" }), time: hhmm(at) });
}

export type LimitMeter = { label: string; pct: number; note: string };

/** Meters in wzor-D order; a window whose reset already passed says nothing any more. */
export function limitMeters(limits: ClaudeLimits | null, now: number): LimitMeter[] {
  if (limits === null) return [];
  const rows: [string, LimitWindow | null][] = [
    [t("ui2.limits.session"), limits.fiveHour],
    [t("ui2.limits.week"), limits.sevenDay],
  ];
  return rows.flatMap(([label, w]) =>
    w === null || w.resetsAt * 1000 <= now
      ? []
      : [{ label, pct: Math.max(0, Math.round(w.pct)), note: resetText(w.resetsAt, now) }],
  );
}

/** Limity jednego konta: `id` `""` = konto domyślne Claude (własny folder agenta). */
export type LimitBlock = { id: string; name: string; limits: ClaudeLimits; meters: LimitMeter[] };

/**
 * Bloki do pulpitu: po jednym na konto, które ma jeszcze ważne okno. Kolejność jak w `sources`
 * (domyślne, potem konta użytkownika); konto bez odczytu albo po resecie nic nie mówi i znika.
 */
export function limitBlocks(
  sources: { id: string; name: string }[],
  byId: Record<string, ClaudeLimits | undefined>,
  now: number,
): LimitBlock[] {
  return sources.flatMap((s) => {
    const limits = byId[s.id];
    if (!limits) return [];
    const meters = limitMeters(limits, now);
    return meters.length > 0 ? [{ id: s.id, name: s.name, limits, meters }] : [];
  });
}

/**
 * Okno, które właśnie zablokowało konto: użyte w 100 % i jeszcze przed resetem. Przy kilku wygrywa to,
 * które skończy się najpóźniej (to ono mówi, kiedy da się wrócić). Tekst do paska w panelu.
 */
type HitKey = "ui2.limits.hitSession" | "ui2.limits.hitWeek";
export function limitHit(limits: ClaudeLimits | undefined, now: number): { text: string; resetsAt: number } | null {
  if (!limits) return null;
  const rows: [HitKey, LimitWindow | null][] = [
    ["ui2.limits.hitSession", limits.fiveHour],
    ["ui2.limits.hitWeek", limits.sevenDay],
  ];
  let hit: { label: HitKey; w: LimitWindow } | null = null;
  for (const [label, w] of rows) {
    if (w && w.pct >= 100 && w.resetsAt * 1000 > now && (!hit || w.resetsAt > hit.w.resetsAt)) hit = { label, w };
  }
  return hit && { text: t(hit.label, { reset: resetText(hit.w.resetsAt, now) }), resetsAt: hit.w.resetsAt };
}
