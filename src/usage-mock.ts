/** Przykładowe zużycie do podglądu w przeglądarce (bez procesu głównego): deterministyczne. */
import { dayOf, shiftDay, type UsageRow } from "./usage";

const SETS: { provider: string; model: string; source: UsageRow["source"]; project?: string; weight: number; cost?: number }[] = [
  { provider: "claude", model: "claude-opus-5-5", source: "pane", project: "/home/user/roost-app", weight: 5, cost: 0.9 },
  { provider: "claude", model: "claude-sonnet-5-5", source: "pane", project: "/home/user/vs-mod", weight: 3 },
  { provider: "claude", model: "claude-haiku-4-5", source: "chat", weight: 1, cost: 0.02 },
  { provider: "codex", model: "gpt-5.6-luna", source: "pane", project: "/home/user/roost-app", weight: 2 },
  { provider: "llama", model: "Swift-Flash-Next", source: "bot", weight: 1 },
];

export function mockUsageRows(now: Date, days = 45): UsageRow[] {
  const today = dayOf(now.getTime());
  const rows: UsageRow[] = [];
  for (let i = 0; i < days; i++) {
    const day = shiftDay(today, -i);
    SETS.forEach((s, k) => {
      if ((i + k) % 4 === 3) return; // dni bez ruchu
      const base = s.weight * (20_000 + ((i * 7919 + k * 104_729) % 60_000));
      rows.push({
        day,
        source: s.source,
        provider: s.provider,
        model: s.model,
        ...(s.project ? { project: s.project } : {}),
        input: Math.round(base * 0.1),
        output: Math.round(base * 0.15),
        cacheRead: Math.round(base * 0.7),
        cacheWrite: Math.round(base * 0.05),
        reasoning: Math.round(base * 0.04),
        ...(s.cost ? { costUsd: Math.round(base * s.cost) / 1e5 } : {}),
        n: 1 + ((i + k) % 5),
      });
    });
  }
  return rows;
}
