import { describe, expect, it } from "vitest";
import {
  applyBotEvent,
  botGreeting,
  botId,
  botSystemPrompt,
  botTurns,
  clipResult,
  commandPrefix,
  creatorBot,
  isInside,
  matchesPrefix,
  messageSegments,
  MEMORY_LIMIT,
  MEMORY_SEP,
  memoryEdit,
  needsApproval,
  newBot,
  newBotChat,
  nextRun,
  parseBot,
  parseBotChat,
  parseRoutines,
  parseSkill,
  scheduleLabel,
  serializeBot,
  skillMarkdown,
  toolLabel,
  type ApprovalContext,
  type BotChat,
  type BotDef,
  type PromptContext,
} from "./bot";

// Harmonogram liczy w czasie lokalnym; strefa Europe/Warsaw ustawiona w vitest.config.ts.
const local = (y: number, mo: number, d: number, h = 0, mi = 0) => new Date(y, mo - 1, d, h, mi).getTime();

describe("botId", () => {
  it("polskie znaki i spacje", () => {
    expect(botId("Żółty Łoś – newsy", [])).toBe("zolty-los-newsy");
  });
  it("puste imię i powtórki", () => {
    expect(botId("!!!", [])).toBe("bot");
    expect(botId("Rust", ["rust", "rust-2"])).toBe("rust-3");
  });
});

describe("parseBot", () => {
  it("poprawny bot przechodzi w obie strony", () => {
    const b = newBot("rust", 5, { name: "Rust", persona: "Pomagam w Ruście.", tone: "playful", folders: ["/home/x/kod"], model: { provider: "claude", model: "haiku" } });
    const r = parseBot(JSON.parse(serializeBot(b)));
    expect(r.errors).toEqual([]);
    expect(r.bot).toEqual(b);
  });
  it("bez id → null", () => {
    expect(parseBot({ name: "x" }).bot).toBeNull();
    expect(parseBot({ id: "Złe Id" }).bot).toBeNull();
    expect(parseBot(null).bot).toBeNull();
  });
  it("złe pola → domyślne z błędami", () => {
    const r = parseBot({ id: "a", name: "A", color: "red", tone: "angry", model: "x", folders: ["/ok", "wzgl"], tools: { bash: false, nieznane: true } });
    expect(r.bot?.color).toBe(newBot("a", 0).color);
    expect(r.bot?.tone).toBe("balanced");
    expect(r.bot?.model).toBeNull();
    expect(r.bot?.folders).toEqual(["/ok"]);
    expect(r.bot?.tools.bash).toBe(false);
    expect(r.bot?.tools.read).toBe(true);
    expect(r.errors).toHaveLength(4);
  });
  it("obrazek awatara tylko jako nazwa pliku", () => {
    expect(parseBot({ id: "a", name: "A", avatar: { image: "../../etc/passwd" } }).bot?.avatar).toEqual({ emoji: "🤖" });
    expect(parseBot({ id: "a", name: "A", avatar: { image: "avatar.png" } }).bot?.avatar).toEqual({ image: "avatar.png" });
  });
});

describe("parseRoutines", () => {
  it("poprawne i złe zadania", () => {
    const r = parseRoutines({
      routines: [
        { id: "a", prompt: "Newsy", schedule: { kind: "daily", at: "08:00", days: [5, 1, 1] }, allow: { bash: ["git pull", " ", 3] } },
        { id: "b", prompt: "Co 3", schedule: { kind: "every", minutes: 3 } },
        { id: "a", prompt: "dup", schedule: { kind: "every", minutes: 10 } },
        { id: "c", prompt: "x", schedule: { kind: "daily", at: "25:00" } },
        { id: "d", prompt: "  ", schedule: { kind: "every", minutes: 10 } },
        { id: "e", prompt: "Co godzinę", schedule: { kind: "every", minutes: 60 }, enabled: false, lastRun: 7 },
      ],
    });
    expect(r.routines.map((x) => x.id)).toEqual(["a", "e"]);
    expect(r.routines[0]).toMatchObject({ name: "Newsy", schedule: { days: [1, 5] }, allow: { writeWork: false, bash: ["git pull"] }, enabled: true });
    expect(r.routines[1]).toMatchObject({ enabled: false, lastRun: 7 });
    expect(r.errors).toHaveLength(4);
  });
  it("brak pliku = pusto bez błędu", () => {
    expect(parseRoutines(undefined)).toEqual({ routines: [], errors: [] });
    expect(parseRoutines({}).errors).toHaveLength(1);
  });
});

describe("nextRun", () => {
  it("every liczy od ostatniego przebiegu", () => {
    expect(nextRun({ kind: "every", minutes: 15 }, 1000)).toBe(1000 + 15 * 60_000);
  });
  it("daily: dziś później albo jutro", () => {
    expect(nextRun({ kind: "daily", at: "08:00" }, local(2026, 10, 1, 7, 59))).toBe(local(2026, 10, 1, 8, 0));
    expect(nextRun({ kind: "daily", at: "08:00" }, local(2026, 10, 1, 8, 0))).toBe(local(2026, 10, 2, 8, 0));
  });
  it("przejście przez północ i koniec miesiąca", () => {
    expect(nextRun({ kind: "daily", at: "00:05" }, local(2026, 10, 31, 23, 50))).toBe(local(2026, 11, 1, 0, 5));
  });
  it("dni tygodnia", () => {
    // 2026-10-02 to piątek; pn–pt 08:00 po piątkowym przebiegu → poniedziałek 5.10
    const s = { kind: "daily" as const, at: "08:00", days: [1, 2, 3, 4, 5] };
    expect(new Date(local(2026, 10, 2)).getDay()).toBe(5);
    expect(nextRun(s, local(2026, 10, 2, 8, 0))).toBe(local(2026, 10, 5, 8, 0));
  });
  it("zmiana na czas letni: 02:30 nie istnieje → 03:30", () => {
    const t = nextRun({ kind: "daily", at: "02:30" }, local(2026, 3, 28, 12));
    const d = new Date(t);
    expect([d.getDate(), d.getHours(), d.getMinutes()]).toEqual([29, 3, 30]);
  });
  it("zmiana na czas zimowy: 02:30 występuje dwa razy, przebieg raz", () => {
    const s = { kind: "daily" as const, at: "02:30" };
    const first = nextRun(s, local(2026, 10, 24, 12));
    expect(new Date(first).getDate()).toBe(25);
    const second = nextRun(s, first);
    expect(new Date(second).getDate()).toBe(26);
    expect(new Date(second).getHours()).toBe(2);
  });
});

describe("scheduleLabel", () => {
  it("opisy", () => {
    expect(scheduleLabel({ kind: "every", minutes: 15 })).toBe("co 15 min");
    expect(scheduleLabel({ kind: "every", minutes: 120 })).toBe("co 2 h");
    expect(scheduleLabel({ kind: "daily", at: "08:00" })).toBe("codziennie 08:00");
    expect(scheduleLabel({ kind: "daily", at: "08:00", days: [1, 2, 3, 4, 5] })).toBe("pn–pt 08:00");
    expect(scheduleLabel({ kind: "daily", at: "08:00", days: [0, 6] })).toBe("weekendy 08:00");
    expect(scheduleLabel({ kind: "daily", at: "08:00", days: [0, 1, 3] })).toBe("pn, śr, nd 08:00");
  });
});

describe("parseSkill", () => {
  it("frontmatter i treść", () => {
    const s = parseSkill('---\nname: rust-news\ndescription: "Przegląd: newsy o Ruście"\n---\n\n# Kroki\n1. Szukaj');
    expect(s).toEqual({ name: "rust-news", description: "Przegląd: newsy o Ruście", body: "\n# Kroki\n1. Szukaj" });
  });
  it("złe nazwy i brak opisu", () => {
    expect(parseSkill("bez nagłówka")).toHaveProperty("error");
    expect(parseSkill("---\nname: Rust News\ndescription: x\n---\n")).toHaveProperty("error");
    expect(parseSkill("---\nname: a--b\ndescription: x\n---\n")).toHaveProperty("error");
    expect(parseSkill("---\nname: ok\n---\n")).toHaveProperty("error");
  });
  it("skillMarkdown → parseSkill wraca do tego samego", () => {
    const s = { name: "a-b", description: 'Opis: z dwukropkiem i "cudzysłowem"', body: "Treść\n" };
    expect(parseSkill(skillMarkdown(s))).toEqual({ ...s, body: "\nTreść\n" });
  });
});

describe("memoryEdit", () => {
  const mem = ["Lubi Rusta", "Pracuje na CachyOS"].join(MEMORY_SEP);
  it("add, bez powtórzeń", () => {
    const r = memoryEdit(mem, { kind: "add", text: " Mówi po polsku " }, MEMORY_LIMIT);
    expect(r).toEqual({ ok: true, text: [...mem.split(MEMORY_SEP), "Mówi po polsku"].join(MEMORY_SEP) });
    expect(memoryEdit(mem, { kind: "add", text: "Lubi Rusta" }, MEMORY_LIMIT)).toEqual({ ok: true, text: mem });
  });
  it("replace i remove po fragmencie", () => {
    expect(memoryEdit(mem, { kind: "replace", old: "CachyOS", text: "Pracuje na Arch" }, MEMORY_LIMIT)).toEqual({ ok: true, text: `Lubi Rusta${MEMORY_SEP}Pracuje na Arch` });
    expect(memoryEdit(mem, { kind: "remove", old: "Rusta" }, MEMORY_LIMIT)).toEqual({ ok: true, text: "Pracuje na CachyOS" });
  });
  it("brak i wiele dopasowań", () => {
    expect(memoryEdit(mem, { kind: "remove", old: "Go" }, MEMORY_LIMIT).ok).toBe(false);
    const r = memoryEdit(mem, { kind: "remove", old: "a" }, MEMORY_LIMIT);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain("2 wpisów");
  });
  it("limit: błąd z całą pamięcią, tekst bez zmian", () => {
    const r = memoryEdit(mem, { kind: "add", text: "x".repeat(40) }, 50);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.text).toBe(mem);
      expect(r.error).toContain(mem);
    }
  });
  it("§ zarezerwowany", () => {
    expect(memoryEdit("", { kind: "add", text: "a § b" }, MEMORY_LIMIT).ok).toBe(false);
  });
});

describe("botSystemPrompt", () => {
  const bot = newBot("rust", 0, { name: "Rusty", persona: "Pomagam w Ruście.", style: "Jak pirat.", tone: "playful", folders: ["/home/u/kod"] });
  const ctx: PromptContext = {
    memory: `b${MEMORY_SEP}a`,
    user: "",
    skills: [
      { name: "z-skill", description: "ostatni" },
      { name: "a-skill", description: "pierwszy" },
    ],
    now: local(2026, 10, 1, 9),
    work: "/home/u/.config/dev.majke.agents/bots/rust/work",
  };
  it("ten sam stan w ciągu dnia = ten sam tekst", () => {
    expect(botSystemPrompt(bot, ctx)).toBe(botSystemPrompt(bot, { ...ctx, now: local(2026, 10, 1, 23, 59), skills: [...ctx.skills].reverse() }));
    expect(botSystemPrompt(bot, ctx)).not.toBe(botSystemPrompt(bot, { ...ctx, now: local(2026, 10, 2, 0, 1) }));
  });
  it("sekcje w kolejności", () => {
    const p = botSystemPrompt(bot, ctx);
    expect(p.startsWith("Nazywasz się Rusty. Pomagam w Ruście.")).toBe(true);
    const order = ["Styl wypowiedzi", "# Narzędzia", "# Pamięć [", "# Użytkownik [0% – 0/1400", "# Skille", "Dzisiaj: 2026-10-01."];
    const at = order.map((s) => p.indexOf(s));
    expect(at.every((x) => x >= 0)).toBe(true);
    expect([...at].sort((a, b) => a - b)).toEqual(at);
    expect(p.indexOf("a-skill")).toBeLessThan(p.indexOf("z-skill"));
    expect(p).toContain("/home/u/kod");
  });
  it("bez narzędzi i z harmonogramem", () => {
    const quiet = newBot("q", 0, { name: "Q", tools: { web: false, read: false, write: false, bash: false, memory: false, skills: false } });
    const p = botSystemPrompt(quiet, { ...ctx, routine: "Poranne newsy" });
    expect(p).toContain("Nie masz narzędzi");
    expect(p).not.toContain("# Pamięć");
    expect(p).toContain("# Zadanie z harmonogramu: Poranne newsy");
    expect(botSystemPrompt(creatorBot(0), ctx)).toContain("bot_create");
  });
});

describe("botGreeting", () => {
  it("pierwsze zdanie persony", () => {
    expect(botGreeting(newBot("a", 0, { persona: "Ahoj! Jestem piratem v1.2 od kodu." }))).toBe("Ahoj!");
    expect(botGreeting(newBot("a", 0, { persona: "Jestem v1.2 bez kropki na końcu" }))).toBe("Jestem v1.2 bez kropki na końcu");
    expect(botGreeting(newBot("a", 0, { name: "Zed" }))).toBe("Cześć, tu Zed.");
  });
});

describe("prefiksy poleceń", () => {
  it("commandPrefix", () => {
    expect(commandPrefix("cargo test --release")).toBe("cargo test");
    expect(commandPrefix("ls -la")).toBe("ls");
    expect(commandPrefix("git pull; rm -rf ~")).toBeNull();
    expect(commandPrefix("echo $(whoami)")).toBeNull();
  });
  it("matchesPrefix na granicy słowa, bez doklejania", () => {
    expect(matchesPrefix("git pull", "git pull")).toBe(true);
    expect(matchesPrefix("git  pull  --rebase", "git pull")).toBe(true);
    expect(matchesPrefix("git pullx", "git pull")).toBe(false);
    expect(matchesPrefix("git pull && rm -rf ~", "git pull")).toBe(false);
    expect(matchesPrefix("git pull | sh", "git pull")).toBe(false);
    expect(matchesPrefix("git pull > /etc/x", "git pull")).toBe(false);
    expect(matchesPrefix("git pull\nrm x", "git pull")).toBe(false);
    expect(matchesPrefix("ls", "")).toBe(false);
  });
  it("isInside", () => {
    expect(isInside("/a/b", "/a/b")).toBe(true);
    expect(isInside("/a/b/c", "/a/b")).toBe(true);
    expect(isInside("/a/bc", "/a/b")).toBe(false);
    expect(isInside("/a/b/c", "/a/b/")).toBe(true);
  });
});

describe("needsApproval", () => {
  const bot: BotDef = newBot("b", 0, { folders: ["/home/u/kod"] });
  const ctx: ApprovalContext = { bot, work: "/cfg/bots/b/work", folders: ["/home/u/kod"], grants: [] };
  it("sieć, pamięć, skille bez pytania", () => {
    expect(needsApproval("web_search", { query: "x" }, ctx)).toBe("allow");
    expect(needsApproval("memory", {}, ctx)).toBe("allow");
    expect(needsApproval("skill_create", {}, ctx)).toBe("allow");
  });
  it("wyłączona grupa = deny", () => {
    const off = { ...ctx, bot: { ...bot, tools: { ...bot.tools, bash: false, web: false } } };
    expect(needsApproval("bash", { command: "ls" }, off)).toBe("deny");
    expect(needsApproval("web_fetch", { url: "x" }, off)).toBe("deny");
  });
  it("odczyt w folderach bez pytania, poza nimi pytanie (też dla ../ po realpath)", () => {
    expect(needsApproval("read_file", { path: "/home/u/kod/src/a.rs" }, ctx)).toBe("allow");
    expect(needsApproval("list_dir", { path: "/cfg/bots/b/work" }, ctx)).toBe("allow");
    // `/home/u/kod/../.ssh/id` po realpath to `/home/u/.ssh/id`
    expect(needsApproval("read_file", { path: "/home/u/.ssh/id" }, ctx)).toBe("ask");
    expect(needsApproval("read_file", { path: "/home/u/kodx/a" }, ctx)).toBe("ask");
    expect(needsApproval("grep", {}, ctx)).toBe("ask");
  });
  it("dowiązanie z folderu na zewnątrz: decyduje cel po realpath", () => {
    // /home/u/kod/link → /etc; narzędzie podaje już /etc/passwd
    expect(needsApproval("read_file", { path: "/etc/passwd" }, ctx)).toBe("ask");
  });
  it("zapis: w work swobodnie, gdzie indziej pytanie, zgoda w rozmowie działa", () => {
    expect(needsApproval("write_file", { path: "/cfg/bots/b/work/notatki.md" }, ctx)).toBe("allow");
    expect(needsApproval("edit_file", { path: "/home/u/kod/a.rs" }, ctx)).toBe("ask");
    expect(needsApproval("edit_file", { path: "/home/u/kod/a.rs" }, { ...ctx, grants: [{ tool: "edit_file" }] })).toBe("allow");
    expect(needsApproval("write_file", { path: "/home/u/kod/a.rs" }, { ...ctx, grants: [{ tool: "edit_file" }] })).toBe("ask");
  });
  it("bash: zawsze pytanie, chyba że zgoda z pasującym prefiksem", () => {
    expect(needsApproval("bash", { command: "ls" }, ctx)).toBe("ask");
    const g = { ...ctx, grants: [{ tool: "bash" as const, prefix: "cargo test" }] };
    expect(needsApproval("bash", { command: "cargo test -q" }, g)).toBe("allow");
    expect(needsApproval("bash", { command: "cargo test; rm -rf ~" }, g)).toBe("ask");
    expect(needsApproval("bash", { command: "cargo build" }, g)).toBe("ask");
    // zgoda bez prefiksu nie otwiera całej powłoki
    expect(needsApproval("bash", { command: "ls" }, { ...ctx, grants: [{ tool: "bash" }] })).toBe("ask");
  });
  it("harmonogram: tylko zgody z góry, zgody z rozmowy się nie liczą", () => {
    const r = { ...ctx, routine: { writeWork: false, bash: ["git pull"] }, grants: [{ tool: "edit_file" as const }] };
    expect(needsApproval("write_file", { path: "/cfg/bots/b/work/x" }, r)).toBe("ask");
    expect(needsApproval("write_file", { path: "/cfg/bots/b/work/x" }, { ...r, routine: { writeWork: true, bash: [] } })).toBe("allow");
    expect(needsApproval("edit_file", { path: "/home/u/kod/a" }, r)).toBe("ask");
    expect(needsApproval("bash", { command: "git pull --ff-only" }, r)).toBe("allow");
    expect(needsApproval("bash", { command: "git push" }, r)).toBe("ask");
    expect(needsApproval("read_file", { path: "/home/u/kod/a" }, r)).toBe("allow");
  });
  it("narzędzia Kreatora: tylko Kreator, zawsze pytanie", () => {
    expect(needsApproval("bot_create", {}, ctx)).toBe("deny");
    const c = { ...ctx, bot: creatorBot(0) };
    expect(needsApproval("bot_create", {}, c)).toBe("ask");
    expect(needsApproval("bot_update", {}, { ...c, routine: { writeWork: false, bash: [] } })).toBe("deny");
  });
});

describe("rozmowy bota", () => {
  it("newBotChat → parseBotChat", () => {
    const c = newBotChat("c1", "rust", 5, { provider: "claude", model: "haiku" }, "r1");
    expect(parseBotChat(JSON.stringify(c))).toEqual(c);
  });
  it("zwykła rozmowa z Czatu to nie rozmowa bota", () => {
    expect(parseBotChat(JSON.stringify({ version: 1, id: "x", messages: [] }))).toBeNull();
    expect(parseBotChat("{")).toBeNull();
  });
  it("brak calls → pusta lista", () => {
    expect(parseBotChat(JSON.stringify({ version: 1, id: "x", bot: "b", messages: [] }))?.calls).toEqual([]);
  });
});

describe("clipResult", () => {
  it("ucina z informacją", () => {
    expect(clipResult("abc", 5)).toBe("abc");
    expect(clipResult("abcdefgh", 5)).toBe("abcde\n… [ucięte, 3 znaków więcej]");
  });
});

describe("applyBotEvent i botTurns", () => {
  const ref = { provider: "llama", model: "qwen" };
  const start = (): BotChat => {
    const c = newBotChat("c1", "rust", 1, ref);
    c.messages = [
      { id: "u1", role: "user", text: "Co jest w src?", at: 1 },
      { id: "a1", role: "assistant", text: "", at: 2 },
    ];
    return c;
  };
  const play = (c: BotChat, events: Parameters<typeof applyBotEvent>[2][]) => events.reduce((acc, e) => applyBotEvent(acc, "a1", e), c);

  it("wywołania z pozycją w tekście, wyniki, flaga; historia rozpada się na kroki", () => {
    const c = play(start(), [
      { type: "text", text: "Sprawdzę." },
      { type: "tool_call", id: "t1", name: "list_dir", args: { path: "src" } },
      { type: "tool_call", id: "t2", name: "read_file", args: { path: "x" } },
      { type: "tool_result", id: "t1", text: "main.rs", error: false, approval: "auto" },
      { type: "tool_result", id: "t2", text: "nie ma pliku", error: true, approval: "once" },
      { type: "text", text: "\n\n" },
      { type: "text", text: "Jest main.rs." },
      { type: "tools_unsupported" },
    ]);
    expect(c.messages[1].text).toBe("Sprawdzę.\n\nJest main.rs.");
    expect(c.calls).toEqual([
      { id: "t1", message: "a1", name: "list_dir", args: { path: "src" }, at: 9, result: "main.rs", approval: "auto" },
      { id: "t2", message: "a1", name: "read_file", args: { path: "x" }, at: 9, error: "nie ma pliku", approval: "once" },
    ]);
    expect(c.toolsUnsupported).toBe(true);
    expect(botTurns(c)).toEqual([
      { role: "user", content: "Co jest w src?" },
      { role: "assistant", content: "Sprawdzę.", calls: [{ id: "t1", name: "list_dir", args: { path: "src" } }, { id: "t2", name: "read_file", args: { path: "x" } }] },
      { role: "tool", id: "t1", content: "main.rs" },
      { role: "tool", id: "t2", content: "nie ma pliku", error: true },
      { role: "assistant", content: "Jest main.rs." },
    ]);
  });

  it("wynik trafia do ostatniego wywołania o tym id w tej odpowiedzi; nieznana odpowiedź = bez zmian", () => {
    let c = start();
    c.calls = [{ id: "call_1", message: "stara", name: "bash", args: {} }];
    c = play(c, [
      { type: "tool_call", id: "call_1", name: "list_dir", args: {} },
      { type: "tool_result", id: "call_1", text: "ok", error: false, approval: "auto" },
    ]);
    expect(c.calls[0].result).toBeUndefined();
    expect(c.calls[1].result).toBe("ok");
    expect(applyBotEvent(c, "nie-ma", { type: "text", text: "x" })).toBe(c);
  });

  it("wywołanie bez wyniku (Stop) = „przerwane”, odpowiedź z błędem wypada razem z wywołaniami", () => {
    const c = start();
    c.messages.push(
      { id: "u2", role: "user", text: "A teraz?", at: 3 },
      { id: "a2", role: "assistant", text: "Psuje się", at: 4, error: "błąd serwera 500" },
      { id: "u3", role: "user", text: "Jeszcze raz", at: 5 },
    );
    c.calls = [
      { id: "s1", message: "a1", name: "bash", args: { command: "ls" }, at: 0 },
      { id: "e1", message: "a2", name: "bash", args: { command: "x" }, at: 0, result: "?" },
    ];
    expect(botTurns(c)).toEqual([
      { role: "user", content: "Co jest w src?" },
      { role: "assistant", content: "", calls: [{ id: "s1", name: "bash", args: { command: "ls" } }] },
      { role: "tool", id: "s1", content: "przerwane (Stop)", error: true },
      { role: "user", content: "A teraz?\n\nJeszcze raz" },
    ]);
  });
});

describe("karty narzędzi", () => {
  it("toolLabel: ścieżka skrócona, polecenie w jednej linii, strona po domenie", () => {
    expect(toolLabel("read_file", { path: "/home/majke/kod/src/main.rs" })).toBe("Czyta `…/src/main.rs`");
    expect(toolLabel("read_file", { path: "notatki.md" })).toBe("Czyta `notatki.md`");
    expect(toolLabel("bash", { command: "cargo test\necho x" })).toBe("Uruchamia `cargo test`");
    expect(toolLabel("web_fetch", { url: "https://www.rust-lang.org/learn" })).toBe("Czyta stronę rust-lang.org");
    expect(toolLabel("list_dir", {})).toBe("Przegląda folder `.`");
    expect(toolLabel("memory", { target: "user", text: "x" })).toBe("Zapisuje coś o tobie");
    expect(toolLabel("cos", {})).toBe("Używa cos");
  });

  it("messageSegments: tekst, krok z wywołaniami, dalszy tekst; puste części pominięte", () => {
    const c = (id: string, at?: number) => ({ id, message: "m", name: "bash", args: {}, ...(at === undefined ? {} : { at }) });
    expect(messageSegments("Sprawdzę.\n\nGotowe.", [c("a", 9), c("b", 9)])).toEqual([
      { kind: "text", text: "Sprawdzę." },
      { kind: "calls", calls: [c("a", 9), c("b", 9)] },
      { kind: "text", text: "\n\nGotowe." },
    ]);
    expect(messageSegments("", [c("a")])).toEqual([{ kind: "calls", calls: [c("a")] }]);
    expect(messageSegments("", [])).toEqual([{ kind: "text", text: "" }]);
  });
});
