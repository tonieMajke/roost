import type { Box } from "./motion";

/** Przeciąganie panelu (M4): czysta geometria i fizyka kulki, bez DOM. */

export type Point = { x: number; y: number };

/** Ruch, po którym wciśnięcie nagłówka staje się przeciąganiem (krótszy = zwykły klik). */
export const DRAG_START_PX = 6;
/** Średnica kulki. */
export const BUBBLE_PX = 48;
/** Czas zwinięcia panelu w kulkę i rozwinięcia z powrotem. */
export const MORPH_MS = 240;
/** Czas wlotu kulki w cel. */
export const DROP_MS = 160;

export function pastThreshold(start: Point, p: Point): boolean {
  return Math.hypot(p.x - start.x, p.y - start.y) > DRAG_START_PX;
}

/** Panel pod punktem (pudełka w układzie okna); własny panel i puste miejsce = `null`. */
export function dropTarget(boxes: ReadonlyMap<string, Box>, p: Point, self: string): string | null {
  for (const [id, b] of boxes) {
    if (id !== self && p.x >= b.x && p.x < b.x + b.w && p.y >= b.y && p.y < b.y + b.h) return id;
  }
  return null;
}

export const boxCenter = (b: Box): Point => ({ x: b.x + b.w / 2, y: b.y + b.h / 2 });

/** Ułamek dystansu nadrabiany w jednej klatce 60 Hz. */
const FOLLOW_PER_FRAME = 0.25;
const FRAME_MS = 1000 / 60;

/** Kulka goni kursor; liczone od `dt`, żeby przy 144 Hz nie była szybsza niż przy 60 Hz. */
export function follow(pos: Point, target: Point, dtMs: number): Point {
  const k = 1 - Math.pow(1 - FOLLOW_PER_FRAME, Math.max(0, dtMs) / FRAME_MS);
  return { x: pos.x + (target.x - pos.x) * k, y: pos.y + (target.y - pos.y) * k };
}

/** Rozciągnięcie bąbelka wzdłuż ruchu: kąt (stopnie) i skala w tym kierunku (1…1,15). */
export function stretch(v: Point): { angle: number; scale: number } {
  const speed = Math.hypot(v.x, v.y); // px/ms
  if (speed < 0.01) return { angle: 0, scale: 1 };
  return { angle: (Math.atan2(v.y, v.x) * 180) / Math.PI, scale: 1 + Math.min(0.15, speed * 0.06) };
}

/**
 * Transformacja (origin 0 0), która zwija pudełko panelu w kulkę o środku `p`.
 * Z `border-radius: 50%` niejednorodna skala daje koło, nie elipsę.
 */
export function shrinkTo(b: Box, p: Point): string {
  const s = BUBBLE_PX;
  return `translate(${p.x - s / 2 - b.x}px, ${p.y - s / 2 - b.y}px) scale(${s / b.w}, ${s / b.h})`;
}
