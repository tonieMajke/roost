//! Czy program agenta da się uruchomić: ten sam PATH i to samo rozwijanie (`$SHELL`, `~`), co przy starcie panelu.

import { childEnv, expand } from "./env";
import { resolveCommand } from "./platform";

/** Komenda ze ścieżką (`/usr/bin/x`, `~/bin/x`) jest sprawdzana wprost, goła nazwa w katalogach z `pathVar`
 *  (na Windows także z rozszerzeniami z `PATHEXT`: `codex` → `codex.cmd`). */
export function commandExists(command: string, pathVar: string | undefined): boolean {
  // Bez innych wariantów nazwy (`Path` na Windows), żeby liczył się tylko `pathVar`; PATHEXT zostaje.
  const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => k.toUpperCase() !== "PATH"));
  return resolveCommand(expand(command), { env: { ...env, PATH: pathVar ?? "" } }) !== null;
}

/** Wynik po tekście komendy z `agents.json`; PATH jak u dziecka (bez zmiennych AppImage). */
export function commandsAvailable(commands: string[], pathVar: string | undefined = pathOf(childEnv())): Record<string, boolean> {
  return Object.fromEntries(commands.map((c) => [c, commandExists(c, pathVar)]));
}

function pathOf(env: Record<string, string>): string | undefined {
  const key = Object.keys(env).find((k) => k.toUpperCase() === "PATH");
  return key ? env[key] : undefined;
}
