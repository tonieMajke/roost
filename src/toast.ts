/** Komunikaty w prawym dolnym rogu (`.toast`, wzór D). Bez Reacta i DOM-u. */

/** Toast wisi 4 s (plan M2, etap 5). */
export const TOAST_MS = 4000;

/** Treść toastu z części: puste wypadają, reszta łączy się kropką z spacjami. */
export function toastText(...parts: (string | null | undefined)[]): string {
  return parts.filter((p): p is string => typeof p === "string" && p.trim() !== "").join(" · ");
}
