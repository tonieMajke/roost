/** Zakładka Bot (M5): model botów, pamięci, skilli i harmonogramu. Czyste funkcje,
 *  bez Reacta i IPC. Wspólne z `electron/src/bot/`. */

import { t, type Key } from "./i18n";
import { applyEvent, firstModel, freeId, parseChat, type Chat, type ChatEvent, type ModelRef, type ProviderDef, type Turn } from "./chat";

/** Grupy narzędzi, które użytkownik włącza w ustawieniach bota. */
export type ToolGroup = "web" | "read" | "write" | "bash" | "memory" | "skills";
export const TOOL_GROUPS: ToolGroup[] = ["web", "read", "write", "bash", "memory", "skills"];

export type ToolName =
  | "read_file"
  | "list_dir"
  | "grep"
  | "write_file"
  | "edit_file"
  | "bash"
  | "web_fetch"
  | "web_search"
  | "memory"
  | "history_search"
  | "skill_view"
  | "skill_create"
  | "skill_patch"
  | "bot_create"
  | "bot_update";

/** Grupa narzędzia; `creator` = tylko wbudowany Kreator. */
export const TOOL_GROUP: Record<ToolName, ToolGroup | "creator"> = {
  read_file: "read",
  list_dir: "read",
  grep: "read",
  write_file: "write",
  edit_file: "write",
  bash: "bash",
  web_fetch: "web",
  web_search: "web",
  memory: "memory",
  history_search: "memory",
  skill_view: "skills",
  skill_create: "skills",
  skill_patch: "skills",
  bot_create: "creator",
  bot_update: "creator",
};

export type Tone = "serious" | "balanced" | "playful";
const TONES: Tone[] = ["serious", "balanced", "playful"];

export type BotDef = {
  version: 1;
  id: string;
  name: string;
  avatar: { emoji?: string; image?: string }; // image: nazwa pliku w folderze bota
  color: string; // #rrggbb
  persona: string; // kim jest, do czego służy (pierwsze zdanie = powitanie)
  style: string; // jak mówi
  avoid: string; // czego unika
  tone: Tone;
  model: ModelRef | null; // null = pierwszy model z listy
  folders: string[]; // ścieżki bezwzględne, które bot może czytać bez pytania
  tools: Record<ToolGroup, boolean>;
  builtin?: "creator";
  created: number;
};

export type Schedule =
  | { kind: "every"; minutes: number } // ≥ 5
  | { kind: "daily"; at: string; days?: number[] }; // "08:00", dni 0 = niedziela

export type Routine = {
  id: string;
  name: string;
  prompt: string;
  schedule: Schedule;
  allow: { writeWork: boolean; bash: string[] }; // zgody z góry (przebieg nie ma kogo zapytać)
  enabled: boolean;
  created: number;
  lastRun?: number;
  /** Ostatnie włączenie: termin liczy się od niego, gdy jest późniejszy niż ostatni przebieg. */
  enabledAt?: number;
};

export type ApprovalDecision = "once" | "chat" | "deny";

/** Prośba narzędzia o zgodę, czekająca na kliknięcie w UI. */
export type ApprovalRequest = {
  id: string;
  bot: string;
  chat: string;
  tool: ToolName;
  /** Jedna linia do karty zgody: „Uruchomić `cargo test`?”. */
  title: string;
  /** Szczegóły pod spodem: polecenie, treść pliku, zmiana old→new, definicja bota. */
  detail?: string;
  /** Czy „Zezwalaj w tej rozmowie” ma sens (bash bez prostego prefiksu: nie). */
  canGrant: boolean;
  /** `bot_create` / `bot_update`: karta zgody pokazuje podgląd bota zamiast JSON-a. */
  preview?: BotPreview;
  at: number;
};

/** Bot po zmianie Kreatora, do podglądu w karcie zgody. */
export type BotPreview = {
  bot: BotDef;
  skills?: { name: string; description: string }[];
  routines?: { name: string; schedule: Schedule }[];
  /** `bot_update`: zmienione pola `BotDef`. */
  changed?: string[];
};

export type ToolCallRecord = {
  id: string;
  message: string; // id odpowiedzi, w której padło wywołanie
  name: string;
  args: Record<string, unknown>;
  result?: string; // skrócony do 4 KB
  error?: string;
  approval?: "auto" | ApprovalDecision;
  at?: number; // długość tekstu odpowiedzi w chwili wywołania (kolejność tekstu i kroków w historii)
};

/** Stan przebiegu z harmonogramu. `waiting_approval`: narzędzie czeka na decyzję użytkownika. */
export type RunState = "running" | "done" | "error" | "waiting_approval";
export const RUN_STATES: RunState[] = ["running", "done", "error", "waiting_approval"];
/** Trwający przebieg (zdarzenie `bot_run` z procesu głównego). */
export type RunInfo = { bot: string; routine: string; chat: string; state: RunState; started: number };

/** Rozmowa bota albo przebieg z harmonogramu (`routine` = id zadania, `state` = stan przebiegu). */
export type BotChat = Chat & { bot: string; calls: ToolCallRecord[]; routine?: string; state?: RunState; toolsUnsupported?: boolean };

export const MEMORY_LIMIT = 2200;
export const USER_LIMIT = 1400;
export const MEMORY_SEP = "\n§\n";
export const MIN_EVERY = 5;

const ALL_TOOLS: Record<ToolGroup, boolean> = { web: true, read: true, write: true, bash: true, memory: true, skills: true };
const COLOR_RE = /^#[0-9a-f]{6}$/i;
const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;
const SKILL_NAME_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const ID_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;
export const isBotId = (id: string) => ID_RE.test(id);
export const isSkillName = (name: string) => SKILL_NAME_RE.test(name) && name.length <= 64;

export const DEFAULT_COLOR = "#7c8cff";

export function newBot(id: string, now: number, patch: Partial<BotDef> = {}): BotDef {
  return {
    version: 1,
    id,
    name: t("bot.newName"),
    avatar: { emoji: "🤖" },
    color: DEFAULT_COLOR,
    persona: "",
    style: "",
    avoid: "",
    tone: "balanced",
    model: null,
    folders: [],
    tools: { ...ALL_TOOLS },
    created: now,
    ...patch,
  };
}

export const CREATOR_ID = "kreator";

// Zapisane na dysku i wysyłane modelowi: zostaje po polsku. UI pokazuje tłumaczenie (`displayName`, `botGreeting`).
const CREATOR_NAME = "Kreator";
const CREATOR_PERSONA =
  "Jestem Kreatorem: pomagam ci zbudować nowego bota albo poprawić istniejącego. " +
  "Pytam, do czego ma służyć i jaki ma mieć charakter, a potem zakładam go za twoją zgodą.";

export function creatorBot(now: number): BotDef {
  return newBot(CREATOR_ID, now, {
    name: CREATOR_NAME,
    avatar: { emoji: "🛠️" },
    color: "#e0a050",
    persona: CREATOR_PERSONA,
    style: "Krótko, rzeczowo, z konkretnymi propozycjami.",
    tools: { web: true, read: false, write: false, bash: false, memory: true, skills: false },
    builtin: "creator",
  });
}

/** Id z imienia: małe litery ASCII i myślniki, bez powtórzeń z `taken`. */
export function botId(name: string, taken: string[]): string {
  const base =
    name
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/ł/g, "l")
      .replace(/Ł/g, "L")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40)
      .replace(/-+$/, "") || "bot";
  return freeId(base, taken);
}

const str = (v: unknown, fallback = "") => (typeof v === "string" ? v : fallback);

/** `bot.json`. Złe pola = wartości domyślne opisane w `errors`; `null` gdy nie ma poprawnego id. */
export function parseBot(raw: unknown): { bot: BotDef | null; errors: string[] } {
  const errors: string[] = [];
  const r = raw as Record<string, unknown>;
  if (!r || typeof r !== "object") return { bot: null, errors: [t("bot.err.notObject")] };
  if (typeof r.id !== "string" || !ID_RE.test(r.id)) return { bot: null, errors: [t("bot.err.badId")] };
  const where = `bot ${r.id}`;
  const bot = newBot(r.id, typeof r.created === "number" ? r.created : 0);
  if (typeof r.name === "string" && r.name.trim()) bot.name = r.name.trim();
  else errors.push(t("bot.err.noName", { where }));
  const av = r.avatar as Record<string, unknown> | undefined;
  if (av && typeof av === "object") {
    const avatar: BotDef["avatar"] = {};
    if (typeof av.emoji === "string" && av.emoji) avatar.emoji = av.emoji;
    if (typeof av.image === "string" && /^[\w.-]+$/.test(av.image)) avatar.image = av.image;
    if (avatar.emoji || avatar.image) bot.avatar = avatar;
  }
  if (r.color !== undefined) {
    if (typeof r.color === "string" && COLOR_RE.test(r.color)) bot.color = r.color;
    else errors.push(t("bot.err.badColor", { where }));
  }
  bot.persona = str(r.persona);
  bot.style = str(r.style);
  bot.avoid = str(r.avoid);
  if (r.tone !== undefined) {
    if (TONES.includes(r.tone as Tone)) bot.tone = r.tone as Tone;
    else errors.push(t("bot.err.badTone", { where, tones: TONES.join(", ") }));
  }
  const m = r.model as Record<string, unknown> | null | undefined;
  if (m && typeof m.provider === "string" && typeof m.model === "string") bot.model = { provider: m.provider, model: m.model };
  else if (m != null) errors.push(t("bot.err.badModel", { where }));
  if (Array.isArray(r.folders)) {
    bot.folders = r.folders.filter((f): f is string => typeof f === "string" && f.startsWith("/"));
    if (bot.folders.length !== r.folders.length) errors.push(t("bot.err.folders", { where }));
  }
  const tl = r.tools as Record<string, unknown> | undefined;
  if (tl && typeof tl === "object") for (const g of TOOL_GROUPS) if (typeof tl[g] === "boolean") bot.tools[g] = tl[g] as boolean;
  if (r.builtin === "creator") bot.builtin = "creator";
  return { bot, errors };
}

export const serializeBot = (b: BotDef) => `${JSON.stringify(b, null, 2)}\n`;

function parseSchedule(raw: unknown): Schedule | string {
  const s = raw as Record<string, unknown>;
  if (s?.kind === "every") {
    const n = s.minutes;
    if (typeof n !== "number" || !Number.isInteger(n) || n < MIN_EVERY) return t("bot.err.minutes", { min: MIN_EVERY });
    return { kind: "every", minutes: n };
  }
  if (s?.kind === "daily") {
    if (typeof s.at !== "string" || !TIME_RE.test(s.at)) return t("bot.err.at");
    if (s.days === undefined) return { kind: "daily", at: s.at };
    if (!Array.isArray(s.days) || s.days.length === 0 || !s.days.every((d) => Number.isInteger(d) && d >= 0 && d <= 6))
      return t("bot.err.days");
    return { kind: "daily", at: s.at, days: [...new Set(s.days as number[])].sort() };
  }
  return t("bot.err.kind");
}

/** `routines.json`: `{ routines: [...] }`. Złe wpisy pominięte i opisane. */
export function parseRoutines(raw: unknown): { routines: Routine[]; errors: string[] } {
  const errors: string[] = [];
  const list = (raw as { routines?: unknown })?.routines;
  if (!Array.isArray(list)) return { routines: [], errors: raw == null ? [] : [t("bot.err.noRoutines")] };
  const routines: Routine[] = [];
  const seen = new Set<string>();
  list.forEach((r: Record<string, unknown>, i) => {
    const where = t("bot.err.routineWhere", { n: i + 1 });
    if (!r || typeof r !== "object") return void errors.push(t("bot.err.routineNotObject", { where }));
    if (typeof r.id !== "string" || !r.id || seen.has(r.id)) return void errors.push(t("bot.err.routineId", { where }));
    if (typeof r.prompt !== "string" || !r.prompt.trim()) return void errors.push(t("bot.err.routinePrompt", { where }));
    const schedule = parseSchedule(r.schedule);
    if (typeof schedule === "string") return void errors.push(`${where}: ${schedule}`);
    const a = (r.allow ?? {}) as Record<string, unknown>;
    seen.add(r.id);
    routines.push({
      id: r.id,
      name: str(r.name).trim() || r.prompt.trim().slice(0, 40),
      prompt: r.prompt,
      schedule,
      allow: {
        writeWork: a.writeWork === true,
        bash: Array.isArray(a.bash) ? a.bash.filter((p): p is string => typeof p === "string" && p.trim() !== "").map((p) => p.trim()) : [],
      },
      enabled: r.enabled !== false,
      created: typeof r.created === "number" ? r.created : 0,
      ...(typeof r.lastRun === "number" ? { lastRun: r.lastRun } : {}),
      ...(typeof r.enabledAt === "number" ? { enabledAt: r.enabledAt } : {}),
    });
  });
  return { routines, errors };
}

/** Następne uruchomienie ściśle po `after` (czas lokalny procesu). `every` liczy od `after`,
 *  czyli od ostatniego przebiegu. Godzina, której nie ma (zmiana czasu na letni), przesuwa się
 *  o godzinę do przodu; godzina powtórzona (zmiana na zimowy) uruchamia się raz. */
export function nextRun(s: Schedule, after: number): number {
  if (s.kind === "every") return after + s.minutes * 60_000;
  const [h, min] = s.at.split(":").map(Number);
  const d = new Date(after);
  for (let i = 0; i < 9; i++) {
    const c = new Date(d.getFullYear(), d.getMonth(), d.getDate() + i, h, min, 0, 0);
    if (c.getTime() > after && (!s.days || s.days.includes(c.getDay()))) return c.getTime();
  }
  return Number.POSITIVE_INFINITY; // nieosiągalne przy poprawnym `days`
}

/** Termin następnego przebiegu: od ostatniego (albo od utworzenia zadania), a po ponownym
 *  włączeniu od włączenia – zadanie włączone o 10:00 z terminem 8:00 rusza jutro, nie od razu.
 *  Ostatni przebieg „z przyszłości” (cofnięty zegar) liczy się jak teraz, żeby zadanie nie utknęło. */
export function routineNext(r: Routine, now: number): number {
  return nextRun(r.schedule, Math.min(Math.max(r.lastRun ?? r.created, r.enabledAt ?? 0), now));
}

/** Nowe zadanie z karty bota: codziennie o 8:00, włączone (użytkownik tworzy je sam). */
export function newRoutine(id: string, now: number): Routine {
  return { id, name: "", prompt: "", schedule: { kind: "daily", at: "08:00" }, allow: { writeWork: false, bash: [] }, enabled: true, created: now, enabledAt: now };
}

/** Wolne id zadania: `r1`, `r2`… */
export function freeRoutineId(list: Routine[]): string {
  let n = 1;
  while (list.some((r) => r.id === `r${n}`)) n++;
  return `r${n}`;
}

/** Przełącznik „włączone”: włączenie zapisuje chwilę, od której liczy się termin. */
export function toggleRoutine(r: Routine, enabled: boolean, now: number): Routine {
  return enabled === r.enabled ? r : { ...r, enabled, ...(enabled ? { enabledAt: now } : {}) };
}

/** Czy włączone zadanie powinno ruszyć teraz. Zaległe terminy (aplikacja zamknięta, uśpienie)
 *  dają jeden przebieg: po nim `lastRun` = teraz, więc następny termin jest już w przyszłości. */
export function routineDue(r: Routine, now: number): boolean {
  return r.enabled && routineNext(r, now) <= now;
}

/** Dostawca i model przebiegu: model bota albo pierwszy z listy (jak w zakładce). Tekst = błąd. */
export function runModel(bot: BotDef, providers: ProviderDef[]): { provider: ProviderDef; ref: ModelRef } | string {
  const ref = bot.model ?? firstModel(providers);
  if (!ref) return t("bot.err.noModel");
  const provider = providers.find((p) => p.id === ref.provider);
  // Model spoza listy dostawcy jest w porządku: modele lokalne bywają wykryte dopiero w oknie (`/models`).
  if (!provider) return t("bot.err.noProvider", { provider: ref.provider, model: ref.model });
  return { provider, ref };
}

/** Skrót dnia tygodnia (0 = niedziela). */
export const dayName = (d: number) => t(`bot.day.${d}` as Key);
const monthName = (m: number) => t(`bot.month.${m}` as Key);

/** Termin w harmonogramie: „dziś 08:00”, „jutro 08:00”, „wczoraj 08:00”, „pt 3 paź 08:00”. */
export function runWhen(at: number, now: number): string {
  const d = new Date(at);
  const hm = `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  const day = (t: number) => {
    const x = new Date(t);
    return new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  };
  const diff = Math.round((day(at) - day(now)) / 86_400_000);
  const name =
    diff === 0
      ? t("bot.when.today")
      : diff === 1
        ? t("bot.when.tomorrow")
        : diff === -1
          ? t("bot.when.yesterday")
          : t("bot.when.date", { day: dayName(d.getDay()), d: d.getDate(), month: monthName(d.getMonth()) });
  return t("bot.when.at", { day: name, time: hm });
}

/** „co 15 min”, „codziennie 08:00”, „pn–pt 08:00”, „pn, śr 08:00”. */
export function scheduleLabel(s: Schedule): string {
  if (s.kind === "every") return s.minutes % 60 === 0 ? t("bot.sched.hours", { n: s.minutes / 60 }) : t("bot.sched.minutes", { n: s.minutes });
  const d = s.days;
  if (!d || d.length === 7) return t("bot.sched.daily", { at: s.at });
  if (d.join() === "1,2,3,4,5") return t("bot.sched.weekdays", { at: s.at });
  if (d.join() === "0,6") return t("bot.sched.weekends", { at: s.at });
  const order = [...d].sort((a, b) => ((a + 6) % 7) - ((b + 6) % 7)); // od poniedziałku
  return t("bot.sched.days", { days: order.map(dayName).join(", "), at: s.at });
}

function unquote(v: string): string {
  if (/^".*"$/.test(v)) {
    try {
      return JSON.parse(v) as string;
    } catch {
      return v.slice(1, -1);
    }
  }
  return /^'.*'$/.test(v) ? v.slice(1, -1).replace(/''/g, "'") : v;
}

export type Skill = { name: string; description: string; body: string };

/** `SKILL.md`: frontmatter z `name` i `description` (pojedyncze linie, cudzysłowy opcjonalne). */
export function parseSkill(md: string): Skill | { error: string } {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(md);
  if (!m) return { error: t("bot.err.skillHeader") };
  const fields: Record<string, string> = {};
  for (const line of m[1].split(/\r?\n/)) {
    const kv = /^([a-z_-]+):\s*(.*)$/i.exec(line);
    if (kv) fields[kv[1]] = unquote(kv[2].trim());
  }
  const name = fields.name ?? "";
  if (!isSkillName(name)) return { error: t("bot.err.skillName") };
  const description = fields.description ?? "";
  if (!description) return { error: t("bot.err.skillNoDesc") };
  if (description.length > 1024) return { error: t("bot.err.skillLongDesc") };
  return { name, description, body: m[2] };
}

export function skillMarkdown(s: Skill): string {
  const desc = /[:#"']|^\s|\s$/.test(s.description) ? JSON.stringify(s.description) : s.description;
  return `---\nname: ${s.name}\ndescription: ${desc}\n---\n\n${s.body.replace(/^\n+/, "")}`;
}

export type MemoryOp = { kind: "add"; text: string } | { kind: "replace"; old: string; text: string } | { kind: "remove"; old: string };
export type MemoryResult = { ok: true; text: string } | { ok: false; error: string; text: string };

export const memoryEntries = (text: string) =>
  text
    .split(MEMORY_SEP)
    .map((e) => e.trim())
    .filter(Boolean);

const joinEntries = (entries: string[]) => entries.join(MEMORY_SEP);

/** Zmiana pamięci. Wpis wskazuje się fragmentem tekstu (`old`), który musi pasować do dokładnie
 *  jednego wpisu. Przy przekroczeniu limitu błąd zawiera całą pamięć, żeby model mógł ją skrócić. */
export function memoryEdit(text: string, op: MemoryOp, limit: number): MemoryResult {
  const entries = memoryEntries(text);
  const current = joinEntries(entries);
  const fail = (error: string): MemoryResult => ({ ok: false, error, text: current });
  let next: string[];
  if (op.kind === "add") {
    const t = op.text.trim();
    if (!t) return fail("pusty wpis");
    if (t.includes("§")) return fail("znak § jest zarezerwowany");
    if (entries.includes(t)) return { ok: true, text: current };
    next = [...entries, t];
  } else {
    const old = op.old.trim();
    if (!old) return fail("pusty `old`");
    const hits = entries.flatMap((e, i) => (e.includes(old) ? [i] : []));
    if (hits.length === 0) return fail(`żaden wpis nie zawiera „${old}”`);
    if (hits.length > 1) return fail(`„${old}” pasuje do ${hits.length} wpisów, podaj dłuższy fragment`);
    if (op.kind === "remove") next = entries.filter((_, i) => i !== hits[0]);
    else {
      const t = op.text.trim();
      if (!t) return fail("pusty wpis");
      if (t.includes("§")) return fail("znak § jest zarezerwowany");
      next = entries.map((e, i) => (i === hits[0] ? t : e));
    }
  }
  const out = joinEntries(next);
  if (out.length > limit)
    return fail(
      `po zmianie ${out.length}/${limit} znaków – za dużo. Najpierw skróć albo usuń starsze wpisy ` +
        `(replace/remove), potem dodaj nowy. Obecna pamięć (${current.length} znaków):\n${current}`,
    );
  return { ok: true, text: out };
}

const TONE_TEXT: Record<Tone, string> = {
  serious: "Ton: poważny i rzeczowy. Bez żartów i wykrzykników.",
  balanced: "Ton: naturalny, życzliwy, z umiarem w żartach.",
  playful: "Ton: luźny i zabawny. Możesz żartować, przesadzać i mieć własne zdanie – ale fakty muszą się zgadzać.",
};

const GROUP_RULES: Record<ToolGroup, string> = {
  web: "Sieć: `web_search` do aktualnych faktów, `web_fetch` do czytania stron.",
  read: "Pliki: `read_file`, `list_dir`, `grep`. Foldery użytkownika i twój katalog roboczy czytasz bez pytania, resztę za zgodą.",
  write: "Zapis: `write_file`, `edit_file`. W katalogu roboczym swobodnie, poza nim tylko za zgodą użytkownika.",
  bash: "Powłoka: `bash` (limit 120 s). Każde polecenie wymaga zgody użytkownika – pisz je krótko i czytelnie.",
  memory:
    "Pamięć: `memory` (add/replace/remove, cel `memory` = twoje notatki, `user` = kim jest użytkownik). Zapisuj trwałe fakty, " +
    "preferencje i wnioski z pracy, nie przebieg rozmowy. Zapis widać dopiero w następnej rozmowie. " +
    "`history_search` przeszukuje twoje dawne rozmowy.",
  skills:
    "Skille: przepisy na powtarzalne zadania. Zanim zaczniesz zadanie pasujące do opisu skilla, przeczytaj go (`skill_view`). " +
    "Po zadaniu, które wymagało wielu kroków albo poprawki od użytkownika, zapisz przepis (`skill_create`) " +
    "albo popraw istniejący (`skill_patch`).",
};

export type PromptContext = {
  memory: string;
  user: string;
  skills: { name: string; description: string }[];
  now: number;
  work: string; // katalog roboczy bota
  routine?: string; // nazwa zadania, gdy to przebieg z harmonogramu
  bots?: BotDef[]; // Kreator: istniejące boty (do `bot_update`)
};

const CREATOR_RULES = [
  "# Jak budujesz boty",
  "Każdy bot ma jedno zadanie. Z opisu użytkownika wyciągnij trzy rzeczy: do czego bot służy, jaki ma charakter " +
    "i czy ma coś robić cyklicznie. Czego brakuje i nie da się rozsądnie założyć, o to dopytaj: najwyżej 3 pytania " +
    "w całej rozmowie, najlepiej w jednej wiadomości. Potem decyduj sam i wołaj `bot_create` – nie pokazuj definicji tekstem, " +
    "użytkownik zobaczy podgląd karty bota przy prośbie o zgodę.",
  "Pola `bot_create`:",
  "- `name`, `emoji`, `color` (#rrggbb pasujący do charakteru), `tone`.",
  "- `persona`: 2–4 zdania w pierwszej osobie. Pierwsze zdanie to powitanie, które użytkownik zobaczy w pustej rozmowie.",
  "- `style` (jak mówi) i `avoid` (czego unika): po jednym, dwóch zdaniach.",
  "- `tools`: tylko grupy potrzebne do zadania (web, read, write, bash, memory, skills). Bot-postać do rozmowy: najwyżej `memory`.",
  "- `folders`: tylko ścieżki bezwzględne podane przez użytkownika. Nie zgaduj ich.",
  "- `skills`: startowe przepisy, gdy zadanie ma stałą procedurę (np. jak przeglądać newsy, jak oceniać kod). Krótkie, konkretne kroki.",
  "- `routines`: gdy użytkownik chce czegoś regularnie. `prompt` pisz jako polecenie dla nowego bota. Zadania powstają wyłączone, " +
    "użytkownik włącza je w karcie bota.",
  "- `model`: pomiń, chyba że użytkownik wskaże model. Bot dostanie ten, na którym teraz rozmawiasz.",
  "Po odmowie zapytaj, co zmienić. Po utworzeniu powiedz jednym, dwoma zdaniami, co bot umie, i przypomnij o włączeniu " +
    "harmonogramu, jeśli go ma.",
  "Zmiana istniejącego bota („zrób go mniej gadatliwym”): `bot_update` z `id` i tylko zmienianymi polami.",
].join("\n");

/** Prompt systemowy bota. Stała kolejność sekcji, data bez godziny: ten sam stan w ciągu dnia
 *  daje ten sam tekst co do bajtu (prefiks się nie zmienia, cache dostawcy działa). */
export function botSystemPrompt(bot: BotDef, ctx: PromptContext): string {
  const parts: string[] = [];
  parts.push(`Nazywasz się ${bot.name}.${bot.persona.trim() ? ` ${bot.persona.trim()}` : ""}`);
  if (bot.style.trim()) parts.push(`Styl wypowiedzi: ${bot.style.trim()}`);
  if (bot.avoid.trim()) parts.push(`Unikasz: ${bot.avoid.trim()}`);
  parts.push(`${TONE_TEXT[bot.tone]} Odpowiadasz w języku użytkownika, w markdownie.`);

  const groups = TOOL_GROUPS.filter((g) => bot.tools[g]);
  const tools = ["# Narzędzia", ...groups.map((g) => `- ${GROUP_RULES[g]}`)];
  if (bot.builtin === "creator") tools.push(`- Boty: \`bot_create\`, \`bot_update\` (każde wymaga zgody użytkownika).`);
  if (groups.length === 0 && !bot.builtin) tools.push("Nie masz narzędzi – tylko rozmowa.");
  else tools.push(`Katalog roboczy: ${ctx.work}`);
  if (bot.folders.length) tools.push(`Foldery użytkownika: ${bot.folders.join(", ")}`);
  tools.push("Gdy użytkownik odmówi zgody, nie próbuj obejść odmowy innym narzędziem – zapytaj, co dalej.");
  parts.push(tools.join("\n"));

  if (bot.builtin === "creator") {
    parts.push(CREATOR_RULES);
    const others = (ctx.bots ?? []).filter((b) => !b.builtin).sort((a, b) => a.id.localeCompare(b.id));
    parts.push(["# Istniejące boty", ...(others.length ? others.map((b) => `- ${b.id}: ${b.name} – ${botGreeting(b)}`) : ["(jeszcze żadnych)"])].join("\n"));
  }

  if (bot.tools.memory) {
    const block = (title: string, text: string, limit: number) => {
      const t = joinEntries(memoryEntries(text));
      const pct = Math.round((t.length / limit) * 100);
      return `# ${title} [${pct}% – ${t.length}/${limit} znaków]\n${t || "(pusto)"}`;
    };
    parts.push(block("Pamięć", ctx.memory, MEMORY_LIMIT));
    parts.push(block("Użytkownik", ctx.user, USER_LIMIT));
  }
  if (bot.tools.skills) {
    const list = [...ctx.skills].sort((a, b) => a.name.localeCompare(b.name));
    parts.push(["# Skille", ...(list.length ? list.map((s) => `- ${s.name}: ${s.description}`) : ["(jeszcze żadnych)"])].join("\n"));
  }
  if (ctx.routine)
    parts.push(
      `# Zadanie z harmonogramu: ${ctx.routine}\nUżytkownika nie ma przy komputerze. Wykonaj zadanie i zakończ krótkim ` +
        "podsumowaniem (pierwsze zdanie trafi do powiadomienia). Nie zadawaj pytań.",
    );
  const d = new Date(ctx.now);
  const date = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  parts.push(`Dzisiaj: ${date}.`);
  return parts.join("\n\n");
}

/** Pierwsze zdanie tekstu (powitanie, powiadomienie). */
export function firstSentence(text: string): string {
  const t = text.trim();
  const m = /^.*?[.!?…](?=\s|$)/s.exec(t);
  return (m ? m[0] : t).trim();
}

/** Pierwsze zdanie opisu bota (powitanie bez wywołania modelu). */
export function botGreeting(bot: BotDef): string {
  const p = bot.persona.trim();
  if (bot.builtin === "creator" && p === CREATOR_PERSONA) return t("bot.creator.greeting");
  return p ? firstSentence(p) : t("bot.greeting.default", { name: displayName(bot) });
}

/** Imię do pokazania w UI: wbudowany Kreator z domyślnym imieniem jest tłumaczony. */
export function displayName(bot: BotDef): string {
  return bot.builtin === "creator" && bot.name === CREATOR_NAME ? t("bot.creator.name") : bot.name;
}

/** Powiadomienie po przebiegu: pierwsze zdanie wyniku (bez markdownu), błąd albo prośba o zgodę. */
export function runNotice(botName: string, run: BotChat): { title: string; body: string } | null {
  const title = `${botName}: ${run.title || t("bot.notice.defaultTitle")}`;
  const reply = [...run.messages].reverse().find((m) => m.role === "assistant");
  if (run.state === "waiting_approval") return { title, body: t("bot.notice.waiting") };
  if (run.state === "error") return { title, body: t("bot.notice.failed", { error: reply?.error ?? t("bot.notice.errorFallback") }) };
  if (run.state !== "done") return null;
  const plain = (reply?.text ?? "")
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/^#+\s*/gm, "")
    .replace(/^\s*([-*+]|\d+\.)\s+/gm, "")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/[*_`>]/g, "")
    .replace(/\s+/g, " ");
  const first = firstSentence(plain);
  return { title, body: first.length > 200 ? `${first.slice(0, 199)}…` : first || t("bot.notice.done") };
}

export type ApprovalContext = {
  bot: BotDef;
  work: string; // realpath katalogu roboczego
  folders: string[]; // realpath folderów bota
  /** Zgody „w tej rozmowie”: narzędzie + (dla bash) prefiks polecenia albo (dla narzędzi plikowych)
   *  katalog, w którym zgoda obowiązuje. Zgoda plikowa bez `dir` nie działa (bezpieczniej: pytamy ponownie). */
  grants: { tool: ToolName; prefix?: string; dir?: string }[];
  /** Przebieg z harmonogramu: zgody z góry zamiast pytania. */
  routine?: Routine["allow"];
};

export type Verdict = "allow" | "ask" | "deny";

export const isInside = (p: string, dir: string) => p === dir || p.startsWith(dir.endsWith("/") ? dir : `${dir}/`);

/** Polecenie, które da się porównać z prefiksem: bez łączenia poleceń, przekierowań i podstawień. */
const PLAIN_CMD = /^[^;&|`$<>\n\r\\(){}]*$/;

/** Interpretery i launchery: prefiks `python` przepuściłby `python -c ...`, `env`/`xargs`/`find`/`sed`/`awk`
 *  uruchamiają dowolny kod. Dla nich zgoda „w tej rozmowie” i `routine.allow.bash` dotyczą tylko
 *  dokładnie tego samego polecenia (nie prefiksu). `sed` i `awk` też: `sed 'e ...'`, `awk 'BEGIN{system()}'`. */
const NO_PREFIX_PROGRAMS = new Set([
  "sh", "bash", "zsh", "fish", "dash", "ash", "ksh", "csh", "tcsh", "node", "nodejs", "deno", "bun", "bunx", "npx", "pnpx",
  "perl", "ruby", "php", "luajit", "tclsh", "rscript", "osascript", "pwsh", "powershell", "env", "xargs", "find", "awk", "gawk",
  "mawk", "nawk", "sed", "ssh", "scp", "sftp", "rsync", "sudo", "doas", "su", "eval", "exec", "nohup", "time", "timeout", "nice",
  "ionice", "watch", "busybox", "setsid", "stdbuf", "command", "builtin", "source", ".", "docker", "podman", "vi", "vim", "nvim",
  "nano", "emacs", "less", "more", "man",
]);
const NO_PREFIX_PATTERN = /^(python|pypy|lua)[\d.]*$/;
/** Menedżery pakietów: `run`/`exec`/`dlx`/nazwa skryptu = dowolny kod, więc prefiks tylko dla znanych podpoleceń. */
const PM_PROGRAMS = new Set(["npm", "pnpm", "yarn"]);
const PM_SAFE_SUB = new Set(["install", "i", "ci", "add", "remove", "rm", "uninstall", "update", "up", "list", "ls", "outdated", "audit", "view", "info", "why", "test"]);
/** Opcje gita uruchamiające dowolne polecenie albo zmieniające konfigurację (`-c core.sshCommand=...`). */
const GIT_DANGEROUS_LONG = ["--upload-pack", "--receive-pack", "--exec", "--exec-path", "--config", "--config-env", "--template", "--ext-cmd"];

const stripQuotes = (w: string) => w.replace(/['"]/g, "");
const programName = (w: string) => stripQuotes(w).replace(/^.*\//, "").toLowerCase();

/** Czy opcja gita (po zdjęciu cudzysłowów) jest niebezpieczna; długie opcje także w skrócie (`--upload-p`). */
function gitDangerousArg(raw: string): boolean {
  const w = stripQuotes(raw);
  if (w === "-c" || /^-c./.test(w) || w === "-x") return true;
  const name = w.split("=")[0];
  return name.startsWith("--") && name.length >= 3 && GIT_DANGEROUS_LONG.some((d) => d.startsWith(name));
}

/** Czy dla tego prefiksu zgoda może obejmować kolejne polecenia (a nie tylko dokładnie to samo). */
function prefixGrantable(prefix: string): boolean {
  const words = prefix.trim().split(/\s+/);
  const first = words[0] ?? "";
  if (!first || first.includes("=") || /['"]/.test(first)) return false; // `FOO=1 cmd`, cytowany program
  const prog = programName(first);
  if (NO_PREFIX_PROGRAMS.has(prog) || NO_PREFIX_PATTERN.test(prog)) return false;
  if (PM_PROGRAMS.has(prog)) return words.length > 1 && PM_SAFE_SUB.has(words[1]);
  if (prog === "git") return words.length > 1 && /^[a-z][\w-]*$/i.test(words[1]);
  return true;
}

/** Prefiks do „zezwalaj w tej rozmowie”: program i podpolecenie (`cargo test`, `git pull`).
 *  `null` = brak prefiksu (łączenie poleceń, interpreter/launcher): UI nie oferuje zgody w rozmowie. */
export function commandPrefix(cmd: string): string | null {
  const c = cmd.trim();
  if (!c || !PLAIN_CMD.test(c)) return null;
  const words = c.split(/\s+/);
  const prefix = words.length > 1 && /^[a-z][\w-]*$/i.test(words[1]) ? `${words[0]} ${words[1]}` : words[0];
  return prefixGrantable(prefix) ? prefix : null;
}

/** Polecenie pasuje do prefiksu na granicy słowa i nie dokleja niczego przez `;`, `|`, `$()` itp.
 *  Prefiks niegrantowalny (interpreter, launcher) pasuje tylko do identycznego polecenia;
 *  dla `git` argumenty `-c`, `--upload-pack` itd. nie przechodzą. */
export function matchesPrefix(cmd: string, prefix: string): boolean {
  if (!PLAIN_CMD.test(cmd)) return false; // przed normalizacją: nowa linia też łączy polecenia
  const c = cmd.trim().replace(/[ \t]+/g, " ");
  const p = prefix.trim().replace(/[ \t]+/g, " ");
  if (!p) return false;
  if (!prefixGrantable(p)) return c === p;
  if (!(c === p || c.startsWith(`${p} `))) return false;
  if (programName(p.split(" ")[0]) === "git" && c.slice(p.length).split(" ").some(gitDangerousArg)) return false;
  return true;
}

/** Czy wywołanie wymaga zgody. Ścieżki w `args.path` przychodzą już po `realpath`
 *  (dla nieistniejącego pliku: realpath folderu nadrzędnego + nazwa). */
export function needsApproval(tool: ToolName, args: Record<string, unknown>, ctx: ApprovalContext): Verdict {
  const group = TOOL_GROUP[tool];
  if (group === "creator") return ctx.bot.builtin === "creator" ? (ctx.routine ? "deny" : "ask") : "deny";
  if (!ctx.bot.tools[group]) return "deny";
  // Zgoda na narzędzie; dla bash tylko z prefiksem pasującym do polecenia.
  const granted = (cmd?: string, file?: string) =>
    ctx.grants.some(
      (g) =>
        g.tool === tool &&
        (cmd !== undefined
          ? g.prefix !== undefined && matchesPrefix(cmd, g.prefix)
          : file === undefined || (g.dir !== undefined && isInside(file, g.dir))),
    );
  const path = typeof args.path === "string" ? args.path : null;
  switch (group) {
    case "web":
    case "memory":
    case "skills":
      return "allow";
    case "read": {
      if (path === null) return "ask";
      if (isInside(path, ctx.work) || ctx.folders.some((f) => isInside(path, f))) return "allow";
      return granted(undefined, path) ? "allow" : "ask";
    }
    case "write": {
      if (path === null) return "ask";
      if (isInside(path, ctx.work)) return !ctx.routine || ctx.routine.writeWork ? "allow" : "ask";
      return !ctx.routine && granted(undefined, path) ? "allow" : "ask";
    }
    case "bash": {
      const cmd = typeof args.command === "string" ? args.command : "";
      if (ctx.routine) return ctx.routine.bash.some((p) => matchesPrefix(cmd, p)) ? "allow" : "ask";
      return granted(cmd) ? "allow" : "ask";
    }
  }
}

export function newBotChat(id: string, bot: string, now: number, model: ModelRef, routine?: string): BotChat {
  return { version: 1, id, bot, title: "", created: now, updated: now, model, search: false, messages: [], cli: {}, calls: [], ...(routine ? { routine } : {}) };
}

/** Plik rozmowy bota; `null` = nie da się odczytać. */
export function parseBotChat(text: string): BotChat | null {
  const c = parseChat(text) as (Chat & Partial<BotChat>) | null;
  if (!c || typeof c.bot !== "string") return null;
  const { state, ...rest } = c;
  return { ...rest, bot: c.bot, calls: Array.isArray(c.calls) ? c.calls : [], ...(RUN_STATES.includes(state as RunState) ? { state } : {}) };
}

export const RESULT_LIMIT = 4096;
const STOPPED_RESULT = "przerwane (Stop)";

/** Historia rozmowy bota dla pętli narzędzi: odpowiedź z wywołaniami rozpada się na kroki
 *  (tekst do chwili wywołania + wywołania, wyniki, dalszy tekst). Odpowiedzi z błędem wypadają
 *  razem z wywołaniami, jak w `wireHistory`; wywołanie bez wyniku dostaje „przerwane”. */
export function botTurns(chat: BotChat): Turn[] {
  const out: Turn[] = [];
  const push = (t: Turn) => {
    const last = out[out.length - 1];
    if (t.role !== "tool" && last?.role === t.role && !(last.role === "assistant" && last.calls?.length)) {
      last.content = [last.content, t.content].filter(Boolean).join("\n\n");
      if (t.role === "assistant" && t.calls?.length && last.role === "assistant") last.calls = t.calls;
    } else out.push(t);
  };
  for (const m of chat.messages) {
    if (m.role === "user") {
      push({ role: "user", content: m.text });
      continue;
    }
    if (m.error) continue;
    const steps = new Map<number, ToolCallRecord[]>();
    for (const c of chat.calls) {
      if (c.message !== m.id) continue;
      const at = Math.min(c.at ?? 0, m.text.length);
      steps.set(at, [...(steps.get(at) ?? []), c]);
    }
    let pos = 0;
    for (const at of [...steps.keys()].sort((a, b) => a - b)) {
      const calls = steps.get(at)!;
      push({ role: "assistant", content: m.text.slice(pos, at).trim(), calls: calls.map((c) => ({ id: c.id, name: c.name, args: c.args })) });
      for (const c of calls)
        out.push({ role: "tool", id: c.id, content: c.error ?? c.result ?? STOPPED_RESULT, ...(c.error !== undefined || c.result === undefined ? { error: true } : {}) });
      pos = at;
    }
    const rest = m.text.slice(pos).trim();
    if (rest) push({ role: "assistant", content: rest });
  }
  return out;
}

/** Zdarzenie strumienia dopisane do rozmowy bota: tekst do odpowiedzi `messageId`,
 *  wywołania i wyniki do `calls`, brak obsługi narzędzi do flagi. */
export function applyBotEvent(chat: BotChat, messageId: string, e: ChatEvent): BotChat {
  const msg = chat.messages.find((m) => m.id === messageId);
  if (!msg) return chat;
  switch (e.type) {
    case "tool_call":
      return { ...chat, calls: [...chat.calls, { id: e.id, message: messageId, name: e.name, args: e.args, at: msg.text.length }] };
    case "tool_result": {
      // Od końca: id od serwerów lokalnych potrafią się powtarzać między odpowiedziami.
      let i = chat.calls.length - 1;
      while (i >= 0 && !(chat.calls[i].id === e.id && chat.calls[i].message === messageId)) i--;
      if (i < 0) return chat;
      const rec: ToolCallRecord = { ...chat.calls[i], approval: e.approval };
      if (e.error) rec.error = e.text;
      else rec.result = e.text;
      return { ...chat, calls: chat.calls.map((c, j) => (j === i ? rec : c)) };
    }
    case "tools_unsupported":
      return { ...chat, toolsUnsupported: true };
    default:
      return { ...chat, messages: chat.messages.map((m) => (m === msg ? applyEvent(m, e) : m)) };
  }
}

/** Wynik narzędzia do zapisu w rozmowie: ≤ 4 KB, z informacją o ucięciu. */
export function clipResult(text: string, limit = RESULT_LIMIT): string {
  if (text.length <= limit) return text;
  return `${text.slice(0, limit)}\n… [ucięte, ${text.length - limit} znaków więcej]`;
}

/** Ścieżka do karty: ostatnie dwa człony („src/main.rs”), żeby wiersz się mieścił. */
export function shortPath(p: string): string {
  const parts = p.replace(/\/+$/, "").split("/").filter(Boolean);
  if (parts.length <= 2) return p || ".";
  return `…/${parts.slice(-2).join("/")}`;
}

const arg = (a: Record<string, unknown>, k: string) => (typeof a[k] === "string" ? (a[k] as string) : "");
const oneLine = (t: string, max = 60) => {
  const l = t.trim().split("\n")[0];
  return l.length > max ? `${l.slice(0, max - 1)}…` : l;
};

/** Zwinięta karta narzędzia jednym wierszem: „Czyta `src/main.rs`”, „Uruchamia `cargo test`”.
 *  Fragmenty w backtickach UI pokazuje jako kod. */
export function toolLabel(name: string, args: Record<string, unknown>): string {
  const p = shortPath(arg(args, "path"));
  switch (name) {
    case "read_file":
      return t("bot.tool.read_file", { p });
    case "list_dir":
      return t("bot.tool.list_dir", { p: arg(args, "path") ? p : "." });
    case "grep":
      return t(arg(args, "path") ? "bot.tool.grepIn" : "bot.tool.grep", { pattern: oneLine(arg(args, "pattern"), 40), p });
    case "write_file":
      return t("bot.tool.write_file", { p });
    case "edit_file":
      return t("bot.tool.edit_file", { p });
    case "bash":
      return t("bot.tool.bash", { cmd: oneLine(arg(args, "command")) });
    case "web_search":
      return t("bot.tool.web_search", { query: oneLine(arg(args, "query")) });
    case "web_fetch": {
      const u = arg(args, "url");
      let host = u;
      try {
        host = new URL(u).hostname.replace(/^www\./, "");
      } catch {
        // nie URL: cały tekst
      }
      return t("bot.tool.web_fetch", { host });
    }
    case "memory":
      return t(arg(args, "target") === "user" ? "bot.tool.memory.user" : "bot.tool.memory.self");
    case "history_search":
      return t("bot.tool.history_search", { query: oneLine(arg(args, "query"), 40) });
    case "skill_view":
      return t("bot.tool.skill_view", { name: arg(args, "name") });
    case "skill_create":
      return t("bot.tool.skill_create", { name: arg(args, "name") });
    case "skill_patch":
      return t("bot.tool.skill_patch", { name: arg(args, "name") });
    case "bot_create":
      return t("bot.tool.bot_create", { name: arg(args, "name") });
    case "bot_update":
      return t("bot.tool.bot_update", { id: arg(args, "id") });
    default:
      return t("bot.tool.other", { name });
  }
}

/** Bot utworzony tym wywołaniem `bot_create` (id z wyniku narzędzia), do przycisku „Porozmawiaj z …”. */
export function createdBot(call: ToolCallRecord): { id: string; name: string } | null {
  if (call.name !== "bot_create" || call.error !== undefined || !call.result) return null;
  const m = /^utworzono bota „(.*)” \(id: ([a-z0-9-]+)\)/.exec(call.result);
  return m ? { id: m[2], name: m[1] } : null;
}

export type Segment = { kind: "text"; text: string } | { kind: "calls"; calls: ToolCallRecord[] };

/** Odpowiedź do pokazania: tekst pocięty w miejscach wywołań (`at`), wywołania jednego kroku razem. */
export function messageSegments(text: string, calls: ToolCallRecord[]): Segment[] {
  const out: Segment[] = [];
  let pos = 0;
  const steps = new Map<number, ToolCallRecord[]>();
  for (const c of calls) {
    const at = Math.min(c.at ?? 0, text.length);
    steps.set(at, [...(steps.get(at) ?? []), c]);
  }
  for (const at of [...steps.keys()].sort((a, b) => a - b)) {
    const t = text.slice(pos, at);
    if (t.trim()) out.push({ kind: "text", text: t });
    out.push({ kind: "calls", calls: steps.get(at)! });
    pos = at;
  }
  const rest = text.slice(pos);
  if (rest.trim() || out.length === 0) out.push({ kind: "text", text: rest });
  return out;
}
