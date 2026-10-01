//! Scratchpad: notatka markdown per projekt w `<configDir>/scratchpad/<id projektu>.md`.
//! Poza repo użytkownika; zapis atomowy (tmp + fsync + rename), żeby przerwany zapis
//! zostawił poprzednią wersję, nie pół pliku.

import fs from "node:fs";
import path from "node:path";
import { configDir } from "./config";
import { validId } from "./context";

const DIR = "scratchpad";
/** Górny limit notatki; ponad to to nie notatka, tylko wklejony log. */
export const MAX_BYTES = 1024 * 1024;

/** Id projektu to UUID (`crypto.randomUUID`); inne nie wchodzą w ścieżkę pliku (`../`). */
export function scratchpadPath(id: string, dir = configDir()): string {
  if (!validId(id)) throw new Error(`Nieprawidłowe id projektu: ${JSON.stringify(id)}`);
  return path.join(dir, DIR, `${id}.md`);
}

/** Treść notatki; pusty tekst, gdy jej jeszcze nie ma. */
export function scratchpadLoad(id: string, dir = configDir()): string {
  const file = scratchpadPath(id, dir);
  try {
    return fs.readFileSync(file, "utf8");
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return "";
    throw new Error(`${file}: ${String(e)}`);
  }
}

export function scratchpadSave(id: string, text: string, dir = configDir()): void {
  const file = scratchpadPath(id, dir);
  if (Buffer.byteLength(text, "utf8") > MAX_BYTES) throw new Error("Notatka jest za duża (limit 1 MB)");
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  let fd: number | null = null;
  try {
    fd = fs.openSync(tmp, "w");
    fs.writeSync(fd, text);
    fs.fsyncSync(fd);
    fs.closeSync(fd);
    fd = null;
    fs.renameSync(tmp, file);
  } catch (e) {
    if (fd !== null) fs.closeSync(fd);
    fs.rmSync(tmp, { force: true });
    throw e;
  }
}
