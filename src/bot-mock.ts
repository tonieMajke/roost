/** Zakładka Bot w podglądzie (`pnpm dev`): boty w localStorage, z przykładowymi danymi
 *  (Kreator, bot newsowy z pamięcią, skillem i harmonogramem, bot-postać bez narzędzi). */

import type { Backend, BotApprovalChange, BotChatKind, BotSkillMeta } from "./backend";
import {
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
} from "./bot";
import { chatMeta, sortChats, type ChatEvent } from "./chat";

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
const MOCK_SOURCES = [
  { name: "pdf", description: "Czytanie, łączenie i wypełnianie plików PDF.", body: "# PDF\n\nUżyj `pdftotext`, a do łączenia `qpdf`.\n" },
  { name: "commit-message", description: "Komunikat commita w stylu repozytorium: krótko, po polsku.", body: "# Commit\n\n1. `git diff --cached`\n2. Jedno zdanie, czas przeszły.\n" },
];

const RUSTY_TEXT =
  "Arr! Przejrzałem notatki wydania. Najważniejsze:\n\n- **async closures** stabilne,\n- szybszy `cargo check` przy dużych workspace'ach." +
  "\n\nZapisałem też przepis na takie przeglądy jako skill `rust-news`.";

function seed(now: number): Record<string, MockBot> {
  const day = 86_400_000;
  const model = { provider: "claude", model: "haiku" };
  const rusty = newBot("rusty", now - 3 * day, {
    name: "Rusty",
    avatar: { emoji: "🦀" },
    color: "#e2704a",
    persona: "Ahoj! Jestem Rusty, twój pirat od Rusta. Co rano przeczesuję sieć w poszukiwaniu nowości o Ruście i pomagam przy kodzie.",
    style: "Mówi jak pirat, ale konkretnie. Kod zawsze w blokach.",
    avoid: "Plotek bez źródła.",
    tone: "playful",
    model,
    folders: ["/home/majke/Projekty/kod"],
  });
  const ola = newBot("ola", now - day, {
    name: "Ola",
    avatar: { emoji: "🌙" },
    color: "#9b7cf0",
    persona: "Hej, tu Ola. Jestem od rozmów późną nocą: słucham, dopytuję i czasem żartuję.",
    style: "Ciepło, krótkimi zdaniami.",
    tone: "balanced",
    model,
    tools: { web: false, read: false, write: false, bash: false, memory: true, skills: false },
  });
  const chat: BotChat = {
    ...newBotChat("aaaaaaaa-0001", "rusty", now - 2 * 3_600_000, model),
    title: "Co nowego w Ruście 1.92?",
    updated: now - 2 * 3_600_000,
    messages: [
      { id: "m1", role: "user", text: "Co nowego w Ruście 1.92?", at: now - 2 * 3_600_000 },
      {
        id: "m2",
        role: "assistant",
        text: RUSTY_TEXT,
        at: now - 2 * 3_600_000 + 9000,
        model,
      },
    ],
    calls: [
      { id: "c1", message: "m2", name: "web_search", args: { query: "Rust 1.92 release notes" }, result: "1. Announcing Rust 1.92.0 — blog.rust-lang.org\n2. Rust 1.92 changelog — github.com", approval: "auto", at: 0 },
      { id: "c2", message: "m2", name: "web_fetch", args: { url: "https://blog.rust-lang.org/2026/09/18/Rust-1.92.0/" }, result: "Announcing Rust 1.92.0\n\nThe Rust team is happy to announce…", approval: "auto", at: 0 },
      { id: "c3", message: "m2", name: "skill_create", args: { name: "rust-news", description: "Przegląd nowości o Ruście" }, result: "zapisano skill rust-news", approval: "auto", at: RUSTY_TEXT.indexOf("\n\nZapisałem") },
    ],
  };
  const run: BotChat = {
    ...newBotChat("bbbbbbbb-0001", "rusty", now - 5 * 3_600_000, model, "rano"),
    title: "Poranne newsy o Ruście",
    updated: now - 5 * 3_600_000,
    messages: [
      { id: "r1", role: "user", text: "Przejrzyj newsy o Ruście z ostatniej doby.", at: now - 5 * 3_600_000 },
      { id: "r2", role: "assistant", text: "Spokojna doba: dwa nowe wydania tokio i jeden RFC o `gen` blokach.", at: now - 5 * 3_600_000 + 20_000, model },
    ],
  };
  return {
    rusty: {
      def: rusty,
      memory: ["Użytkownik pisze aplikację w Electronie i Ruście (Agents workspace).", "Woli krótkie podsumowania z linkami."].join(MEMORY_SEP),
      user: "Majke, programista na CachyOS (KDE, Wayland). Pisze po polsku.",
      skills: {
        "rust-news": {
          md: skillMarkdown({
            name: "rust-news",
            description: "Przegląd nowości o Ruście z ostatniej doby: blog, This Week in Rust, wydania crate'ów.",
            body: "# Kroki\n\n1. `web_search`: „Rust release”, „This Week in Rust”.\n2. Przeczytaj 2–3 źródła.\n3. Podsumuj w ≤ 5 punktach z linkami.\n",
          }),
          updated: now - 2 * 3_600_000,
          by: "bot",
        },
      },
      routines: [
        {
          id: "rano",
          name: "Poranne newsy o Ruście",
          prompt: "Przejrzyj newsy o Ruście z ostatniej doby.",
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
  if (!b) throw new Error(`nie ma bota „${id}”`);
  return b;
}

/** Ta sama walidacja co w `electron/src/bot/store.ts`, żeby podgląd odrzucał to samo. */
function checked(bot: BotDef): BotDef {
  const r = parseBot(JSON.parse(JSON.stringify(bot)));
  if (!r.bot) throw new Error("zły format bota");
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
>;

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
  if (!bot.tools.read && !bot.tools.bash) {
    await wait(400);
    return words(`(podgląd) ${bot.name} odpowiada bez narzędzi. Prawdziwą odpowiedź da model w oknie aplikacji.`);
  }
  await wait(300);
  await words("Już sprawdzam, co jest w projekcie.");
  const read = crypto.randomUUID();
  emit({ type: "tool_call", id: read, name: "read_file", args: { path: "/home/majke/Projekty/kod/src/main.rs" } });
  await wait(500);
  emit({ type: "tool_result", id: read, text: 'fn main() {\n    println!("hej");\n}\n', error: false, approval: "auto" });
  const run = crypto.randomUUID();
  const command = "cargo test";
  emit({ type: "tool_call", id: run, name: "bash", args: { command, cwd: "/home/majke/Projekty/kod" } });
  const d = await ask(
    { bot: bot.id, chat: chat.id, tool: "bash", title: "Uruchomić polecenie?", detail: `${command}\n\nw: /home/majke/Projekty/kod`, canGrant: true },
    signal,
  );
  if (d === "deny") {
    emit({ type: "tool_result", id: run, text: "Użytkownik odmówił zgody.", error: true, approval: d });
    emit({ type: "text", text: "\n\n" });
    return words("Dobrze, nie uruchamiam testów. Co mam zrobić zamiast tego?");
  }
  await wait(900);
  emit({ type: "tool_result", id: run, text: "running 12 tests\n............\ntest result: ok. 12 passed; 0 failed", error: false, approval: d });
  emit({ type: "text", text: "\n\n" });
  await words("Testy przechodzą: **12/12**. `main.rs` wypisuje tylko powitanie, więc jest gdzie rosnąć.");
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
    if (def.builtin) throw new Error("wbudowanego bota nie da się utworzyć drugi raz");
    if (all[def.id]) throw new Error(`bot „${def.id}” już istnieje`);
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
    if (get(all, id).def.builtin) throw new Error("wbudowanego bota nie da się usunąć");
    delete all[id];
    save(all);
  },
  async botMemory(id) {
    const b = get(load(), id);
    return { memory: b.memory, user: b.user };
  },
  async botMemorySave(id, target, text) {
    const limit = target === "memory" ? MEMORY_LIMIT : USER_LIMIT;
    if (text.length > limit) throw new Error(`pamięć „${target}”: ${text.length}/${limit} znaków – za dużo`);
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
    return MOCK_SOURCES.map(({ name, description }) => ({ name, description }));
  },
  async botSkillImport(id, name) {
    const src = MOCK_SOURCES.find((s) => s.name === name);
    if (!src) throw new Error(`nie ma skilla „${name}” w ~/.claude/skills`);
    const all = load();
    const b = get(all, id);
    if (b.skills[name]) throw new Error(`skill „${name}” już jest u tego bota`);
    b.skills[name] = { md: skillMarkdown({ name, description: src.description, body: src.body }), updated: Date.now(), by: "import" };
    save(all);
    return name;
  },
  async botAvatarImport() {
    throw new Error("obrazek awatara działa tylko w oknie aplikacji");
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
};
