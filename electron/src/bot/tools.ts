//! Narzędzia botów: jeden rejestr dla wszystkich dostawców (pętla HTTP z etapu 4 i serwer
//! MCP dla claude/codex z etapu 5). Tu zapada decyzja o zgodzie (`needsApproval`) i tu
//! narzędzie czeka na kliknięcie w UI – dlatego działa tak samo przy każdym modelu.

import { t } from "../i18n";
import fs from "node:fs";
import path from "node:path";
import {
  botId,
  commandPrefix,
  isInside,
  isSensitivePath,
  containsSensitiveRoot,
  commandTouchesSensitive,
  SENSITIVE_GLOBS,
  type SensitiveEnv,
  isSkillName,
  MEMORY_LIMIT,
  memoryEdit,
  fetchRisk,
  needsApproval,
  newBot,
  parseBot,
  parseBotChat,
  parseRoutines,
  parseSkill,
  serializeBot,
  skillMarkdown,
  TOOL_GROUP,
  TOOL_GROUPS,
  USER_LIMIT,
  type ApprovalDecision,
  type BotDef,
  type BotPreview,
  type MemoryOp,
  type Routine,
  type ToolGroup,
  type ToolName,
} from "../../../src/bot";
import type { ModelRef } from "../../../src/chat";
import os from "node:os";
import { configDir, legacyConfigDir } from "../config";
import { expand } from "../env";
import type { ApprovalBroker } from "./approvals";
import { runProc } from "./proc";
import type { BotStore, ChatKind } from "./store";
import { type FetchOpts, webFetch, webSearch } from "./web";

export type JsonSchema = Record<string, unknown>;
export type ToolDef = { name: ToolName; description: string; parameters: JsonSchema };
/** `prefix`: bash; `dir`: narzędzia plikowe (realpath katalogu, poza którym zgoda nie działa). */
export type Grant = { tool: ToolName; prefix?: string; dir?: string };

/** Katalog zgody „w tej rozmowie” dla narzędzia plikowego (ścieżka po realpath); `null` = nie da się zawęzić
 *  (np. plik w `/`), wtedy zgoda w rozmowie nie jest oferowana. */
function grantDir(tool: ToolName, p: string): string | null {
  let dir = path.dirname(p);
  if (tool === "list_dir" || tool === "grep") {
    try {
      if (fs.statSync(p).isDirectory()) dir = p;
    } catch {
      /* nieistniejąca: dirname */
    }
  }
  return dir === path.parse(dir).root ? null : dir;
}

export type ToolContext = {
  store: BotStore;
  bot: BotDef;
  chat: string;
  broker: ApprovalBroker;
  /** Zgody „w tej rozmowie”; narzędzie dopisuje nowe (właściciel trzyma listę per rozmowa). */
  grants: Grant[];
  /** Przebieg z harmonogramu: zgody z góry. */
  routine?: Routine["allow"];
  signal: AbortSignal;
  /** Model rozmowy: bot z `bot_create` bez `model` dostaje ten sam. */
  model?: ModelRef;
  web?: { search(q: string, signal: AbortSignal): Promise<string>; fetch(url: string, signal: AbortSignal, opts?: FetchOpts): Promise<string> };
  now?: () => number;
  /** Nadpisanie rozpoznawania ścieżek wrażliwych (testy); domyślnie `$HOME` i katalogi konfiguracji aplikacji. */
  sensitive?: SensitiveEnv;
};

export type ToolOutcome = { ok: boolean; text: string; approval: "auto" | ApprovalDecision };

export const BASH_TIMEOUT = 120_000;
export const BASH_MAX = 64 * 1024;
const READ_MAX_FILE = 5_000_000;
const READ_LINES = 400;
const LINE_MAX = 500;
const LIST_MAX = 500;
const WRITE_MAX = 1_000_000;
const DETAIL_MAX = 4000;

const obj = (properties: Record<string, JsonSchema>, required: string[] = []): JsonSchema => ({
  type: "object",
  properties,
  required,
  additionalProperties: false,
});
const s = (description: string): JsonSchema => ({ type: "string", description });
const n = (description: string): JsonSchema => ({ type: "integer", description });

const BOT_FIELDS: Record<string, JsonSchema> = {
  name: s("Imię bota"),
  emoji: s("Awatar: jedno emoji"),
  color: s("Kolor #rrggbb"),
  persona: s("Kim jest i do czego służy; pierwsze zdanie to jego powitanie"),
  style: s("Jak mówi"),
  avoid: s("Czego unika"),
  tone: { type: "string", enum: ["serious", "balanced", "playful"] },
  tools: { type: "array", items: { type: "string", enum: TOOL_GROUPS }, description: "Włączone grupy narzędzi" },
  folders: { type: "array", items: { type: "string" }, description: "Foldery użytkownika (ścieżki bezwzględne), które bot czyta bez pytania" },
  model: obj({ provider: s("id dostawcy"), model: s("id modelu") }, ["provider", "model"]),
};

const SKILL_ITEM = obj({ name: s("nazwa: małe litery, cyfry, myślniki"), description: s("kiedy go użyć"), body: s("treść w markdownie") }, ["name", "description", "body"]);

export const TOOL_DEFS: ToolDef[] = [
  {
    name: "read_file",
    description: "Czyta plik tekstowy z numerami linii. Ścieżka względna = względem katalogu roboczego.",
    parameters: obj({ path: s("ścieżka"), offset: n("pierwsza linia (od 1)"), limit: n(`liczba linii (domyślnie ${READ_LINES})`) }, ["path"]),
  },
  { name: "list_dir", description: "Lista plików i folderów (foldery z / na końcu).", parameters: obj({ path: s("ścieżka; domyślnie katalog roboczy") }) },
  {
    name: "grep",
    description: "Szuka wyrażenia regularnego w plikach (ripgrep). Zwraca plik:linia:tekst.",
    parameters: obj({ pattern: s("wyrażenie regularne"), path: s("plik albo folder; domyślnie katalog roboczy"), glob: s("filtr plików, np. *.rs") }, ["pattern"]),
  },
  { name: "write_file", description: "Zapisuje cały plik (tworzy foldery po drodze).", parameters: obj({ path: s("ścieżka"), content: s("pełna treść") }, ["path", "content"]) },
  {
    name: "edit_file",
    description: "Zamienia dokładny fragment pliku. `old` musi wystąpić dokładnie raz, chyba że `all`.",
    parameters: obj({ path: s("ścieżka"), old: s("dokładny tekst do zamiany"), new: s("nowy tekst"), all: { type: "boolean", description: "zamień wszystkie wystąpienia" } }, ["path", "old", "new"]),
  },
  {
    name: "bash",
    description: `Uruchamia polecenie w /bin/sh (limit ${BASH_TIMEOUT / 1000} s, wyjście do 64 KB). Procesy w tle giną po zakończeniu polecenia.`,
    parameters: obj({ command: s("polecenie"), cwd: s("katalog; domyślnie katalog roboczy") }, ["command"]),
  },
  { name: "web_search", description: "Wyszukiwanie w sieci: tytuły, adresy i fragmenty.", parameters: obj({ query: s("zapytanie") }, ["query"]) },
  { name: "web_fetch", description: "Pobiera stronę jako tekst (do 30 KB).", parameters: obj({ url: s("adres http(s)") }, ["url"]) },
  {
    name: "memory",
    description:
      "Trwała pamięć między rozmowami. target `memory` = twoje notatki, `user` = kim jest użytkownik. " +
      "add: nowy wpis; replace/remove: wpis wskazany fragmentem `old`. Zmiana widoczna od następnej rozmowy.",
    parameters: obj(
      { action: { type: "string", enum: ["add", "replace", "remove"] }, target: { type: "string", enum: ["memory", "user"] }, text: s("treść wpisu (add, replace)"), old: s("fragment istniejącego wpisu (replace, remove)") },
      ["action", "target"],
    ),
  },
  { name: "history_search", description: "Szuka tekstu w twoich dawnych rozmowach i przebiegach.", parameters: obj({ query: s("szukany tekst") }, ["query"]) },
  { name: "skill_view", description: "Czyta pełną treść skilla.", parameters: obj({ name: s("nazwa skilla") }, ["name"]) },
  {
    name: "skill_create",
    description: "Zapisuje nowy skill: przepis na powtarzalne zadanie (kroki, pułapki, przykłady).",
    parameters: obj({ name: s("nazwa: małe litery, cyfry, myślniki"), description: s("jedno zdanie: kiedy go użyć"), body: s("treść w markdownie") }, ["name", "description", "body"]),
  },
  {
    name: "skill_patch",
    description: "Poprawia skill: zamienia dokładny fragment `old` (raz) na `new`.",
    parameters: obj({ name: s("nazwa skilla"), old: s("dokładny tekst"), new: s("nowy tekst") }, ["name", "old", "new"]),
  },
  {
    name: "bot_create",
    description: "Tworzy nowego bota (za zgodą użytkownika). Zadania z harmonogramu powstają wyłączone.",
    parameters: obj(
      {
        ...BOT_FIELDS,
        skills: { type: "array", items: SKILL_ITEM, description: "startowe skille" },
        routines: {
          type: "array",
          description: "zadania cykliczne",
          items: obj(
            {
              name: s("nazwa"),
              prompt: s("polecenie dla bota"),
              schedule: {
                description: '{"kind":"every","minutes":60} albo {"kind":"daily","at":"08:00","days":[1,2,3,4,5]} (0 = niedziela)',
                type: "object",
              },
            },
            ["name", "prompt", "schedule"],
          ),
        },
      },
      ["name", "persona"],
    ),
  },
  {
    name: "bot_update",
    description: "Zmienia istniejącego bota (za zgodą użytkownika). Podaj tylko zmieniane pola.",
    parameters: obj({ id: s("id bota"), ...BOT_FIELDS }, ["id"]),
  },
];

/** Narzędzia, które dostaje ten bot (włączone grupy; Kreator dodatkowo swoje). */
export function toolDefs(bot: BotDef): ToolDef[] {
  return TOOL_DEFS.filter((t) => {
    const g = TOOL_GROUP[t.name];
    return g === "creator" ? bot.builtin === "creator" : bot.tools[g];
  });
}

/** Ścieżka po `realpath`: `~` i ścieżki względne (względem `work`), dowiązania rozwinięte.
 *  Dla nieistniejącego pliku: realpath najbliższego istniejącego przodka + reszta. */
export function resolvePath(p: string, work: string): string {
  const abs = path.resolve(p.startsWith("~") ? expand(p) : path.isAbsolute(p) ? p : path.join(work, p));
  const rest: string[] = [];
  let cur = abs;
  for (;;) {
    try {
      return path.join(fs.realpathSync(cur), ...rest);
    } catch {
      const parent = path.dirname(cur);
      if (parent === cur) return abs;
      rest.unshift(path.basename(cur));
      cur = parent;
    }
  }
}

const clip = (t: string, max = DETAIL_MAX) => (t.length > max ? `${t.slice(0, max)}\n… [${t.length - max} znaków więcej]` : t);
const str = (v: unknown) => (typeof v === "string" ? v : undefined);

class ToolError extends Error {}
const fail = (msg: string): never => {
  throw new ToolError(msg);
};
const need = (args: Record<string, unknown>, key: string): string => {
  const v = args[key];
  if (typeof v !== "string" || v === "") fail(`brak argumentu \`${key}\``);
  return v as string;
};

/** Opis prośby o zgodę (karta w UI). */
function approvalText(tool: ToolName, a: Record<string, unknown>, ctx: ToolContext, plan?: CreatorPlan): { title: string; detail?: string; preview?: BotPreview } {
  const p = str(a.path) ?? "";
  switch (tool) {
    case "read_file":
      return { title: t("appr.read", { p }) };
    case "list_dir":
      return { title: t("appr.list", { p }) };
    case "grep":
      return { title: t("appr.grep", { p }), detail: t("appr.pattern", { pattern: str(a.pattern) ?? "" }) };
    case "write_file":
      return { title: t(fs.existsSync(p) ? "appr.overwrite" : "appr.create", { p }), detail: clip(str(a.content) ?? "") };
    case "edit_file": {
      const diff = (pre: string, t: string) => t.split("\n").map((l) => `${pre} ${l}`).join("\n");
      return { title: t("appr.edit", { p }), detail: clip(`${diff("-", str(a.old) ?? "")}\n${diff("+", str(a.new) ?? "")}`) };
    }
    case "web_fetch": {
      const url = str(a.url) ?? "";
      const why = fetchRisk(url).map((r) => t(`appr.fetch.${r}`));
      return { title: t("appr.fetch"), detail: `${url}\n\n${why.join("\n")}` };
    }
    case "bash":
      return { title: t("appr.bash"), detail: `${str(a.command) ?? ""}\n\n${t("appr.in")}: ${str(a.cwd) ?? ctx.store.work(ctx.bot.id)}` };
    case "bot_create":
    case "bot_update": {
      if (!plan) return { title: t("appr.tool", { tool }) };
      const name = plan.bot.name;
      if (plan.kind === "update") return { title: t("appr.botUpdate", { name }), preview: { bot: plan.bot, changed: plan.changed } };
      const skills = plan.skills.map((md) => parseSkill(md)).flatMap((p) => ("error" in p ? [] : [{ name: p.name, description: p.description }]));
      return { title: t("appr.botCreate", { name }), preview: { bot: plan.bot, skills, routines: plan.routines.map((r) => ({ name: r.name, schedule: r.schedule })) } };
    }
    default:
      return { title: t("appr.tool", { tool }) };
  }
}

/** `home` i katalogi konfiguracji po realpath; katalog roboczy bota (leży w configDir) jest wyłączony z blokady. */
function sensitiveEnv(work: string): SensitiveEnv {
  const real = (p: string) => resolvePath(p, work);
  return { home: real(os.homedir()), configDirs: [real(configDir()), real(legacyConfigDir())], exempt: [work] };
}

/** Wywołanie narzędzia przez model. Nigdy nie rzuca: błąd wraca do modelu jako `ok: false`. */
export async function runTool(name: string, rawArgs: unknown, ctx: ToolContext): Promise<ToolOutcome> {
  if (!(name in TOOL_GROUP)) return { ok: false, text: `nieznane narzędzie: ${name}`, approval: "auto" };
  const tool = name as ToolName;
  const args: Record<string, unknown> = rawArgs && typeof rawArgs === "object" && !Array.isArray(rawArgs) ? { ...(rawArgs as Record<string, unknown>) } : {};
  const work = ctx.store.work(ctx.bot.id);
  fs.mkdirSync(work, { recursive: true });
  const workReal = fs.realpathSync(work);
  // Ścieżki do decyzji i do wykonania: zawsze po realpath, domyślnie katalog roboczy.
  const pathTools: ToolName[] = ["read_file", "list_dir", "grep", "write_file", "edit_file"];
  if (pathTools.includes(tool)) {
    const p = str(args.path);
    if (p === undefined && tool !== "list_dir" && tool !== "grep") return { ok: false, text: "brak argumentu `path`", approval: "auto" };
    args.path = resolvePath(p ?? ".", workReal);
  }
  if (tool === "bash") args.cwd = resolvePath(str(args.cwd) ?? ".", workReal);

  // Sekrety (klucze, tokeny, .env, konfiguracja aplikacji): bez karty zgody, w każdym trybie i dla każdej zgody.
  const sens = ctx.sensitive ?? sensitiveEnv(workReal);
  const blockedPath = [str(args.path), str(args.cwd)].find((p) => p !== undefined && isSensitivePath(p, sens));
  const blocked =
    blockedPath ??
    (tool === "grep" && containsSensitiveRoot(str(args.path) ?? workReal, sens) ? str(args.path) : undefined) ??
    (tool === "bash" && commandTouchesSensitive(str(args.command) ?? "", sens) ? str(args.command) : undefined);
  if (blocked !== undefined) return { ok: false, text: t("path.sensitive", { p: blocked.length > 120 ? `${blocked.slice(0, 120)}…` : blocked }), approval: "auto" };

  const folders = ctx.bot.folders.map((f) => resolvePath(f, workReal));
  let verdict = needsApproval(tool, args, { bot: ctx.bot, work: workReal, folders, grants: ctx.grants, routine: ctx.routine });
  // Przebieg: polecenie z listy zgód z góry, ale tylko w katalogu roboczym albo folderach bota.
  const cwd = str(args.cwd);
  if (tool === "bash" && ctx.routine && verdict === "allow" && cwd && !isInside(cwd, workReal) && !folders.some((f) => isInside(cwd, f))) verdict = "ask";
  if (tool === "web_fetch" && ctx.routine && fetchRisk(str(args.url) ?? "").length > 0)
    return { ok: false, text: t("web.routineBlocked", { url: str(args.url) ?? "" }), approval: "auto" };
  if (verdict === "deny") return { ok: false, text: `narzędzie ${tool} jest wyłączone dla tego bota`, approval: "auto" };
  // Kreator: błędy w definicji wracają do modelu, zanim użytkownik zobaczy kartę zgody.
  let plan: CreatorPlan | undefined;
  if (tool === "bot_create" || tool === "bot_update") {
    try {
      plan = tool === "bot_create" ? planCreate(args, ctx) : planUpdate(args, ctx);
    } catch (e) {
      return { ok: false, text: e instanceof Error ? e.message : String(e), approval: "auto" };
    }
  }
  let approval: ToolOutcome["approval"] = "auto";
  if (verdict === "ask") {
    const prefix = tool === "bash" ? commandPrefix(str(args.command) ?? "") : undefined;
    const dir = pathTools.includes(tool) && str(args.path) !== undefined ? grantDir(tool, str(args.path) as string) : undefined;
    const decision = await ctx.broker.request(
      { bot: ctx.bot.id, chat: ctx.chat, tool, ...approvalText(tool, args, ctx, plan), canGrant: tool === "web_fetch" ? false : tool === "bash" ? prefix !== null : dir !== null },
      ctx.signal,
    );
    approval = decision;
    if (decision === "deny")
      return { ok: false, text: "Użytkownik odmówił zgody. Nie próbuj tego obejść innym narzędziem – zapytaj, co dalej.", approval };
    if (decision === "chat") {
      if (prefix) ctx.grants.push({ tool, prefix });
      else if (dir) ctx.grants.push({ tool, dir });
      else if (!pathTools.includes(tool) && tool !== "bash" && tool !== "web_fetch") ctx.grants.push({ tool });
    }
  }
  try {
    return { ok: true, text: plan ? applyPlan(plan, ctx) : await exec(tool, args, ctx, approval !== "auto"), approval };
  } catch (e) {
    if (ctx.signal.aborted) return { ok: false, text: "przerwane (Stop)", approval };
    const msg = e instanceof ToolError ? e.message : e instanceof Error ? e.message.replace(/^(\w+): /, "") : String(e);
    return { ok: false, text: msg, approval };
  }
}

const safeHost = (url: string) => {
  try {
    return new URL(url).host;
  } catch {
    return undefined;
  }
};

async function exec(tool: ToolName, a: Record<string, unknown>, ctx: ToolContext, approved = false): Promise<string> {
  const { store, bot } = ctx;
  switch (tool) {
    case "read_file":
      return readFile(a.path as string, a.offset, a.limit);
    case "list_dir":
      return listDir(a.path as string);
    case "grep":
      return grep(need(a, "pattern"), a.path as string, str(a.glob), ctx.signal);
    case "write_file": {
      const content = str(a.content) ?? fail("brak argumentu `content`");
      if (content.length > WRITE_MAX) fail("treść większa niż 1 MB");
      const p = a.path as string;
      if (isDir(p)) fail(`${p} to folder`);
      fs.mkdirSync(path.dirname(p), { recursive: true });
      fs.writeFileSync(p, content);
      return `zapisano ${p} (${Buffer.byteLength(content)} B)`;
    }
    case "edit_file":
      return editFile(a.path as string, need(a, "old"), str(a.new) ?? fail("brak argumentu `new`"), a.all === true);
    case "bash": {
      const cmd = need(a, "command");
      const cwd = a.cwd as string;
      if (!isDir(cwd)) fail(`nie ma folderu ${cwd}`);
      const r = await runProc("/bin/sh", ["-c", cmd], { cwd, timeoutMs: BASH_TIMEOUT, maxBytes: BASH_MAX, signal: ctx.signal });
      const status = r.timedOut ? `przerwane po ${BASH_TIMEOUT / 1000} s` : r.signal ? `sygnał ${r.signal}` : `kod wyjścia ${r.code}`;
      return `${r.out}${r.truncated ? "\n… [wyjście ucięte do 64 KB]" : ""}\n[${status}]`.replace(/^\n/, "");
    }
    case "web_search":
      return (ctx.web?.search ?? webSearch)(need(a, "query"), ctx.signal);
    case "web_fetch":
    {
      // Zgoda na adres prywatny dotyczy dokładnie tego host:port; przekierowania na inne hosty prywatne są odrzucane.
      const url = need(a, "url");
      return (ctx.web?.fetch ?? webFetch)(url, ctx.signal, { allowPrivate: approved && fetchRisk(url).includes("private") ? safeHost(url) : undefined });
    }
    case "memory":
      return memory(a, ctx);
    case "history_search":
      return historySearch(store, bot.id, ctx.chat, need(a, "query"));
    case "skill_view": {
      const name = need(a, "name");
      if (!isSkillName(name)) fail(`zła nazwa skilla: ${name}`);
      const md = store.skill(bot.id, name);
      if (md === null) fail(`nie ma skilla „${name}”. Są: ${store.skills(bot.id).map((x) => x.name).join(", ") || "(żadne)"}`);
      return md as string;
    }
    case "skill_create": {
      const name = need(a, "name");
      if (!isSkillName(name)) fail("`name`: małe litery, cyfry i myślniki, ≤ 64 znaki");
      if (store.skill(bot.id, name) !== null) fail(`skill „${name}” już jest – popraw go przez skill_patch`);
      store.skillSave(bot.id, skillMarkdown({ name, description: need(a, "description"), body: need(a, "body") }), "bot");
      return `zapisano skill „${name}”`;
    }
    case "skill_patch": {
      const name = need(a, "name");
      if (!isSkillName(name)) fail(`zła nazwa skilla: ${name}`);
      const md = store.skill(bot.id, name) ?? fail(`nie ma skilla „${name}”`);
      const next = replaceOnce(md, need(a, "old"), str(a.new) ?? fail("brak argumentu `new`"), false);
      const parsed = parseSkill(next);
      if ("error" in parsed) fail(`po zmianie SKILL.md jest zły: ${parsed.error}`);
      else if (parsed.name !== name) fail("zmiana nazwy skilla niedozwolona – utwórz nowy");
      store.skillSave(bot.id, next);
      return `poprawiono skill „${name}”`;
    }
    case "bot_create":
    case "bot_update":
      return fail("brak planu Kreatora"); // obsłużone w runTool
  }
}

function isDir(p: string): boolean {
  try {
    return fs.statSync(p).isDirectory();
  } catch {
    return false;
  }
}

function readFile(p: string, offset: unknown, limit: unknown): string {
  let st: fs.Stats;
  try {
    st = fs.statSync(p);
  } catch {
    return fail(`nie ma pliku ${p}`);
  }
  if (st.isDirectory()) fail(`${p} to folder – użyj list_dir`);
  if (st.size > READ_MAX_FILE) fail(`plik ma ${Math.round(st.size / 1e6)} MB – za duży (limit 5 MB); użyj grep`);
  const buf = fs.readFileSync(p);
  if (buf.subarray(0, 8192).includes(0)) fail("plik binarny");
  const lines = buf.toString("utf8").split("\n");
  if (lines.at(-1) === "") lines.pop();
  const from = Math.max(1, typeof offset === "number" ? Math.floor(offset) : 1);
  const count = Math.max(1, Math.min(2000, typeof limit === "number" ? Math.floor(limit) : READ_LINES));
  const slice = lines.slice(from - 1, from - 1 + count);
  if (lines.length === 0) return `${p}: pusty plik`;
  if (slice.length === 0) fail(`plik ma ${lines.length} linii`);
  const width = String(from + slice.length - 1).length;
  const body = slice.map((l, i) => `${String(from + i).padStart(width)}\t${l.length > LINE_MAX ? `${l.slice(0, LINE_MAX)}…` : l}`).join("\n");
  const to = from + slice.length - 1;
  return to < lines.length || from > 1 ? `${body}\n[linie ${from}–${to} z ${lines.length}]` : body;
}

function listDir(p: string): string {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(p, { withFileTypes: true });
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code;
    return fail(code === "ENOTDIR" ? `${p} to plik – użyj read_file` : `nie ma folderu ${p}`);
  }
  const names = entries.map((e) => (e.isDirectory() || (e.isSymbolicLink() && isDir(path.join(p, e.name))) ? `${e.name}/` : e.name)).sort((a, b) => a.localeCompare(b));
  if (names.length === 0) return `${p}: pusty folder`;
  const shown = names.slice(0, LIST_MAX);
  return `${p}\n${shown.join("\n")}${names.length > LIST_MAX ? `\n… i ${names.length - LIST_MAX} więcej` : ""}`;
}

async function grep(pattern: string, p: string, glob: string | undefined, signal: AbortSignal): Promise<string> {
  const args = ["--line-number", "--no-heading", "--color", "never", "--max-count", "20", "--max-columns", "300", "--max-filesize", "1M"];
  for (const g of SENSITIVE_GLOBS) args.push("--glob", g);
  if (glob) args.push("--glob", glob);
  args.push("-e", pattern, "--", p);
  const r = await runProc("rg", args, { cwd: isDir(p) ? p : path.dirname(p), timeoutMs: 30_000, maxBytes: 32 * 1024, signal });
  if (r.code === 1) return `brak dopasowań „${pattern}” w ${p}`;
  if (r.code !== 0) fail(`rg: ${r.out.trim().split("\n")[0] || `kod ${r.code}`}`);
  return `${r.out.trimEnd()}${r.truncated ? "\n… [ucięte do 32 KB – zawęź wzorzec albo glob]" : ""}`;
}

function replaceOnce(text: string, old: string, next: string, all: boolean): string {
  const count = text.split(old).length - 1;
  if (count === 0) fail("nie znaleziono `old` – fragment musi się zgadzać co do znaku (wcięcia też)");
  if (count > 1 && !all) fail(`\`old\` występuje ${count} razy – podaj dłuższy fragment albo all: true`);
  return all ? text.split(old).join(next) : text.replace(old, () => next);
}

function editFile(p: string, old: string, next: string, all: boolean): string {
  let text: string;
  try {
    text = fs.readFileSync(p, "utf8");
  } catch {
    return fail(`nie ma pliku ${p}`);
  }
  const out = replaceOnce(text, old, next, all);
  fs.writeFileSync(p, out);
  return `zmieniono ${p}`;
}

function memory(a: Record<string, unknown>, ctx: ToolContext): string {
  const target = a.target === "user" ? "user" : a.target === "memory" ? "memory" : fail("`target`: memory albo user");
  const limit = target === "user" ? USER_LIMIT : MEMORY_LIMIT;
  let op: MemoryOp;
  if (a.action === "add") op = { kind: "add", text: need(a, "text") };
  else if (a.action === "replace") op = { kind: "replace", old: need(a, "old"), text: need(a, "text") };
  else if (a.action === "remove") op = { kind: "remove", old: need(a, "old") };
  else return fail("`action`: add, replace albo remove");
  const r = memoryEdit(ctx.store.memory(ctx.bot.id)[target], op, limit);
  if (!r.ok) return fail(r.error);
  ctx.store.memorySave(ctx.bot.id, target, r.text);
  return `zapisano (${target}: ${r.text.length}/${limit} znaków). Zmiana będzie w prompcie od następnej rozmowy.`;
}

function historySearch(store: BotStore, bot: string, current: string, query: string): string {
  const q = query.toLowerCase().trim();
  if (!q) fail("puste zapytanie");
  const hits: string[] = [];
  for (const kind of ["chats", "runs"] as ChatKind[]) {
    const s = store.chats(bot, kind);
    for (const meta of s.list()) {
      if (meta.id === current || hits.length >= 8) continue;
      const c = parseBotChat(s.load(meta.id) ?? "");
      if (!c) continue;
      for (const m of c.messages) {
        const i = m.text.toLowerCase().indexOf(q);
        if (i < 0) continue;
        const date = new Date(m.at).toISOString().slice(0, 10);
        const snip = m.text.slice(Math.max(0, i - 150), i + q.length + 150).replace(/\s+/g, " ");
        hits.push(`[${date}] ${c.title || "bez tytułu"}${kind === "runs" ? " (harmonogram)" : ""} – ${m.role === "user" ? "użytkownik" : "ty"}: …${snip}…`);
        break;
      }
    }
  }
  return hits.length ? hits.join("\n\n") : `nic o „${query}” w dawnych rozmowach`;
}

/** Pola bota z argumentów narzędzia (Kreator) nałożone na `base`. */
function botFromArgs(a: Record<string, unknown>, base: BotDef): BotDef {
  const next: Record<string, unknown> = { ...base };
  for (const k of ["name", "color", "persona", "style", "avoid", "tone", "model", "folders"]) if (a[k] !== undefined) next[k] = a[k];
  if (typeof a.emoji === "string" && a.emoji) next.avatar = { emoji: a.emoji };
  const tools = a.tools;
  if (Array.isArray(tools)) next.tools = Object.fromEntries(TOOL_GROUPS.map((g) => [g, tools.includes(g)])) as Record<ToolGroup, boolean>;
  const r = parseBot(next);
  if (!r.bot) return fail(r.errors.join("; "));
  if (r.errors.length) fail(`popraw: ${r.errors.join("; ")}`);
  return r.bot;
}

type CreatorPlan =
  | { kind: "create"; bot: BotDef; skills: string[]; routines: Routine[] }
  | { kind: "update"; bot: BotDef; changed: string[] };

function planCreate(a: Record<string, unknown>, ctx: ToolContext): CreatorPlan {
  const now = (ctx.now ?? Date.now)();
  const taken = ctx.store.list().bots.map((b) => b.id);
  const base = newBot(botId(need(a, "name"), taken), now, { model: ctx.model ?? null });
  const bot = botFromArgs(a, base);
  if (Array.isArray(a.tools) && a.tools.some((g) => !TOOL_GROUPS.includes(g as ToolGroup))) fail(`\`tools\`: tylko ${TOOL_GROUPS.join(", ")}`);
  const skills = (Array.isArray(a.skills) ? a.skills : []).map((x: Record<string, unknown>) => {
    const md = skillMarkdown({ name: String(x?.name ?? ""), description: String(x?.description ?? ""), body: String(x?.body ?? "") });
    const p = parseSkill(md);
    if ("error" in p) fail(`skill „${String(x?.name)}”: ${p.error}`);
    return md;
  });
  const names = skills.map((md) => (parseSkill(md) as { name: string }).name);
  if (new Set(names).size !== names.length) fail("dwa skille o tej samej nazwie");
  const rawRoutines = Array.isArray(a.routines) ? a.routines : [];
  const r = parseRoutines({
    routines: rawRoutines.map((x: Record<string, unknown>, i) => ({ ...x, id: `r${i + 1}`, enabled: false, created: now, allow: { writeWork: false, bash: [] } })),
  });
  if (r.errors.length) fail(r.errors.join("; "));
  return { kind: "create", bot, skills, routines: r.routines };
}

function planUpdate(a: Record<string, unknown>, ctx: ToolContext): CreatorPlan {
  const id = need(a, "id");
  const old = ctx.store.load(id) ?? fail(`nie ma bota „${id}”. Są: ${ctx.store.list().bots.map((b) => b.id).join(", ")}`);
  const bot = botFromArgs(a, old as BotDef);
  const keys = Object.keys(bot) as (keyof BotDef)[];
  const changed = keys.filter((k) => JSON.stringify(bot[k]) !== JSON.stringify((old as BotDef)[k]));
  if (changed.length === 0) fail("nic się nie zmienia – podaj pola z nowymi wartościami");
  return { kind: "update", bot, changed };
}

function applyPlan(plan: CreatorPlan, ctx: ToolContext): string {
  const { bot } = plan;
  if (plan.kind === "update") {
    ctx.store.save(serializeBot(bot));
    return `zmieniono bota „${bot.name}” (${plan.changed.join(", ")})`;
  }
  ctx.store.create(serializeBot(bot));
  for (const md of plan.skills) ctx.store.skillSave(bot.id, md, "bot");
  if (plan.routines.length) ctx.store.routinesSave(bot.id, JSON.stringify({ routines: plan.routines }, null, 2));
  const extra = [
    plan.skills.length ? `${plan.skills.length} skill(e)` : "",
    plan.routines.length ? `${plan.routines.length} zadanie(a) w harmonogramie – wyłączone, użytkownik włącza je sam` : "",
  ].filter(Boolean);
  return `utworzono bota „${bot.name}” (id: ${bot.id})${extra.length ? `, ${extra.join(", ")}` : ""}`;
}
