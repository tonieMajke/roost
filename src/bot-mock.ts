/** Zakładka Bot w podglądzie (`pnpm dev`): boty w localStorage, z przykładowymi danymi
 *  (Kreator, bot newsowy z pamięcią, skillem i harmonogramem, bot-postać bez narzędzi). */

import type { Backend, BotApprovalChange, BotChatKind, BotSkillMeta } from "./backend";
import {
  botId,
  creatorBot,
  MEMORY_LIMIT,
  MEMORY_SEP,
  newBot,
  newBotChat,
  parseBot,
  parseBotChat,
  parseRoutines,
  parseSkill,
  skillMarkdown,
  USER_LIMIT,
  type ApprovalDecision,
  type ApprovalRequest,
  type BotChat,
  type BotDef,
  type Routine,
  type RunInfo,
} from "./bot";
import { chatMeta, sortChats, type ChatEvent } from "./chat";
import { t } from "./i18n";

const KEY = "aw-bots";

type MockBot = {
  def: BotDef;
  memory: string;
  user: string;
  skills: Record<string, { md: string; updated: number; by?: "bot" | "user" | "import" }>;
  routines: Routine[];
  chats: Record<string, BotChat>;
  runs: Record<string, BotChat>;
};

/** Udawane `~/.claude/skills` w podglądzie. */
const mockSources = () => [
  { name: "pdf", description: t("bot.mock.pdfDesc"), body: t("bot.mock.pdfBody") },
  { name: "commit-message", description: t("bot.mock.commitDesc"), body: t("bot.mock.commitBody") },
];

function seed(now: number): Record<string, MockBot> {
  const day = 86_400_000;
  const model = { provider: "claude", model: "haiku" };
  const rustyText = t("bot.mock.rustyText");
  const rusty = newBot("rusty", now - 3 * day, {
    name: "Rusty",
    avatar: { emoji: "🦀" },
    color: "#e2704a",
    persona: t("bot.mock.rustyPersona"),
    style: t("bot.mock.rustyStyle"),
    avoid: t("bot.mock.rustyAvoid"),
    tone: "playful",
    model,
    folders: ["/home/majke/Projekty/kod"],
  });
  const ola = newBot("ola", now - day, {
    name: "Ola",
    avatar: { emoji: "🌙" },
    color: "#9b7cf0",
    persona: t("bot.mock.olaPersona"),
    style: t("bot.mock.olaStyle"),
    tone: "balanced",
    model,
    tools: { web: false, read: false, write: false, bash: false, memory: true, skills: false },
  });
  const chat: BotChat = {
    ...newBotChat("aaaaaaaa-0001", "rusty", now - 2 * 3_600_000, model),
    title: t("bot.mock.chatTitle"),
    updated: now - 2 * 3_600_000,
    messages: [
      { id: "m1", role: "user", text: t("bot.mock.chatQ"), at: now - 2 * 3_600_000 },
      {
        id: "m2",
        role: "assistant",
        text: rustyText,
        at: now - 2 * 3_600_000 + 9000,
        model,
      },
    ],
    calls: [
      { id: "c1", message: "m2", name: "web_search", args: { query: "Rust 1.92 release notes" }, result: "1. Announcing Rust 1.92.0 — blog.rust-lang.org\n2. Rust 1.92 changelog — github.com", approval: "auto", at: 0 },
      { id: "c2", message: "m2", name: "web_fetch", args: { url: "https://blog.rust-lang.org/2026/09/18/Rust-1.92.0/" }, result: "Announcing Rust 1.92.0\n\nThe Rust team is happy to announce…", approval: "auto", at: 0 },
      { id: "c3", message: "m2", name: "skill_create", args: { name: "rust-news", description: t("bot.mock.skillCreateDesc") }, result: t("bot.mock.skillCreateResult"), approval: "auto", at: rustyText.lastIndexOf("\n\n") },
    ],
  };
  const run: BotChat = {
    ...newBotChat("bbbbbbbb-0001", "rusty", now - 5 * 3_600_000, model, "rano"),
    title: t("bot.mock.runTitle"),
    state: "done",
    updated: now - 5 * 3_600_000,
    messages: [
      { id: "r1", role: "user", text: t("bot.mock.runPrompt"), at: now - 5 * 3_600_000 },
      { id: "r2", role: "assistant", text: t("bot.mock.runReply"), at: now - 5 * 3_600_000 + 20_000, model },
    ],
  };
  return {
    rusty: {
      def: rusty,
      memory: [t("bot.mock.memNote1"), t("bot.mock.memNote2")].join(MEMORY_SEP),
      user: t("bot.mock.memUser"),
      skills: {
        "rust-news": {
          md: skillMarkdown({
            name: "rust-news",
            description: t("bot.mock.rustNewsDesc"),
            body: t("bot.mock.rustNewsBody"),
          }),
          updated: now - 2 * 3_600_000,
          by: "bot",
        },
      },
      routines: [
        {
          id: "rano",
          name: t("bot.mock.runTitle"),
          prompt: t("bot.mock.runPrompt"),
          schedule: { kind: "daily", at: "08:00", days: [1, 2, 3, 4, 5] },
          allow: { writeWork: true, bash: [] },
          enabled: true,
          created: now - 3 * day,
          lastRun: now - 5 * 3_600_000,
        },
      ],
      chats: { [chat.id]: chat },
      runs: { [run.id]: run },
    },
    ola: { def: ola, memory: "", user: "", skills: {}, routines: [], chats: {}, runs: {} },
    kreator: { def: creatorBot(now - 4 * day), memory: "", user: "", skills: {}, routines: [], chats: {}, runs: {} },
  };
}

function load(): Record<string, MockBot> {
  try {
    const raw = globalThis.localStorage?.getItem(KEY);
    if (raw) return JSON.parse(raw) as Record<string, MockBot>;
  } catch {
    // zepsuty zapis: od nowa
  }
  const all = seed(Date.now());
  save(all);
  return all;
}

function save(all: Record<string, MockBot>) {
  try {
    globalThis.localStorage?.setItem(KEY, JSON.stringify(all));
  } catch {
    // tryb prywatny: podgląd bez zapisu
  }
}

function get(all: Record<string, MockBot>, id: string): MockBot {
  const b = all[id];
  if (!b) throw new Error(t("bot.mock.errNoBot", { id }));
  return b;
}

/** Ta sama walidacja co w `electron/src/bot/store.ts`, żeby podgląd odrzucał to samo. */
function checked(bot: BotDef): BotDef {
  const r = parseBot(JSON.parse(JSON.stringify(bot)));
  if (!r.bot) throw new Error(t("bot.mock.errBadFormat"));
  return r.bot;
}

type BotApi = Pick<
  Backend,
  | "botList"
  | "botCreate"
  | "botSave"
  | "botDelete"
  | "botMemory"
  | "botMemorySave"
  | "botSkills"
  | "botSkill"
  | "botSkillSave"
  | "botSkillDelete"
  | "botSkillSources"
  | "botSkillImport"
  | "botAvatarImport"
  | "botAvatar"
  | "botRoutines"
  | "botRoutinesSave"
  | "botChatList"
  | "botChatLoad"
  | "botChatSave"
  | "botChatDelete"
  | "botSend"
  | "botApprovals"
  | "botApprove"
  | "onBotApproval"
  | "botRuns"
  | "onBotRun"
  | "botRunNow"
  | "onBotOpenRun"
>;

// Przebiegi w podglądzie: jak `Scheduler`, bez zegara – tylko „Uruchom teraz”.
const runs = new Map<string, RunInfo>();
const runListeners = new Set<(r: RunInfo) => void>();
const runChanged = (r: RunInfo) => {
  if (r.state === "done" || r.state === "error") runs.delete(`${r.bot}/${r.routine}`);
  else runs.set(`${r.bot}/${r.routine}`, r);
  runListeners.forEach((cb) => cb({ ...r }));
};

async function mockRun(botId: string, routine: Routine) {
  const now = Date.now();
  const def = get(load(), botId).def;
  const model = def.model ?? { provider: "claude", model: "haiku" };
  const chat: BotChat = {
    ...newBotChat(crypto.randomUUID(), botId, now, model, routine.id),
    title: routine.name,
    state: "running",
    messages: [
      { id: crypto.randomUUID(), role: "user", text: routine.prompt, at: now },
      { id: crypto.randomUUID(), role: "assistant", text: "", at: now, model },
    ],
  };
  const put = (c: BotChat) => {
    const all = load();
    get(all, botId).runs[c.id] = c;
    const r = get(all, botId).routines.find((x) => x.id === routine.id);
    if (r) r.lastRun = now;
    save(all);
  };
  const info: RunInfo = { bot: botId, routine: routine.id, chat: chat.id, state: "running", started: now };
  put(chat);
  runChanged(info);
  await new Promise((r) => setTimeout(r, 2500));
  const text = t("bot.mock.runDone");
  const done: BotChat = { ...chat, state: "done", updated: Date.now(), messages: [chat.messages[0], { ...chat.messages[1], text, ms: 2500 }] };
  put(done);
  runChanged({ ...info, state: "done" });
}

// Zgody w podglądzie: jak `ApprovalBroker`, bez procesu głównego.
const pending = new Map<string, { req: ApprovalRequest; resolve: (d: ApprovalDecision) => void }>();
const approvalListeners = new Set<(e: BotApprovalChange) => void>();
const decide = (id: string, decision: ApprovalDecision) => {
  const p = pending.get(id);
  if (!p) return;
  pending.delete(id);
  approvalListeners.forEach((cb) => cb({ type: "resolved", id, decision }));
  p.resolve(decision);
};
function ask(r: Omit<ApprovalRequest, "id" | "at">, signal: AbortSignal): Promise<ApprovalDecision> {
  const req: ApprovalRequest = { ...r, id: crypto.randomUUID(), at: Date.now() };
  return new Promise((resolve) => {
    pending.set(req.id, { req, resolve });
    signal.addEventListener("abort", () => decide(req.id, "deny"), { once: true });
    approvalListeners.forEach((cb) => cb({ type: "request", req }));
  });
}

/** Odpowiedź z podglądu: bot z narzędziami czyta plik i prosi o zgodę na `cargo test`. */
async function mockTurn(bot: BotDef, chat: BotChat, signal: AbortSignal, emit: (e: ChatEvent) => void) {
  const wait = (ms: number) =>
    new Promise<void>((resolve, reject) => {
      const t = setTimeout(resolve, ms);
      signal.addEventListener("abort", () => (clearTimeout(t), reject(new DOMException("stop", "AbortError"))), { once: true });
    });
  const words = async (text: string) => {
    for (const w of text.split(/(?<= )/)) {
      await wait(25);
      emit({ type: "text", text: w });
    }
  };
  if (bot.builtin === "creator") return creatorTurn(bot, chat, signal, emit, wait, words);
  if (!bot.tools.read && !bot.tools.bash) {
    await wait(400);
    return words(t("bot.mock.noToolsReply", { name: bot.name }));
  }
  await wait(300);
  await words(t("bot.mock.checking"));
  const read = crypto.randomUUID();
  emit({ type: "tool_call", id: read, name: "read_file", args: { path: "/home/majke/Projekty/kod/src/main.rs" } });
  await wait(500);
  emit({ type: "tool_result", id: read, text: 'fn main() {\n    println!("hej");\n}\n', error: false, approval: "auto" });
  const run = crypto.randomUUID();
  const command = "cargo test";
  emit({ type: "tool_call", id: run, name: "bash", args: { command, cwd: "/home/majke/Projekty/kod" } });
  const d = await ask(
    { bot: bot.id, chat: chat.id, tool: "bash", title: t("bot.mock.askRun"), detail: `${command}\n\nw: /home/majke/Projekty/kod`, canGrant: true },
    signal,
  );
  if (d === "deny") {
    emit({ type: "tool_result", id: run, text: t("bot.mock.denied"), error: true, approval: d });
    emit({ type: "text", text: "\n\n" });
    return words(t("bot.mock.deniedReply"));
  }
  await wait(900);
  emit({ type: "tool_result", id: run, text: "running 12 tests\n............\ntest result: ok. 12 passed; 0 failed", error: false, approval: d });
  emit({ type: "text", text: "\n\n" });
  await words(t("bot.mock.testsOk"));
}

/** Kreator w podglądzie: najpierw dopytuje, w drugiej odpowiedzi proponuje bota z podglądem karty. */
async function creatorTurn(
  creator: BotDef,
  chat: BotChat,
  signal: AbortSignal,
  emit: (e: ChatEvent) => void,
  wait: (ms: number) => Promise<void>,
  words: (t: string) => Promise<void>,
) {
  await wait(300);
  if (chat.messages.filter((m) => m.role === "user").length < 2)
    return words(t("bot.mock.creatorAsk"));
  const all = load();
  const id = botId("Bosman", Object.keys(all));
  const now = Date.now();
  const def = newBot(id, now, {
    name: "Bosman",
    avatar: { emoji: "🏴‍☠️" },
    color: "#3fb4d0",
    persona: t("bot.mock.bosmanPersona"),
    style: t("bot.mock.bosmanStyle"),
    avoid: t("bot.mock.bosmanAvoid"),
    tone: "playful",
    model: chat.model,
    tools: { web: true, read: false, write: false, bash: false, memory: true, skills: true },
  });
  const skill = { name: "rust-news", description: t("bot.mock.bosmanSkillDesc"), body: t("bot.mock.bosmanSkillBody") };
  const routine: Routine = {
    id: "r1",
    name: t("bot.mock.bosmanRoutine"),
    prompt: t("bot.mock.bosmanRoutinePrompt"),
    schedule: { kind: "daily", at: "08:00", days: [1, 2, 3, 4, 5] },
    allow: { writeWork: false, bash: [] },
    enabled: false,
    created: now,
  };
  await words(t("bot.mock.proposal"));
  const call = crypto.randomUUID();
  const args = { name: def.name, emoji: "🏴‍☠️", persona: def.persona, tools: ["web", "memory", "skills"], skills: [skill], routines: [{ name: routine.name, prompt: routine.prompt, schedule: routine.schedule }] };
  emit({ type: "tool_call", id: call, name: "bot_create", args });
  const d = await ask(
    {
      bot: creator.id,
      chat: chat.id,
      tool: "bot_create",
      title: t("bot.mock.createTitle", { name: def.name }),
      preview: { bot: def, skills: [{ name: skill.name, description: skill.description }], routines: [{ name: routine.name, schedule: routine.schedule }] },
      canGrant: true,
    },
    signal,
  );
  if (d === "deny") {
    emit({ type: "tool_result", id: call, text: t("bot.mock.denied"), error: true, approval: d });
    emit({ type: "text", text: "\n\n" });
    return words(t("bot.mock.changeWhat"));
  }
  const fresh = load();
  fresh[id] = { def, memory: "", user: "", skills: { [skill.name]: { md: skillMarkdown(skill), updated: now, by: "bot" } }, routines: [routine], chats: {}, runs: {} };
  save(fresh);
  emit({ type: "tool_result", id: call, text: `utworzono bota „${def.name}” (id: ${id}), 1 skill(e), 1 zadanie(a) w harmonogramie – wyłączone, użytkownik włącza je sam`, error: false, approval: d });
  emit({ type: "text", text: "\n\n" });
  await words(t("bot.mock.created"));
}

const chatsOf = (b: MockBot, kind: BotChatKind) => (kind === "runs" ? b.runs : b.chats);

export const mockBotBackend: BotApi = {
  async botList() {
    const bots = Object.values(load()).map((b) => b.def);
    bots.sort((a, b) => Number(!!a.builtin) - Number(!!b.builtin) || a.created - b.created);
    return { bots, errors: [] };
  },
  async botCreate(bot) {
    const all = load();
    const def = checked(bot);
    if (def.builtin) throw new Error(t("bot.mock.errBuiltinTwice"));
    if (all[def.id]) throw new Error(t("bot.mock.errExists", { id: def.id }));
    all[def.id] = { def, memory: "", user: "", skills: {}, routines: [], chats: {}, runs: {} };
    save(all);
    return def;
  },
  async botSave(bot) {
    const all = load();
    const old = get(all, bot.id).def;
    const def: BotDef = { ...checked(bot), created: old.created };
    if (old.builtin) def.builtin = old.builtin;
    else delete def.builtin;
    all[bot.id].def = def;
    save(all);
    return def;
  },
  async botDelete(id) {
    const all = load();
    if (get(all, id).def.builtin) throw new Error(t("bot.mock.errBuiltinDelete"));
    delete all[id];
    save(all);
  },
  async botMemory(id) {
    const b = get(load(), id);
    return { memory: b.memory, user: b.user };
  },
  async botMemorySave(id, target, text) {
    const limit = target === "memory" ? MEMORY_LIMIT : USER_LIMIT;
    if (text.length > limit) throw new Error(t("bot.mock.errMemory", { target, len: text.length, limit }));
    const all = load();
    get(all, id)[target] = text;
    save(all);
  },
  async botSkills(id): Promise<BotSkillMeta[]> {
    const b = get(load(), id);
    return Object.entries(b.skills)
      .sort(([a], [c]) => a.localeCompare(c))
      .map(([name, s]) => {
        const p = parseSkill(s.md);
        const by = s.by ? { by: s.by } : {};
        return "error" in p ? { name, description: "", updated: s.updated, ...by, error: p.error } : { name, description: p.description, updated: s.updated, ...by };
      });
  },
  async botSkill(id, name) {
    return get(load(), id).skills[name]?.md ?? null;
  },
  async botSkillSave(id, md) {
    const p = parseSkill(md);
    if ("error" in p) throw new Error(`SKILL.md: ${p.error}`);
    const all = load();
    const b = get(all, id);
    b.skills[p.name] = { md, updated: Date.now(), by: b.skills[p.name]?.by ?? "user" };
    save(all);
    return p.name;
  },
  async botSkillSources() {
    return mockSources().map(({ name, description }) => ({ name, description }));
  },
  async botSkillImport(id, name) {
    const src = mockSources().find((s) => s.name === name);
    if (!src) throw new Error(t("bot.mock.errNoSkill", { name }));
    const all = load();
    const b = get(all, id);
    if (b.skills[name]) throw new Error(t("bot.mock.errHaveSkill", { name }));
    b.skills[name] = { md: skillMarkdown({ name, description: src.description, body: src.body }), updated: Date.now(), by: "import" };
    save(all);
    return name;
  },
  async botAvatarImport() {
    throw new Error(t("bot.mock.errAvatar"));
  },
  async botAvatar() {
    return null;
  },
  async botSkillDelete(id, name) {
    const all = load();
    delete get(all, id).skills[name];
    save(all);
  },
  async botRoutines(id) {
    return parseRoutines({ routines: get(load(), id).routines });
  },
  async botRoutinesSave(id, routines) {
    const r = parseRoutines({ routines });
    if (r.errors.length) throw new Error(r.errors.join("; "));
    const all = load();
    get(all, id).routines = r.routines;
    save(all);
  },
  async botChatList(id, kind) {
    return sortChats(Object.values(chatsOf(get(load(), id), kind)).map(chatMeta));
  },
  async botChatLoad(id, kind, chatId) {
    const c = chatsOf(get(load(), id), kind)[chatId];
    return c ? parseBotChat(JSON.stringify(c)) : null;
  },
  async botChatSave(chat) {
    const all = load();
    chatsOf(get(all, chat.bot), chat.routine ? "runs" : "chats")[chat.id] = chat;
    save(all);
  },
  async botChatDelete(id, kind, chatId) {
    const all = load();
    delete chatsOf(get(all, id), kind)[chatId];
    save(all);
  },
  botSend(chat, _req, onEvent) {
    const ctl = new AbortController();
    const emit = (e: ChatEvent) => {
      if (!ctl.signal.aborted) onEvent(e);
    };
    void (async () => {
      try {
        await mockTurn(get(load(), chat.bot).def, chat, ctl.signal, emit);
        onEvent({ type: "done" });
      } catch (e) {
        onEvent(ctl.signal.aborted ? { type: "done" } : { type: "error", message: String(e) });
      }
    })();
    return () => ctl.abort();
  },
  async botApprovals() {
    return [...pending.values()].map((p) => p.req);
  },
  async botApprove(id, decision) {
    decide(id, decision);
  },
  onBotApproval(cb) {
    approvalListeners.add(cb);
    return () => void approvalListeners.delete(cb);
  },
  async botRuns() {
    return [...runs.values()];
  },
  onBotRun(cb) {
    runListeners.add(cb);
    return () => void runListeners.delete(cb);
  },
  async botRunNow(id, routineId) {
    if (runs.has(`${id}/${routineId}`)) throw new Error(t("bot.mock.errBusy"));
    const r = get(load(), id).routines.find((x) => x.id === routineId);
    if (!r) throw new Error(t("bot.mock.errNoRoutine", { id: routineId }));
    void mockRun(id, r);
  },
  onBotOpenRun() {
    return () => undefined; // w podglądzie nie ma powiadomień
  },
};
