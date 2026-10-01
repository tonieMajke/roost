/** Wyszukiwanie i „Close idle” w sekcji „Panele” pulpitu. Czyste funkcje: bez React, bez DOM. */
import type { PaneState } from "./activity";

export type BoardRow = {
  paneId: string;
  projectId: string;
  title: string;
  agent: string;
  project: string;
  /** Brak odczytu brancha w backendzie: pole opcjonalne, gdy się pojawi, szukanie je obejmie. */
  branch?: string;
  /** Ostatnie zdarzenie z „Na żywo” dla tego panelu. */
  lastMessage?: string;
  state: PaneState;
};

/** Małe litery bez znaków diakrytycznych („Łódź” = „lodz”); ł/Ł nie rozkłada się przez NFD. */
export function fold(s: string): string {
  return s.normalize("NFD").replace(/\p{M}/gu, "").replace(/ł/gi, "l").toLowerCase();
}

/** Każde słowo zapytania musi wystąpić w którymś z pól (AND); puste zapytanie pasuje do wszystkiego. */
export function matchesQuery(row: BoardRow, query: string): boolean {
  const words = fold(query).split(/\s+/).filter(Boolean);
  if (words.length === 0) return true;
  const hay = fold([row.title, row.agent, row.project, row.branch ?? "", row.lastMessage ?? ""].join("\n"));
  return words.every((w) => hay.includes(w));
}

export function filterBoard(rows: readonly BoardRow[], query: string): BoardRow[] {
  return rows.filter((r) => matchesQuery(r, query));
}

/**
 * Bezczynny = proces panelu już się zakończył. Panel w stanie „czeka” zostaje: aplikacja nie
 * odróżnia agenta, który czeka na odpowiedź usera, od takiego, który nic nie robi.
 */
export function isIdle(s: PaneState): boolean {
  return !!s.exited;
}

export function idlePaneIds(rows: readonly BoardRow[]): string[] {
  return rows.filter((r) => isIdle(r.state)).map((r) => r.paneId);
}
