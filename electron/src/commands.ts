//! Czy program agenta da się uruchomić: ten sam PATH i to samo rozwijanie (`$SHELL`, `~`), co przy starcie panelu.

import fs from "node:fs";
import path from "node:path";
import { childEnv, expand } from "./env";

function isExecutable(file: string): boolean {
  try {
    fs.accessSync(file, fs.constants.X_OK);
    return fs.statSync(file).isFile();
  } catch {
    return false;
  }
}

/** Komenda ze ścieżką (`/usr/bin/x`, `~/bin/x`) jest sprawdzana wprost, goła nazwa w katalogach z `pathVar`. */
export function commandExists(command: string, pathVar: string | undefined): boolean {
  const cmd = expand(command);
  if (cmd === "") return false;
  if (cmd.includes("/")) return isExecutable(cmd);
  return (pathVar ?? "").split(path.delimiter).some((dir) => dir !== "" && isExecutable(path.join(dir, cmd)));
}

/** Wynik po tekście komendy z `agents.json`; PATH jak u dziecka (bez zmiennych AppImage). */
export function commandsAvailable(commands: string[], pathVar: string | undefined = childEnv().PATH): Record<string, boolean> {
  return Object.fromEntries(commands.map((c) => [c, commandExists(c, pathVar)]));
}
