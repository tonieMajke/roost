//! Pliki konfiguracji w `configDir()` (`~/.config/dev.majke.roost/`; do wersji „Agents” był to `dev.majke.agents`).

import { t } from "./i18n";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { expand } from "./env";
import { validId } from "./context";

const AGENTS_FILE = "agents.json";
const WORKSPACE_FILE = "workspace.json";
const ACCOUNTS_FILE = "accounts.json";
const CHAT_KEYS_FILE = "chat-keys.json";

/** `ROOST_CONFIG_DIR` (dawniej `AGENTS_CONFIG_DIR`) pozwala uruchomić drugą kopię obok, bez wspólnego workspace.json. */
export function configDir(): string {
  const env = process.env.ROOST_CONFIG_DIR || process.env.AGENTS_CONFIG_DIR;
  return env || path.join(os.homedir(), ".config", "dev.majke.roost");
}

/** Katalog z czasów nazwy „Agents”. */
export function legacyConfigDir(): string {
  return path.join(os.homedir(), ".config", "dev.majke.agents");
}

const DATA_NAMES = ["workspace.json", "agents.json", "accounts.json", "chat-keys.json", "bots", "chats"];

/** Czy katalog ma dane użytkownika (a nie jest pusty albo szczątkowy). */
function hasUserData(dir: string): boolean {
  return DATA_NAMES.some((n) => fs.existsSync(path.join(dir, n)));
}

/**
 * Pierwszy start po zmianie nazwy: gdy nowy katalog nie istnieje albo nie ma w nim żadnych danych
 * (workspace/agents/accounts/chat-keys, bots/, chats/), a stary jest, kopiuje stary w całości.
 * Kopia powstaje w `<dir>.migrating` i dopiero po sukcesie trafia pod docelową nazwę (rename),
 * więc przerwana kopia nie zostawia półkatalogu, który blokowałby kolejną próbę. Katalogu z danymi
 * nie ruszamy nigdy. Stary katalog zostaje nietknięty. Błąd kopiowania jest rzucany (main.ts go loguje).
 * Zwraca true, gdy skopiowano.
 */
export function migrateLegacyConfig(dir = configDir(), legacy = legacyConfigDir()): boolean {
  if (!fs.existsSync(legacy)) return false;
  if (fs.existsSync(dir) && hasUserData(dir)) return false;
  const tmp = `${dir}.migrating`;
  fs.rmSync(tmp, { recursive: true, force: true });
  try {
    fs.cpSync(legacy, tmp, { recursive: true });
    if (fs.existsSync(dir)) {
      // Szczątki w docelowym katalogu (np. cache) przenosimy do kopii, o ile stary katalog ich nie ma.
      for (const n of fs.readdirSync(dir)) {
        if (!fs.existsSync(path.join(tmp, n))) fs.renameSync(path.join(dir, n), path.join(tmp, n));
      }
      fs.rmSync(dir, { recursive: true, force: true });
    }
    fs.renameSync(tmp, dir);
    tightenSecretPerms(dir);
  } catch (e) {
    fs.rmSync(tmp, { recursive: true, force: true });
    throw e;
  }
  return true;
}

/** Pliki z sekretami (względem `dir`): klucze zaszyfrowane safeStorage, konta, kopia ustawień wyszukiwarek pi. */
const SECRET_FILES = [CHAT_KEYS_FILE, ACCOUNTS_FILE, path.join("pi-agent", "web-search.json")];

/** Katalog konfiguracji 0700, a pliki z sekretami 0600 (cpSync zachowuje stare, szersze uprawnienia).
 *  Reszty plików nie ruszamy. Brakujące pliki pomijamy. */
export function tightenSecretPerms(dir: string): void {
  fs.chmodSync(dir, 0o700);
  for (const f of SECRET_FILES) {
    const file = path.join(dir, f);
    if (isFile(file)) fs.chmodSync(file, 0o600);
  }
}

/** Na starcie: tworzy katalog konfiguracji (0700) i zaostrza uprawnienia, także w świeżej instalacji. */
export function ensureConfigPerms(dir = configDir()): void {
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  tightenSecretPerms(dir);
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

/** Zapis przez `<plik>.tmp` + fsync + rename: awaria nigdy nie zostawia pół pliku.
 *  `mode`: uprawnienia pliku (sekrety: 0o600), ustawiane już na pliku tymczasowym, więc nigdy
 *  nie jest on czytelny dla innych. Bez `mode` zostają domyślne (umask). */
export function writeAtomic(file: string, contents: string, mode?: number): void {
  const tmp = `${file}.tmp`;
  if (mode !== undefined) fs.rmSync(tmp, { force: true }); // stary .tmp mógł mieć szersze uprawnienia
  const fd = fs.openSync(tmp, "w", mode);
  try {
    fs.writeFileSync(fd, contents);
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
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
  writeAtomic(path.join(dir, ACCOUNTS_FILE), json, 0o600);
}

/** Kodowanie ścieżki cwd na nazwę katalogu projektu Claude'a (`/home/x/.y` → `-home-x--y`). */
export function claudeProjectDirName(cwd: string): string {
  return cwd.replace(/[^a-zA-Z0-9]/g, "-");
}

/**
 * Wznawianie sesji Claude'a: sesja leży pod projektem zakodowanym z cwd, w którym powstała.
 * Po zmianie nazwy katalogu konfiguracji (`dev.majke.agents` → `dev.majke.roost`) stare sesje są
 * pod starym cwd. Zwraca cwd i flagę resume: nowy cwd, gdy sesja tam jest; stary, gdy jest tylko tam;
 * a gdy nie ma jej nigdzie, `resume: false` (nowa sesja zamiast `--resume`, które by padło).
 */
export function resolveClaudeResume(
  id: string,
  cwd: string,
  legacyCwd: string | null,
  projectsRoot: string,
): { cwd: string; resume: boolean } {
  if (!validId(id)) return { cwd, resume: false };
  const has = (c: string) => isFile(path.join(projectsRoot, claudeProjectDirName(c), `${id}.jsonl`));
  if (has(cwd)) return { cwd, resume: true };
  if (legacyCwd && has(legacyCwd)) return { cwd: legacyCwd, resume: true };
  return { cwd, resume: false };
}

/** Stary odpowiednik cwd pod `configDir()` (pod `legacyConfigDir()`), albo null poza nim. */
export function legacyCwdFor(cwd: string, dir = configDir(), legacy = legacyConfigDir()): string | null {
  const rel = path.relative(dir, cwd);
  if (rel === "" || rel.startsWith("..") || path.isAbsolute(rel)) return rel === "" ? legacy : null;
  return path.join(legacy, rel);
}
