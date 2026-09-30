//! Pane activity from output timestamps only: no parser, no agent integration.
//! All functions are pure and take `now` from the caller (Date.now() in App, fixed in tests).

import type { ExitInfo } from "./backend";

/** Jak często App odpytuje `tick` (1 s — wystarczająco dokładnie dla kropek). */
export const TICK_MS = 1000;

/** Animacja `ping` ze wzoru trwa 0,9 s — dłużej kropeczki projektu nie podświetlamy. */
export const PING_MS = 1000;

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
export type PaneState = {
  exited?: ExitInfo;
  working?: boolean;
  unread?: boolean;
  /** Przez DONE_MS po zdarzeniu `finished` (fala `wave` na panelu). */
  done?: boolean;
};

/** Jak długo panel po skończonej pracy ma klasę `st-done` (animacja `wave` trwa 1,5 s). */
export const DONE_MS = 1600;

/** Opis zakończonego procesu: „kod 0” / „sygnał 15” (używany w panelu i na szynie). */
export function exitText(info: ExitInfo): string {
  return info.signal ? `sygnał ${info.signal}` : `kod ${info.code}`;
}

export type PaneStatus = { cls: string; text: string };

/**
 * Stan panelu (wzór D) dla nagłówka panelu i wiersza na szynie: klasa `st-*` + tekst.
 * Kolejność: pracuje > skończył > nowe wyjście > zakończony proces > czeka.
 */
export function paneStatus(s: PaneState): PaneStatus {
  if (s.working) return { cls: "st-working", text: "pracuje" };
  if (s.done) return { cls: "st-done", text: "skończył" };
  if (s.unread) return { cls: "st-unread", text: "nowe wyjście" };
  if (s.exited) return { cls: "st-exited", text: exitText(s.exited) };
  return { cls: "st-idle", text: "czeka" };
}

/**
 * Klasa kropki przy projekcie (wzór D): nieprzeczytane wygrywa z pracą,
 * praca = kropla „oddycha”, brak stanu = pusto.
 */
export function projectState(panes: PaneState[]): string {
  if (panes.some((p) => p.unread)) return "has-unread";
  if (panes.some((p) => p.working)) return "has-work";
  return "";
}
