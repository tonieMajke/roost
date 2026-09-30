//! Pane activity from output timestamps only: no parser, no agent integration.
//! All functions are pure and take `now` from the caller (Date.now() in App, fixed in tests).

import type { ExitInfo } from "./backend";

/** Jak często App odpytuje `tick` (1 s — wystarczająco dokładnie dla kropek). */
export const TICK_MS = 1000;

/** Cisza po ostatnich 2 s = panel już nie pracuje. */
export const QUIET_MS = 2000;
/** Seria krótsza niż 3 s to strzępy wyjścia, nie „skończona praca”. */
export const MIN_BURST_MS = 3000;
/** Okno po przerysowaniu: resize sam w sobie produkuje wyjście, które nie jest pracą. */
export const RESIZE_QUIET_MS = 500;

export type Activity = {
  /** Ostatnie wyjście brane pod uwagę (0 = nigdy). */
  lastOutput: number;
  /** Pierwsze wyjście bieżącej serii; `null` = serii nie ma (już zgłoszona lub brak). */
  burstStart: number | null;
  /** Do tego czasu wyjście jest ignorowane (przerysowanie). */
  quietUntil: number;
};

export const initialActivity: Activity = { lastOutput: 0, burstStart: null, quietUntil: 0 };

export function onOutput(a: Activity, now: number): Activity {
  if (now < a.quietUntil) return a;
  // Przerwa >= QUIET_MS = nowa seria; w środku serii burstStart zostaje.
  const startsBurst = a.burstStart === null || now - a.lastOutput >= QUIET_MS;
  return { lastOutput: now, burstStart: startsBurst ? now : a.burstStart, quietUntil: a.quietUntil };
}

export function onResize(a: Activity, now: number): Activity {
  return { ...a, quietUntil: now + RESIZE_QUIET_MS };
}

export type Tick = { activity: Activity; working: boolean; finished: boolean };

/** Wołane z interwału 1 s: wyznacza `working` i jednorazowe `finished`. */
export function tick(a: Activity, now: number): Tick {
  const working = a.lastOutput !== 0 && now - a.lastOutput < QUIET_MS;
  const longBurst = a.burstStart !== null && a.lastOutput - a.burstStart >= MIN_BURST_MS;
  // Przejście praca -> cisza po długiej serii; po zgłoszeniu seria się nie powtórzy.
  const finished = !working && longBurst;
  return { activity: finished ? { ...a, burstStart: null } : a, working, finished };
}

/** Stan ulotny panelu (nigdy nie trafia na dysk): proces + aktywność z tego pliku. */
export type PaneState = { exited?: ExitInfo; working?: boolean; unread?: boolean };

/**
 * Klasa kropki stanu w nagłówku panelu i wierszu na szynie.
 * `working` i `unread` wygrywają nad „działa/zakończony”.
 */
export function dotClass(s: PaneState): string {
  if (s.working) return "dot--working";
  if (s.unread) return "dot--unread";
  return s.exited ? "dot--off" : "dot--on";
}

/** Treść title dla kropki. */
export function dotTitle(s: PaneState, exitLabel: string): string {
  if (s.working) return "pracuje";
  if (s.unread) return "nowe wyjście – panel bez fokusu";
  return s.exited ? exitLabel : "działa";
}
