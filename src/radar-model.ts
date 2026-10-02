/** Radar motywu „Wieża” (makieta K): odległość od środka = czas od ostatniego wyjścia panelu.
 *  Pure: bez DOM; `now` i czas ciszy podaje wołający. */

/** Promień tarczy w jednostkach viewBox (560 × 560, środek 280,280). */
export const RADAR_R = 270;
/** Pierścienie: [cisza w ms, promień] – 1 min, 5 min, 15 min, brzeg (30 min i dalej). */
export const RINGS: readonly (readonly [number, number])[] = [
  [0, 0],
  [60_000, 70],
  [300_000, 140],
  [900_000, 210],
  [1_800_000, RADAR_R],
];

/** Promień znaku dla ciszy `quietMs`; `null` (panel jeszcze nic nie wypisał) = brzeg tarczy. */
export function radiusFor(quietMs: number | null): number {
  if (quietMs === null) return RADAR_R;
  const q = Math.max(0, quietMs);
  for (let i = 1; i < RINGS.length; i++) {
    const [t1, r1] = RINGS[i]!;
    if (q <= t1) {
      const [t0, r0] = RINGS[i - 1]!;
      return r0 + ((q - t0) / (t1 - t0)) * (r1 - r0);
    }
  }
  return RADAR_R;
}

/** Stały kąt panelu (radiany, 0 = godzina 12): ten sam panel zawsze w tym samym kierunku. */
export function angleFor(id: string): number {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 16777619);
  return ((h >>> 0) / 4294967296) * Math.PI * 2;
}

/** Wołanie: pierwsze trzy litery agenta + kolejny numer wśród paneli tego agenta („CLA2”). */
export function callsigns(agentNames: readonly string[]): string[] {
  const seen = new Map<string, number>();
  return agentNames.map((name) => {
    const base = name.replace(/[^\p{L}\p{N}]/gu, "").slice(0, 3).toUpperCase() || "PAN";
    const n = (seen.get(base) ?? 0) + 1;
    seen.set(base, n);
    return `${base}${n}`;
  });
}

export type Blip = {
  id: string;
  x: number;
  y: number;
  call: string;
  /** Kontekst w % (wysokość lotu) albo null. */
  level: number | null;
  color: string;
  mode: "work" | "done" | "idle";
};

export type BlipInput = {
  id: string;
  agentName: string;
  color: string;
  /** ms od ostatniego wyjścia; null = brak wyjścia. */
  quietMs: number | null;
  level: number | null;
  working: boolean;
  done: boolean;
};

export function blips(panes: readonly BlipInput[]): Blip[] {
  const calls = callsigns(panes.map((p) => p.agentName));
  return panes.map((p, i) => {
    const r = radiusFor(p.quietMs);
    const a = angleFor(p.id);
    return {
      id: p.id,
      x: 280 + Math.sin(a) * r,
      y: 280 - Math.cos(a) * r,
      call: calls[i]!,
      level: p.level,
      color: p.color,
      mode: p.working ? "work" : p.done ? "done" : "idle",
    };
  });
}
