import { describe, expect, it } from "vitest";
import {
  attention,
  cardAnswer,
  finishedNote,
  overviewText,
  runVoiceTool,
  voiceTools,
  type CardDecision,
  type DeployCard,
  type DeployTask,
  type VoiceHost,
  type VoicePane,
  type VoiceProject,
} from "./tools";

const pane = (patch: Partial<VoicePane> = {}): VoicePane => ({ id: "a1b2c3", agent: "Claude", title: "backend", working: true, unread: false, ...patch });

const PROJECTS: VoiceProject[] = [
  { id: "p00001", name: "Agents", active: true, panes: [pane()] },
  { id: "p00002", name: "Strona", active: false, panes: [pane({ id: "d4e5f6", agent: "pi", title: "", working: false, unread: true, account: "praca" })] },
];

/** Udawany gospodarz: projekty w pamięci, karta rozstrzygana z góry, akcje zapisywane. */
function host(opts: { projects?: VoiceProject[]; free?: number; decision?: CardDecision } = {}) {
  const cards: DeployCard[] = [];
  const log: unknown[][] = [];
  const h: VoiceHost = {
    projects: () => opts.projects ?? PROJECTS,
    agents: () => [
      { id: "claude", name: "Claude", accounts: ["praca", "prywatne"], models: ["claude-opus-5-5", "claude-sonnet-5-5"] },
      { id: "pi", name: "pi", accounts: [], models: [] },
    ],
    presets: () => [{ name: "Para", agents: ["claude", "pi"] }],
    free: () => opts.free ?? 4,
    confirm: async (card) => (cards.push(card), opts.decision ?? { kind: "run" }),
    open: async (project, tasks) => (log.push(["open", project, tasks]), `otwarto ${tasks.length}`),
    send: (id, text) => (log.push(["send", id, text]), null),
    read: (id) => (id === "a1b2c3" ? "linia 1\nlinia 2" : null),
    show: (t) => void log.push(["show", t]),
    control: (id, action) => (log.push(["control", id, action]), null),
    continueTargets: () => ["Claude · prywatne", "pi"],
    continueTo: (id, target) => (log.push(["continue", id, target]), null),
    applyPreset: (project, name) => (log.push(["preset", project, name]), null),
    bots: async () => [{ id: "bosman", name: "Bosman", about: "pirat od newsów" }],
    askBot: async (id, q) => `odp ${id}: ${q}`,
  };
  return { h, cards, log };
}

const signal = new AbortController().signal;
const task = (agent = "claude"): DeployTask => ({ agent, title: "testy", prompt: "Napisz testy do parsera." });

describe("przegląd", () => {
  it("attention: padł > limit > nieprzeczytane > kontekst", () => {
    expect(attention(pane())).toBeNull();
    expect(attention(pane({ exited: 1, limit: "x", unread: true }))).toBe("proces padł (kod 1)");
    expect(attention(pane({ limit: "do 14:00", unread: true }))).toBe("limit konta: do 14:00");
    expect(attention(pane({ unread: true }))).toMatch(/skończył pracę/);
    expect(attention(pane({ ctx: 85 }))).toMatch(/kontekst 85%/);
  });

  it("overview: projekty, panele i lista „wymaga uwagi”", () => {
    const t = overviewText(PROJECTS);
    expect(t).toContain("Projekt p00001 „Agents” (aktywny): 1 panel(i), pracuje 1");
    expect(t).toContain("- a1b2c3: Claude, „backend”, pracuje");
    expect(t).toContain("- d4e5f6: pi (konto praca), bez tytułu, czeka – UWAGA: skończył pracę");
    expect(t).toMatch(/Wymaga uwagi:\n- pi „d4e5f6” w „Strona”: skończył pracę/);
    expect(overviewText([{ id: "x", name: "x", active: true, panes: [pane()] }])).toContain("Nic nie wymaga uwagi.");
  });

  it("komunikat o końcu pracy", () => {
    expect(finishedNote({ agent: "Claude", title: "testy", project: "Agents" })).toBe("Claude od „testy” w projekcie Agents skończył pracę.");
  });
});

describe("runVoiceTool", () => {
  it("read_pane czyta panel z dowolnego projektu po krótkim albo pełnym id", async () => {
    const { h } = host();
    expect(await runVoiceTool("read_pane", { id: "a1b2c3-0000-uuid" }, h, signal)).toEqual({ ok: true, text: "linia 1\nlinia 2" });
    expect((await runVoiceTool("read_pane", { id: "d4e5f6" }, h, signal)).text).toMatch(/nie ma terminala/);
    expect((await runVoiceTool("read_pane", { id: "zzz" }, h, signal)).text).toMatch(/nie ma panelu „zzz”/);
  });

  it("show bez karty: panel przełącza na terminale, projekt po nazwie, sama zakładka", async () => {
    const { h, log, cards } = host();
    expect((await runVoiceTool("show", { pane: "d4e5f6", maximize: true }, h, signal)).ok).toBe(true);
    await runVoiceTool("show", { project: "stron" }, h, signal);
    await runVoiceTool("show", { tab: "bot" }, h, signal);
    expect(log).toEqual([
      ["show", { pane: "d4e5f6", tab: "code", maximize: true }],
      ["show", { project: "p00002", tab: "code" }],
      ["show", { tab: "bot" }],
    ]);
    expect(cards).toEqual([]);
    expect((await runVoiceTool("show", {}, h, signal)).ok).toBe(false);
    expect((await runVoiceTool("show", { tab: "pulpit" }, h, signal)).ok).toBe(false);
  });

  it("open_panes: karta, projekt, konto i model po nazwie", async () => {
    const { h, cards, log } = host();
    const r = await runVoiceTool(
      "open_panes",
      { project: "Strona", tasks: [{ ...task("Claude"), account: "Prywatne", model: "opus" }, task("pi")] },
      h,
      signal,
    );
    expect(r).toEqual({ ok: true, text: "otwarto 2" });
    expect(cards[0].head).toBe("Otworzyć 2 panele w „Strona”?");
    expect(log[0]).toEqual(["open", "p00002", [{ ...task(), account: "prywatne", model: "claude-opus-5-5" }, task("pi")]]);
  });

  it("open_panes: odmowa, poprawka, limit, nieznany agent i konto – bez otwierania", async () => {
    const no = host({ decision: { kind: "cancel" } });
    expect((await runVoiceTool("open_panes", { tasks: [task()] }, no.h, signal)).text).toMatch(/użytkownik odmówił/);
    expect(no.log).toEqual([]);
    const fix = host({ decision: { kind: "fix", note: "dodaj pi" } });
    expect((await runVoiceTool("open_panes", { tasks: [task()] }, fix.h, signal)).text).toMatch(/poprawić: „dodaj pi”/);
    const { h, cards } = host({ free: 1 });
    expect((await runVoiceTool("open_panes", { tasks: [task(), task()] }, h, signal)).text).toMatch(/jeszcze 1 panel/);
    expect((await runVoiceTool("open_panes", { tasks: [task("gemini")] }, h, signal)).text).toMatch(/nieznany agent „gemini” \(dostępni: claude, pi\)/);
    expect((await runVoiceTool("open_panes", { tasks: [{ ...task("pi"), account: "x" }] }, h, signal)).text).toMatch(/pi nie ma konta „x”/);
    expect((await runVoiceTool("open_panes", { tasks: [{ agent: "pi", title: "", prompt: "x" }] }, h, signal)).ok).toBe(false);
    expect((await runVoiceTool("open_panes", { project: "brak", tasks: [task()] }, h, signal)).text).toMatch(/nie ma projektu „brak”/);
    expect(cards).toEqual([]);
  });

  it("bez aktywnego projektu open_panes prosi o projekt", async () => {
    const { h } = host({ projects: [{ ...PROJECTS[1] }] });
    expect((await runVoiceTool("open_panes", { tasks: [task()] }, h, signal)).text).toMatch(/nie ma aktywnego projektu/);
  });

  it("send_to_pane i pane_control: karta z panelem, wykonanie po „tak”, nic po odmowie", async () => {
    const { h, cards, log } = host();
    expect(await runVoiceTool("send_to_pane", { id: "a1b2c3", text: "Puść testy" }, h, signal)).toEqual({ ok: true, text: "wysłano do a1b2c3 (Claude)" });
    expect(cards[0]).toEqual({ head: "Wysłać do panelu?", action: "Wyślij", tasks: [{ agent: "Claude", title: "backend", prompt: "Puść testy" }] });
    expect((await runVoiceTool("pane_control", { id: "d4e5f6", action: "close" }, h, signal)).ok).toBe(true);
    expect(cards[1]).toMatchObject({ head: "Zamknąć panel?", action: "Zamknij", tasks: [{ agent: "pi", account: "praca" }] });
    expect(log).toEqual([
      ["send", "a1b2c3", "Puść testy"],
      ["control", "d4e5f6", "close"],
    ]);
    expect((await runVoiceTool("pane_control", { id: "a1b2c3", action: "kill" }, h, signal)).ok).toBe(false);
    const no = host({ decision: { kind: "cancel" } });
    await runVoiceTool("pane_control", { id: "a1b2c3", action: "stop" }, no.h, signal);
    expect(no.log).toEqual([]);
  });

  it("continue_elsewhere: bez celu lista, z celem karta i przekazanie", async () => {
    const { h, log } = host();
    expect((await runVoiceTool("continue_elsewhere", { id: "a1b2c3" }, h, signal)).text).toBe("Cele: Claude · prywatne; pi");
    expect((await runVoiceTool("continue_elsewhere", { id: "a1b2c3", target: "pi" }, h, signal)).ok).toBe(true);
    expect(log).toEqual([["continue", "a1b2c3", "pi"]]);
    expect((await runVoiceTool("continue_elsewhere", { id: "a1b2c3", target: "codex" }, h, signal)).ok).toBe(false);
  });

  it("apply_preset i list_agents", async () => {
    const { h, log, cards } = host();
    expect((await runVoiceTool("apply_preset", { name: "para" }, h, signal)).ok).toBe(true);
    expect(cards[0].tasks.map((t) => t.agent)).toEqual(["claude", "pi"]);
    expect(log).toEqual([["preset", "p00001", "Para"]]);
    expect((await runVoiceTool("apply_preset", { name: "trio" }, h, signal)).text).toMatch(/nie ma presetu „trio” \(są: Para\)/);
    const agents = (await runVoiceTool("list_agents", {}, h, signal)).text;
    expect(agents).toContain("claude (Claude), konta: praca, prywatne, modele: claude-opus-5-5, claude-sonnet-5-5");
    expect(agents).toContain("Para: claude, pi");
  });

  it("ask_bot: lista bez nazwy, pytanie po imieniu, błąd bota wraca do modelu", async () => {
    const { h } = host();
    expect((await runVoiceTool("ask_bot", {}, h, signal)).text).toBe("Bosman (bosman): pirat od newsów");
    expect(await runVoiceTool("ask_bot", { bot: "bosm", question: "Co nowego?" }, h, signal)).toEqual({ ok: true, text: "Bosman odpowiada:\nodp bosman: Co nowego?" });
    expect((await runVoiceTool("ask_bot", { bot: "kot", question: "x" }, h, signal)).ok).toBe(false);
    h.askBot = async () => {
      throw new Error("401");
    };
    expect(await runVoiceTool("ask_bot", { bot: "Bosman", question: "x" }, h, signal)).toEqual({ ok: false, text: "Bosman: 401" });
  });

  it("schemat open_panes wylicza dostępnych agentów", () => {
    const open = voiceTools(["claude", "pi"]).find((t) => t.name === "open_panes")!;
    expect(JSON.stringify(open.parameters)).toContain('"enum":["claude","pi"]');
  });
});

describe("cardAnswer", () => {
  it("krótkie tak / nie / popraw", () => {
    for (const t of ["Tak.", "OK, uruchom!", "no to dawaj", "Okej, deploy", "zamknij"]) expect(cardAnswer(t), t).toEqual({ kind: "run" });
    for (const t of ["Nie.", "anuluj", "nie, zostaw", "Stop!"]) expect(cardAnswer(t), t).toEqual({ kind: "cancel" });
    expect(cardAnswer("Popraw.")).toEqual({ kind: "fix" });
  });

  it("dłuższa wypowiedź to poprawka z treścią; pusta = brak decyzji", () => {
    expect(cardAnswer("tak, ale niech drugi robi testy")).toEqual({ kind: "fix", note: "tak, ale niech drugi robi testy" });
    expect(cardAnswer("zmień tytuł na parser")).toEqual({ kind: "fix", note: "zmień tytuł na parser" });
    expect(cardAnswer(" … ")).toBeNull();
  });
});
