//! Boty zakładki Bot na dysku: `<configDir>/bots/<id>/` z `bot.json`, pamięcią, skillami,
//! harmonogramem, rozmowami (`chats/`), przebiegami (`runs/`) i katalogiem roboczym (`work/`).
//! Usunięty bot trafia do `bots-trash/`, nie jest kasowany.

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
} from "../../../src/bot";
import { writeAtomic } from "../config";
import { ChatStore } from "../chat/store";

export type MemoryTarget = "memory" | "user";
export type ChatKind = "chats" | "runs";
export type SkillMeta = { name: string; description: string; updated: number; error?: string };

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
    if (!isBotId(id)) throw new Error(`złe id bota: ${id}`);
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
        else if (r.bot) errors.push(`${file}: id \`${r.bot.id}\` nie zgadza się z katalogiem`);
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
    if (!bot) throw new Error("zły format bota");
    if (bot.builtin) throw new Error("wbudowanego bota nie da się utworzyć drugi raz");
    if (fs.existsSync(this.dir(bot.id))) throw new Error(`bot „${bot.id}” już istnieje`);
    this.write(bot);
    return bot;
  }

  /** Zmiana istniejącego bota; `builtin` i `created` zostają z dysku. */
  save(json: string): BotDef {
    const { bot } = parseBot(JSON.parse(json));
    if (!bot) throw new Error("zły format bota");
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
    if (this.load(id)?.builtin) throw new Error("wbudowanego bota nie da się usunąć");
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
    if (!m) throw new Error(`nieznana pamięć: ${String(target)}`);
    if (text.length > m.limit) throw new Error(`pamięć „${target}”: ${text.length}/${m.limit} znaków – za dużo`);
    writeAtomic(path.join(dir, m.file), text);
  }

  private skillsDir(id: string): string {
    return path.join(this.mustExist(id), "skills");
  }

  private skillFile(id: string, name: string): string {
    if (!isSkillName(name)) throw new Error(`zła nazwa skilla: ${name}`);
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
      const s = parseSkill(text);
      if ("error" in s) out.push({ name, description: "", updated, error: s.error });
      else if (s.name !== name) out.push({ name, description: s.description, updated, error: `\`name: ${s.name}\` ≠ katalog \`${name}\`` });
      else out.push({ name, description: s.description, updated });
    }
    return out;
  }

  /** Treść `SKILL.md`; `null` = nie ma. */
  skill(id: string, name: string): string | null {
    return readOr(this.skillFile(id, name), "") || null;
  }

  /** Zapis skilla; nazwa z frontmattera wyznacza katalog. */
  skillSave(id: string, md: string): string {
    const s = parseSkill(md);
    if ("error" in s) throw new Error(`SKILL.md: ${s.error}`);
    const file = this.skillFile(id, s.name);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    writeAtomic(file, md);
    return s.name;
  }

  skillDelete(id: string, name: string): void {
    const file = this.skillFile(id, name);
    fs.rmSync(path.dirname(file), { recursive: true, force: true });
  }

  /** Surowy `routines.json`; brak = `{"routines":[]}`. */
  routines(id: string): string {
    return readOr(path.join(this.mustExist(id), "routines.json"), '{"routines":[]}');
  }

  routinesSave(id: string, json: string): void {
    const dir = this.mustExist(id);
    const r = parseRoutines(JSON.parse(json));
    if (r.errors.length) throw new Error(r.errors.join("; "));
    writeAtomic(path.join(dir, "routines.json"), json);
  }

  /** Rozmowy (`chats`) albo przebiegi z harmonogramu (`runs`) bota. */
  chats(id: string, kind: ChatKind): ChatStore {
    if (kind !== "chats" && kind !== "runs") throw new Error(`nieznany rodzaj rozmów: ${String(kind)}`);
    return new ChatStore(path.join(this.mustExist(id), kind));
  }

  /** Zapis rozmowy bota: katalog z pola `bot`, rodzaj z `routine` (przebieg) albo bez (rozmowa). */
  chatSave(json: string): void {
    const c = parseBotChat(json);
    if (!c) throw new Error("zły format rozmowy bota");
    this.chats(c.bot, c.routine ? "runs" : "chats").save(json);
  }
}
