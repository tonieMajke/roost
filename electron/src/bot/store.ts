//! Boty zakładki Bot na dysku: `<configDir>/bots/<id>/` z `bot.json`, pamięcią, skillami,
//! harmonogramem, rozmowami (`chats/`), przebiegami (`runs/`) i katalogiem roboczym (`work/`).
//! Usunięty bot trafia do `bots-trash/`, nie jest kasowany.

import { t } from "../i18n";
import fs from "node:fs";
import path from "node:path";
import {
  creatorBot,
  CREATOR_ID,
  isBotId,
  isSkillName,
  MEMORY_LIMIT,
  parseBot,
  parseBotChat,
  parseRoutines,
  parseSkill,
  serializeBot,
  USER_LIMIT,
  type BotDef,
  type Routine,
} from "../../../src/bot";
import { writeAtomic } from "../config";
import { ChatStore } from "../chat/store";

export type MemoryTarget = "memory" | "user";
export type ChatKind = "chats" | "runs";
/** Kto utworzył skill: bot narzędziem, użytkownik w karcie bota, import z `~/.claude/skills`. */
export type SkillAuthor = "bot" | "user" | "import";
export type SkillMeta = { name: string; description: string; updated: number; by?: SkillAuthor; error?: string };
export type SkillSource = { name: string; description: string; error?: string };

const AUTHOR_FILE = ".author";
const AUTHORS: SkillAuthor[] = ["bot", "user", "import"];
const IMPORT_MAX = 5 * 1024 * 1024;
const AVATAR_MAX = 2 * 1024 * 1024;
const AVATAR_TYPES: Record<string, string> = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp", gif: "image/gif" };
const AVATAR_RE = /^avatar\.(png|jpe?g|webp|gif)$/;

/** Rozmiar drzewa katalogów (dowiązania liczone po celu, jak przy kopiowaniu). */
function treeSize(dir: string, limit: number): number {
  let total = 0;
  for (const e of fs.readdirSync(dir)) {
    const p = path.join(dir, e);
    const st = fs.statSync(p);
    total += st.isDirectory() ? treeSize(p, limit - total) : st.size;
    if (total > limit) return total;
  }
  return total;
}

const MEMORY_FILES: Record<MemoryTarget, { file: string; limit: number }> = {
  memory: { file: "memory.md", limit: MEMORY_LIMIT },
  user: { file: "user.md", limit: USER_LIMIT },
};

const readOr = (file: string, fallback: string) => {
  try {
    return fs.readFileSync(file, "utf8");
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return fallback;
    throw e;
  }
};

/** `2026-10-01-143005` – nazwa w koszu, czytelna i sortowalna. */
const stamp = (d: Date) =>
  [d.getFullYear(), d.getMonth() + 1, d.getDate()].map((n) => String(n).padStart(2, "0")).join("-") +
  "-" +
  [d.getHours(), d.getMinutes(), d.getSeconds()].map((n) => String(n).padStart(2, "0")).join("");

export class BotStore {
  constructor(
    private root: string, // <configDir>/bots
    private trash: string, // <configDir>/bots-trash
    private now: () => number = Date.now,
  ) {}

  dir(id: string): string {
    if (!isBotId(id)) throw new Error(t("bot.badId", { id }));
    return path.join(this.root, id);
  }

  work(id: string): string {
    return path.join(this.dir(id), "work");
  }

  private exists(id: string): boolean {
    return fs.existsSync(path.join(this.dir(id), "bot.json"));
  }

  private mustExist(id: string): string {
    if (!this.exists(id)) throw new Error(`nie ma bota „${id}”`);
    return this.dir(id);
  }

  private write(bot: BotDef): void {
    const dir = this.dir(bot.id);
    fs.mkdirSync(path.join(dir, "work"), { recursive: true });
    fs.mkdirSync(path.join(dir, "skills"), { recursive: true });
    writeAtomic(path.join(dir, "bot.json"), serializeBot(bot));
  }

  /** Wszystkie boty (Kreator powstaje przy pierwszym odczycie); od najstarszego, Kreator na końcu. */
  list(): { bots: BotDef[]; errors: string[] } {
    fs.mkdirSync(this.root, { recursive: true });
    if (!this.exists(CREATOR_ID)) this.write(creatorBot(this.now()));
    const bots: BotDef[] = [];
    const errors: string[] = [];
    for (const name of fs.readdirSync(this.root).sort()) {
      if (!isBotId(name)) continue;
      const file = path.join(this.root, name, "bot.json");
      let raw: string;
      try {
        raw = fs.readFileSync(file, "utf8");
      } catch {
        continue; // katalog bez bot.json (np. w trakcie usuwania)
      }
      try {
        const r = parseBot(JSON.parse(raw));
        errors.push(...r.errors);
        if (r.bot && r.bot.id === name) bots.push(r.bot);
        else if (r.bot) errors.push(t("bot.idMismatch", { file, id: r.bot.id }));
      } catch (e) {
        errors.push(`${file}: ${String(e)}`);
      }
    }
    bots.sort((a, b) => Number(!!a.builtin) - Number(!!b.builtin) || a.created - b.created || a.id.localeCompare(b.id));
    return { bots, errors };
  }

  load(id: string): BotDef | null {
    if (!this.exists(id)) return null;
    return parseBot(JSON.parse(fs.readFileSync(path.join(this.dir(id), "bot.json"), "utf8"))).bot;
  }

  /** Nowy bot; zajęte id = błąd (wolne id liczy strona przez `botId`). */
  create(json: string): BotDef {
    const { bot } = parseBot(JSON.parse(json));
    if (!bot) throw new Error(t("bot.badFormat"));
    if (bot.builtin) throw new Error(t("bot.builtinTwice"));
    if (fs.existsSync(this.dir(bot.id))) throw new Error(t("bot.exists", { id: bot.id }));
    this.write(bot);
    return bot;
  }

  /** Zmiana istniejącego bota; `builtin` i `created` zostają z dysku. */
  save(json: string): BotDef {
    const { bot } = parseBot(JSON.parse(json));
    if (!bot) throw new Error(t("bot.badFormat"));
    const old = this.load(bot.id);
    if (!old) throw new Error(`nie ma bota „${bot.id}”`);
    const next: BotDef = { ...bot, created: old.created };
    if (old.builtin) next.builtin = old.builtin;
    else delete next.builtin;
    this.write(next);
    return next;
  }

  /** Przeniesienie do `bots-trash/<id>-<data>`; Kreatora usunąć się nie da. */
  delete(id: string): void {
    const dir = this.mustExist(id);
    if (this.load(id)?.builtin) throw new Error(t("bot.builtinDelete"));
    fs.mkdirSync(this.trash, { recursive: true });
    let dest = path.join(this.trash, `${id}-${stamp(new Date(this.now()))}`);
    for (let n = 2; fs.existsSync(dest); n++) dest = path.join(this.trash, `${id}-${stamp(new Date(this.now()))}-${n}`);
    fs.renameSync(dir, dest);
  }

  memory(id: string): Record<MemoryTarget, string> {
    const dir = this.mustExist(id);
    return {
      memory: readOr(path.join(dir, MEMORY_FILES.memory.file), ""),
      user: readOr(path.join(dir, MEMORY_FILES.user.file), ""),
    };
  }

  /** Zapis pamięci (z UI albo z narzędzia `memory` po `memoryEdit`); ponad limit = błąd. */
  memorySave(id: string, target: MemoryTarget, text: string): void {
    const dir = this.mustExist(id);
    const m = MEMORY_FILES[target];
    if (!m) throw new Error(t("bot.badMemory", { target: String(target) }));
    if (text.length > m.limit) throw new Error(t("bot.memoryTooBig", { target, n: text.length, limit: m.limit }));
    writeAtomic(path.join(dir, m.file), text);
  }

  private skillsDir(id: string): string {
    return path.join(this.mustExist(id), "skills");
  }

  private skillFile(id: string, name: string): string {
    if (!isSkillName(name)) throw new Error(t("main.badSkill", { name }));
    return path.join(this.skillsDir(id), name, "SKILL.md");
  }

  /** Skille bota po nazwie; zepsuty `SKILL.md` zostaje na liście z `error`. */
  skills(id: string): SkillMeta[] {
    const dir = this.skillsDir(id);
    const out: SkillMeta[] = [];
    let names: string[] = [];
    try {
      names = fs.readdirSync(dir).sort();
    } catch {
      return [];
    }
    for (const name of names) {
      if (!isSkillName(name)) continue;
      const file = path.join(dir, name, "SKILL.md");
      let text: string;
      let updated: number;
      try {
        text = fs.readFileSync(file, "utf8");
        updated = fs.statSync(file).mtimeMs;
      } catch {
        continue;
      }
      const a = readOr(path.join(dir, name, AUTHOR_FILE), "").trim() as SkillAuthor;
      const by = AUTHORS.includes(a) ? { by: a } : {};
      const s = parseSkill(text);
      if ("error" in s) out.push({ name, description: "", updated, ...by, error: s.error });
      else if (s.name !== name) out.push({ name, description: s.description, updated, ...by, error: `\`name: ${s.name}\` ≠ katalog \`${name}\`` });
      else out.push({ name, description: s.description, updated, ...by });
    }
    return out;
  }

  /** Treść `SKILL.md`; `null` = nie ma. */
  skill(id: string, name: string): string | null {
    return readOr(this.skillFile(id, name), "") || null;
  }

  /** Zapis skilla; nazwa z frontmattera wyznacza katalog. `by` zapisuje się tylko przy tworzeniu. */
  skillSave(id: string, md: string, by: SkillAuthor = "user"): string {
    const s = parseSkill(md);
    if ("error" in s) throw new Error(`SKILL.md: ${s.error}`);
    const file = this.skillFile(id, s.name);
    const isNew = !fs.existsSync(file);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    writeAtomic(file, md);
    if (isNew) writeAtomic(path.join(path.dirname(file), AUTHOR_FILE), by);
    return s.name;
  }

  /** Skille do importu z `dir` (np. `~/.claude/skills`): tylko odczyt. */
  static skillSources(dir: string): SkillSource[] {
    let names: string[];
    try {
      names = fs.readdirSync(dir).sort();
    } catch {
      return [];
    }
    const out: SkillSource[] = [];
    for (const name of names) {
      const text = readOr(path.join(dir, name, "SKILL.md"), "");
      if (!text) continue;
      const s = parseSkill(text);
      if ("error" in s) out.push({ name, description: "", error: s.error });
      else out.push({ name: s.name, description: s.description, ...(s.name !== name ? { error: `\`name: ${s.name}\` ≠ katalog \`${name}\`` } : {}) });
    }
    return out;
  }

  /** Kopia katalogu skilla (z plikami obok `SKILL.md`, dowiązania jako zwykłe pliki); źródło bez zmian. */
  skillImport(id: string, srcDir: string): string {
    const s = parseSkill(readOr(path.join(srcDir, "SKILL.md"), ""));
    if ("error" in s) throw new Error(`SKILL.md: ${s.error}`);
    const file = this.skillFile(id, s.name);
    if (fs.existsSync(file)) throw new Error(t("bot.skillExists", { name: s.name }));
    const size = treeSize(srcDir, IMPORT_MAX);
    if (size > IMPORT_MAX) throw new Error(`skill „${s.name}” ma ponad ${IMPORT_MAX / 1024 / 1024} MB`);
    const dest = path.dirname(file);
    fs.cpSync(srcDir, dest, { recursive: true, dereference: true });
    writeAtomic(path.join(dest, AUTHOR_FILE), "import");
    return s.name;
  }

  /** Obrazek awatara: kopia do folderu bota jako `avatar.<ext>`; zwraca nazwę do `avatar.image`. */
  avatarImport(id: string, src: string): string {
    const dir = this.mustExist(id);
    const ext = path.extname(src).slice(1).toLowerCase();
    if (!AVATAR_TYPES[ext]) throw new Error("awatar: tylko PNG, JPG, WebP albo GIF");
    if (fs.statSync(src).size > AVATAR_MAX) throw new Error(t("bot.avatarBig", { mb: AVATAR_MAX / 1024 / 1024 }));
    for (const f of fs.readdirSync(dir)) if (AVATAR_RE.test(f)) fs.rmSync(path.join(dir, f));
    const name = `avatar.${ext}`;
    fs.copyFileSync(src, path.join(dir, name));
    return name;
  }

  /** Awatar jako data URL (strona nie czyta plików); `null` = nie ma. */
  avatar(id: string, name: string): string | null {
    const m = AVATAR_RE.exec(name);
    if (!m) return null;
    try {
      const data = fs.readFileSync(path.join(this.mustExist(id), name));
      return `data:${AVATAR_TYPES[m[1]]};base64,${data.toString("base64")}`;
    } catch {
      return null;
    }
  }

  skillDelete(id: string, name: string): void {
    const file = this.skillFile(id, name);
    fs.rmSync(path.dirname(file), { recursive: true, force: true });
  }

  /** Surowy `routines.json`; brak = `{"routines":[]}`. */
  routines(id: string): string {
    return readOr(path.join(this.mustExist(id), "routines.json"), '{"routines":[]}');
  }

  /** Zapis harmonogramu. `lastRun` zostaje późniejszy z dysku i z zapisu: karta bota otwarta
   *  przed przebiegiem nie cofnie terminu (zadanie nie ruszy drugi raz). */
  routinesSave(id: string, json: string): void {
    const dir = this.mustExist(id);
    const raw = JSON.parse(json) as { routines?: Record<string, unknown>[] };
    const r = parseRoutines(raw);
    if (r.errors.length) throw new Error(r.errors.join("; "));
    let disk: Routine[] = [];
    try {
      disk = parseRoutines(JSON.parse(this.routines(id))).routines;
    } catch {
      // zepsuty plik: nadpisujemy
    }
    for (const x of raw.routines ?? []) {
      const old = disk.find((d) => d.id === x.id)?.lastRun;
      if (old !== undefined && !(typeof x.lastRun === "number" && x.lastRun >= old)) x.lastRun = old;
    }
    writeAtomic(path.join(dir, "routines.json"), `${JSON.stringify(raw, null, 2)}\n`);
  }

  /** Rozmowy (`chats`) albo przebiegi z harmonogramu (`runs`) bota. */
  chats(id: string, kind: ChatKind): ChatStore {
    if (kind !== "chats" && kind !== "runs") throw new Error(t("bot.badKind", { kind: String(kind) }));
    return new ChatStore(path.join(this.mustExist(id), kind));
  }

  /** Zapis rozmowy bota: katalog z pola `bot`, rodzaj z `routine` (przebieg) albo bez (rozmowa). */
  chatSave(json: string): void {
    const c = parseBotChat(json);
    if (!c) throw new Error(t("bot.badChatFormat"));
    this.chats(c.bot, c.routine ? "runs" : "chats").save(json);
  }
}
