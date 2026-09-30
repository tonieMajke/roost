/** Klawisze okna „Nowy panel”: 1–9 i Enter wybierają agenta, strzałki przechodzą po liście, Esc zamyka. */

export type DialogKey =
  | { type: "pick"; index: number } // dodaj panel z tym agentem i zamknij
  | { type: "move"; index: number } // przenieś zaznaczenie
  | { type: "model"; delta: -1 | 1 } // poprzedni/następny model zaznaczonego agenta
  | { type: "close" }
  | null;

/** Opóźnienie wjazdu i-tego kafelka agenta (wzór D: 80 + 55·i ms). */
export function tileDelayMs(index: number): number {
  return 80 + 55 * index;
}

/** Model po kroku `delta` w kółku [domyślny, ...modele]; `undefined` = domyślny agenta. */
export function stepModel(models: string[], current: string | undefined, delta: -1 | 1): string | undefined {
  const ring = [undefined, ...models];
  const at = Math.max(0, ring.indexOf(current));
  return ring[(at + delta + ring.length) % ring.length];
}

/** `index` is the current selection, `count` the number of agents (only keys 1–9 exist). */
export function dialogKey(key: string, index: number, count: number): DialogKey {
  if (key === "Escape") return { type: "close" };
  if (count === 0) return null;
  const current = Math.min(Math.max(index, 0), count - 1);
  if (/^[1-9]$/.test(key)) {
    const target = Number(key) - 1;
    return target < count ? { type: "pick", index: target } : null;
  }
  switch (key) {
    case "ArrowUp":
      return { type: "move", index: Math.max(0, current - 1) };
    case "ArrowDown":
      return { type: "move", index: Math.min(count - 1, current + 1) };
    case "ArrowLeft":
      return { type: "model", delta: -1 };
    case "ArrowRight":
      return { type: "model", delta: 1 };
    case "Enter":
      return { type: "pick", index: current };
    default:
      return null;
  }
}
