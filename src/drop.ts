/** Upuszczanie plików z systemu na panel: ścieżki w cudzysłowie wpisane do terminala. */

/**
 * Jedna ścieżka jako jedno słowo powłoki. Domyślnie cudzysłów podwójny z ucieczką `\ " $ \``;
 * ścieżka z `!` (rozwinięcie historii w bashu działa też w "…") dostaje apostrofy, w których
 * jedyny znak specjalny to sam apostrof (`'` -> `'\''`).
 */
export function quotePath(path: string): string {
  if (path.includes("!")) return `'${path.replace(/'/g, `'\\''`)}'`;
  return `"${path.replace(/[\\"$`]/g, "\\$&")}"`;
}

/** Wiele ścieżek w jednej linii, rozdzielone spacją, bez Entera. Puste ścieżki są pomijane. */
export function quotePaths(paths: readonly string[]): string {
  return paths.filter((p) => p !== "").map(quotePath).join(" ");
}

/** Czy przeciągana rzecz to pliki z systemu (a nie tekst, link ani nagłówek panelu). */
export function hasFiles(types: ReadonlyArray<string> | null | undefined): boolean {
  return !!types && Array.from(types).includes("Files");
}

/** Ścieżki upuszczonych plików; `getPath` to `webUtils.getPathForFile` z preloadu. Bez ścieżki = pominięty. */
export function droppedPaths(files: ArrayLike<File>, getPath: (f: File) => string): string[] {
  const out: string[] = [];
  for (let i = 0; i < files.length; i++) {
    const p = getPath(files[i]);
    if (p) out.push(p);
  }
  return out;
}
