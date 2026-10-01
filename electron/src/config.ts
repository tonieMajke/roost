//! Pliki konfiguracji w `configDir()` (`~/.config/dev.majke.agents/`, jak w wersji Tauri).

import { t } from "./i18n";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { expand } from "./env";
import { validId } from "./context";

const AGENTS_FILE = "agents.json";
const WORKSPACE_FILE = "workspace.json";
const ACCOUNTS_FILE = "accounts.json";

/** `AGENTS_CONFIG_DIR` pozwala uruchomić drugą kopię obok, bez wspólnego workspace.json. */
export function configDir(): string {
  return process.env.AGENTS_CONFIG_DIR || path.join(os.homedir(), ".config", "dev.majke.agents");
}

/** Ta sama lista co `DEFAULT_AGENTS` w `src/agents.ts`. */
export function defaultAgentsJson(): string {
  return JSON.stringify(
    {
      agents: [
        {
          id: "claude", name: "Claude", command: "claude",
          session: { new: ["--session-id", "{session}"], resume: ["--resume", "{session}"], check: "claude" },
        },
        {
          id: "pi", name: "pi", command: "pi",
          session: { new: ["--session-id", "{session}"], resume: ["--session-id", "{session}"] },
        },
        { id: "shell", name: "Terminal", command: "$SHELL" },
      ],
    },
    null,
    2,
  );
}

/** Zapis przez `<plik>.tmp` + rename: awaria nigdy nie zostawia pół pliku. */
export function writeAtomic(file: string, contents: string): void {
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, contents);
  fs.renameSync(tmp, file);
}

const isMissing = (e: unknown) => (e as NodeJS.ErrnoException).code === "ENOENT";

/** Surowy tekst `agents.json`; brakujący plik powstaje z domyślnymi. Zepsutego nie nadpisujemy. */
export function agentsLoad(dir = configDir()): string {
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, AGENTS_FILE);
  try {
    return fs.readFileSync(file, "utf8");
  } catch (e) {
    if (!isMissing(e)) throw new Error(`${file}: ${String(e)}`);
    const text = defaultAgentsJson();
    writeAtomic(file, text);
    return text;
  }
}

/** Claude trzyma rozmowę jako `~/.claude/projects/<zakodowana ścieżka>/<uuid>.jsonl`. */
export function sessionExistsIn(root: string, id: string): boolean {
  if (!validId(id)) return false;
  let dirs: string[];
  try {
    dirs = fs.readdirSync(root);
  } catch {
    return false;
  }
  return dirs.some((d) => isFile(path.join(root, d, `${id}.jsonl`)));
}

export function isFile(p: string): boolean {
  try {
    return fs.statSync(p).isFile();
  } catch {
    return false;
  }
}

/** `dir`: folder logowania konta; brak = `~/.claude`. */
export function claudeSessionExists(id: string, dir?: string): boolean {
  return sessionExistsIn(path.join(dir ? expand(dir) : path.join(os.homedir(), ".claude"), "projects"), id);
}

export function dirExists(p: string): boolean {
  try {
    return fs.statSync(expand(p)).isDirectory();
  } catch {
    return false;
  }
}

/** Treść `workspace.json`; `null` przy pierwszym starcie. */
export function workspaceLoad(dir = configDir()): string | null {
  const file = path.join(dir, WORKSPACE_FILE);
  try {
    return fs.readFileSync(file, "utf8");
  } catch (e) {
    if (isMissing(e)) return null;
    throw new Error(`${file}: ${String(e)}`);
  }
}

export function workspaceSave(json: string, dir = configDir()): void {
  fs.mkdirSync(dir, { recursive: true });
  writeAtomic(path.join(dir, WORKSPACE_FILE), json);
}

/** Kopia `workspace.json` → `workspace.<data>.bak` obok; istniejącej kopii nie nadpisuje. */
export function workspaceBackup(date: string, dir = configDir()): void {
  // Data trafia do nazwy pliku: tylko `RRRR-MM-DD`.
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error(t("config.badDate", { date }));
  const src = path.join(dir, WORKSPACE_FILE);
  const dst = path.join(dir, `workspace.${date}.bak`);
  if (!isFile(src) || fs.existsSync(dst)) return;
  fs.copyFileSync(src, dst);
}

/** Treść `accounts.json`; `null`, gdy użytkownik nie dodał żadnego konta (pliku nie tworzymy sami). */
export function accountsLoad(dir = configDir()): string | null {
  const file = path.join(dir, ACCOUNTS_FILE);
  try {
    return fs.readFileSync(file, "utf8");
  } catch (e) {
    if (isMissing(e)) return null;
    throw new Error(`${file}: ${String(e)}`);
  }
}

export function accountsSave(json: string, dir = configDir()): void {
  fs.mkdirSync(dir, { recursive: true });
  writeAtomic(path.join(dir, ACCOUNTS_FILE), json);
}
