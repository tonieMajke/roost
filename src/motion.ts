import { gridShape } from "./workspace";

/** Czas i krzywa FLIP ze wzoru D (`flipMs`, `flipEase`). */
export const FLIP_MS = 340;
export const FLIP_EASE = "cubic-bezier(.2,.8,.2,1)";
/** Panele wjeżdżają kolejno po przełączeniu projektu: opóźnienie na panel. */
export const ENTER_STAGGER_MS = 60;
/** Tyle po przełączeniu projektu obowiązuje opóźnienie kolejnych paneli (wzór: 700 ms). */
export const ENTER_WINDOW_MS = 700;

/** Pudełko komórki w układzie siatki (offset*, bez transformacji). */
export type Box = { x: number; y: number; w: number; h: number };

/**
 * FLIP: transformacja, która stawia komórkę w nowym miejscu `next` tam, gdzie była (`prev`);
 * animacja do `none` przesuwa ją płynnie. `null` = różnica niewidoczna (poniżej 1 px / 1%).
 * Zakłada `transform-origin: 0 0`.
 */
export function flipTransform(prev: Box, next: Box): string | null {
  if (next.w <= 0 || next.h <= 0 || prev.w <= 0 || prev.h <= 0) return null;
  const dx = prev.x - next.x;
  const dy = prev.y - next.y;
  const sx = prev.w / next.w;
  const sy = prev.h / next.h;
  if (Math.abs(dx) < 1 && Math.abs(dy) < 1 && Math.abs(sx - 1) < 0.01 && Math.abs(sy - 1) < 0.01) return null;
  return `translate(${dx}px, ${dy}px) scale(${sx}, ${sy})`;
}

/** `transform-origin` zmaksymalizowanego panelu: środek jego komórki w zwykłej siatce `n` paneli. */
export function maxOrigin(index: number, n: number): string {
  const { cols, rows } = gridShape(n);
  if (cols === 0 || index < 0 || index >= n) return "50% 50%";
  const pct = (v: number) => `${Math.round(v * 10000) / 100}%`;
  return `${pct(((index % cols) + 0.5) / cols)} ${pct((Math.floor(index / cols) + 0.5) / rows)}`;
}

/** Klasa wjazdu siatki: projekt niżej na szynie wjeżdża z dołu, wyżej – z góry. */
export function enterClass(order: readonly string[], from: string | null, to: string | null): "enter-next" | "enter-prev" | null {
  if (from === null || to === null || from === to) return null;
  const a = order.indexOf(from);
  const b = order.indexOf(to);
  if (b < 0) return null;
  // Poprzedni projekt usunięty: wjazd jak do następnego.
  return a < 0 || b > a ? "enter-next" : "enter-prev";
}

/** Opóźnienie `paneIn` panelu `index` przy wjeździe: kolejno, tylko tuż po przełączeniu. */
export function enterDelayMs(index: number, sinceSwitchMs: number | null): number {
  if (sinceSwitchMs === null || sinceSwitchMs < 0 || sinceSwitchMs >= ENTER_WINDOW_MS) return 0;
  return index * ENTER_STAGGER_MS;
}

/** Ruch dekoracyjny (FLIP, wzrost, wjazd) – wyłączony przy `motion-lite` i `prefers-reduced-motion`. */
export function motionAllowed(motion: "full" | "lite", reducedMotion: boolean): boolean {
  return motion === "full" && !reducedMotion;
}

/**
 * Kolejność komórek w DOM: stała od utworzenia panelu (nowe na końcu, zamknięte wypadają).
 * Miejsce w siatce daje CSS `order`, więc zamiana paneli nie przenosi węzłów – canvas xterm
 * nie jest odpinany. Zwraca `prev`, gdy nic się nie zmieniło.
 */
export function mountOrder(prev: readonly string[], ids: readonly string[]): readonly string[] {
  const live = new Set(ids);
  const kept = prev.filter((id) => live.has(id));
  const known = new Set(kept);
  const next = [...kept, ...ids.filter((id) => !known.has(id))];
  return next.length === prev.length && next.every((id, i) => id === prev[i]) ? prev : next;
}
