/** Kolejność sekcji pulpitu (`ui.dockOrder`). Czyste: bez Reacta i DOM. */

export const DOCK_SECTIONS = ["limits", "context", "board", "live"] as const;
export type DockSection = (typeof DOCK_SECTIONS)[number];

/** Limity Claude, kontekst, panele, na żywo. */
export const DEFAULT_DOCK_ORDER: DockSection[] = [...DOCK_SECTIONS];

const isSection = (v: unknown): v is DockSection => DOCK_SECTIONS.includes(v as DockSection);

/** Poprawna jest tylko permutacja wszystkich sekcji; inaczej domyślna kolejność i komunikat. */
export function parseDockOrder(raw: unknown): { order: DockSection[]; error?: string } {
  const ok = Array.isArray(raw) && raw.length === DOCK_SECTIONS.length && raw.every(isSection) && new Set(raw).size === raw.length;
  if (ok) return { order: [...raw] };
  return { order: [...DEFAULT_DOCK_ORDER], error: `ui.dockOrder: must list each of ${DOCK_SECTIONS.join(", ")} once, using the default order` };
}

/** Przenosi `id` tuż przed albo tuż za `target`. */
export function moveSection(order: readonly DockSection[], id: DockSection, target: DockSection, place: "before" | "after"): DockSection[] {
  if (id === target) return [...order];
  const rest = order.filter((s) => s !== id);
  const at = rest.indexOf(target) + (place === "after" ? 1 : 0);
  return [...rest.slice(0, at), id, ...rest.slice(at)];
}

/** Przesunięcie o jedno miejsce (klawiatura); na krańcu bez zmian. */
export function stepSection(order: readonly DockSection[], id: DockSection, step: -1 | 1): DockSection[] {
  const i = order.indexOf(id);
  const j = i + step;
  if (i < 0 || j < 0 || j >= order.length) return [...order];
  const next = [...order];
  [next[i], next[j]] = [next[j], next[i]];
  return next;
}
