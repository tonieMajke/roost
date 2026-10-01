/** Symulacja tła „Mgławica” (makieta S): cząstki z paneli spiralą płyną do rdzenia na środku.
 *  Pure: bez DOM i bez losowości z zewnątrz (`rand` wstrzykiwany), żeby dało się testować. */

export type Emitter = {
  x: number;
  y: number;
  /** Kolor agenta jako "r,g,b". */
  color: string;
  /** Średnio tyle cząstek na klatkę (ułamek = prawdopodobieństwo). */
  rate: number;
  /** Fala „skończył” zamiast cząstek. */
  ring?: boolean;
};

export type Particle = { x: number; y: number; vx: number; vy: number; color: string; age: number; size: number };

export const MAX_PARTICLES = 1600;
export const MAX_AGE = 900;
/** Cząstka bliżej rdzenia niż tyle jest pochłaniana. */
export const CORE_RADIUS = 26;

/** Tempo cząstek panelu wg stanu (`st-*` z `paneStatus`). */
export function rateFor(cls: string): { rate: number; ring: boolean } {
  if (cls.includes("st-working")) return { rate: 5, ring: false };
  if (cls.includes("st-done")) return { rate: 0, ring: true };
  if (cls.includes("st-unread")) return { rate: 0.5, ring: false };
  return { rate: 0.15, ring: false };
}

export function spawn(e: Emitter, rand: () => number): Particle {
  const ang = rand() * Math.PI * 2;
  const sp = 0.4 + rand() * 1.2;
  return {
    x: e.x + Math.cos(ang) * 6, y: e.y + Math.sin(ang) * 6,
    vx: Math.cos(ang) * sp, vy: Math.sin(ang) * sp,
    color: e.color, age: 0, size: 0.8 + rand() * 1.6,
  };
}

/** Jedna klatka: emisja, przyciąganie do rdzenia (+ składowa styczna = spirala), tarcie, pochłanianie. */
export function step(particles: Particle[], emitters: readonly Emitter[], core: { x: number; y: number }, rand: () => number): Particle[] {
  for (const e of emitters) {
    if (e.ring) continue;
    let n = e.rate;
    while (n > 0) {
      if (n >= 1 || rand() < n) particles.push(spawn(e, rand));
      n--;
    }
  }
  if (particles.length > MAX_PARTICLES) particles.splice(0, particles.length - MAX_PARTICLES);
  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i]!;
    const dx = core.x - p.x;
    const dy = core.y - p.y;
    const d = Math.hypot(dx, dy) || 1;
    p.vx += (dx / d) * 0.05 + (-dy / d) * 0.06;
    p.vy += (dy / d) * 0.05 + (dx / d) * 0.06;
    p.vx *= 0.985;
    p.vy *= 0.985;
    p.x += p.vx;
    p.y += p.vy;
    p.age++;
    if (d < CORE_RADIUS || p.age > MAX_AGE) particles.splice(i, 1);
  }
  return particles;
}
