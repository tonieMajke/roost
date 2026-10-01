import type { KeyLike } from "./keys";

export type SearchAction = "open" | "next" | "prev" | "close";

/**
 * Skróty szukania w terminalu. Ctrl+F otwiera pole (także z terminala, gdzie to „znak do przodu”
 * readline – świadomie go nie oddajemy procesowi); reszta działa tylko przy otwartym polu,
 * żeby Enter, Esc i Ctrl+G dalej trafiały do programu, gdy nic nie szukamy.
 */
export function searchAction(e: KeyLike, open: boolean): SearchAction | null {
  if (e.metaKey || e.altKey) return null;
  const key = e.key.toLowerCase();
  if (e.ctrlKey) {
    if (key === "f" && !e.shiftKey) return "open";
    if (key === "g" && open) return e.shiftKey ? "prev" : "next";
    return null;
  }
  if (!open) return null;
  if (key === "escape") return "close";
  if (key === "enter") return e.shiftKey ? "prev" : "next";
  return null;
}
