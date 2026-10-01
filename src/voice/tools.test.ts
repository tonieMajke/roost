import { describe, expect, it } from "vitest";
import { cardAnswer, runVoiceTool, voiceTools, type CardDecision, type DeployCard, type DeployTask, type VoiceHost } from "./tools";
import type { VoicePane } from "./voice";

/** Udawany gospodarz: panele w pamięci, karta rozstrzygana z góry. */
function host(opts: { panes?: VoicePane[] | null; free?: number; decision?: CardDecision } = {}) {
  const cards: DeployCard[] = [];
  const opened: DeployTask[][] = [];
  const sent: [string, string][] = [];
  const h: VoiceHost = {
    panes: () => (opts.panes === undefined ? [{ id: "a1b2c3", agent: "claude", title: "backend", busy: true }] : opts.panes),
    agents: () => [
      { id: "claude", name: "Claude" },
      { id: "pi", name: "pi" },
    ],
    free: () => opts.free ?? 4,
    confirm: async (card) => (cards.push(card), opts.decision ?? { kind: "run" }),
    open: async (tasks) => (opened.push(tasks), `otwarto ${tasks.length}`),
    send: (id, text) => (sent.push([id, text]), null),
    read: (id) => (id === "a1b2c3" ? "linia 1\nlinia 2" : null),
  };
  return { h, cards, opened, sent };
}

const signal = new AbortController().signal;
const task = (agent = "claude") => ({ agent, title: "testy", prompt: "Napisz testy do parsera." });

describe("runVoiceTool", () => {
  it("list_panes: id, agent, tytuł, czy pracuje", async () => {
    const { h } = host();
    expect(await runVoiceTool("list_panes", {}, h, signal)).toEqual({ ok: true, text: "a1b2c3: claude, „backend”, pracuje" });
    expect((await runVoiceTool("list_panes", {}, host({ panes: [] }).h, signal)).text).toBe("projekt nie ma paneli");
  });

  it("bez aktywnego projektu każde narzędzie mówi, co zrobić", async () => {
    const r = await runVoiceTool("open_panes", { tasks: [task()] }, host({ panes: null }).h, signal);
    expect(r.ok).toBe(false);
    expect(r.text).toMatch(/nie ma otwartego projektu/);
  });

  it("open_panes: karta, potem otwarcie; agent także po nazwie", async () => {
    const { h, cards, opened } = host();
    const r = await runVoiceTool("open_panes", { tasks: [task("Claude"), task("pi")] }, h, signal);
    expect(r).toEqual({ ok: true, text: "otwarto 2" });
    expect(cards[0]).toEqual({ kind: "open", tasks: [task("claude"), task("pi")] });
    expect(opened).toEqual([[task("claude"), task("pi")]]);
  });

  it("open_panes: odrzucona karta = „użytkownik odmówił”, nic nie otwarte", async () => {
    const { h, opened } = host({ decision: { kind: "cancel" } });
    const r = await runVoiceTool("open_panes", { tasks: [task()] }, h, signal);
    expect(r.ok).toBe(false);
    expect(r.text).toMatch(/użytkownik odmówił/);
    expect(opened).toEqual([]);
    const fix = await runVoiceTool("open_panes", { tasks: [task()] }, host({ decision: { kind: "fix", note: "dodaj pi" } }).h, signal);
    expect(fix.text).toMatch(/poprawić: „dodaj pi”/);
  });

  it("open_panes: limit paneli, nieznany agent i puste zadanie bez karty", async () => {
    const { h, cards } = host({ free: 1 });
    expect((await runVoiceTool("open_panes", { tasks: [task(), task()] }, h, signal)).text).toMatch(/jeszcze 1 panel/);
    expect((await runVoiceTool("open_panes", { tasks: [task("gemini")] }, h, signal)).text).toMatch(/nieznany agent „gemini” \(dostępni: claude, pi\)/);
    expect((await runVoiceTool("open_panes", { tasks: [{ agent: "pi", title: "", prompt: "x" }] }, h, signal)).ok).toBe(false);
    expect((await runVoiceTool("open_panes", {}, h, signal)).ok).toBe(false);
    expect(cards).toEqual([]);
  });

  it("send_to_pane: karta z treścią, wysyłka po krótkim id; odmowa nic nie wysyła", async () => {
    const { h, cards, sent } = host();
    expect(await runVoiceTool("send_to_pane", { id: "a1b2c3", text: "Puść testy" }, h, signal)).toEqual({ ok: true, text: "wysłano do a1b2c3 (claude)" });
    expect(cards[0]).toEqual({ kind: "send", tasks: [{ agent: "claude", title: "backend", prompt: "Puść testy" }] });
    expect(sent).toEqual([["a1b2c3", "Puść testy"]]);
    // Pełne id panelu (UUID) też trafia.
    expect((await runVoiceTool("send_to_pane", { id: "a1b2c3d4-0000", text: "x" }, h, signal)).ok).toBe(true);
    const no = host({ decision: { kind: "cancel" } });
    expect((await runVoiceTool("send_to_pane", { id: "a1b2c3", text: "x" }, no.h, signal)).text).toMatch(/odmówił/);
    expect(no.sent).toEqual([]);
    expect((await runVoiceTool("send_to_pane", { id: "zzz", text: "x" }, h, signal)).text).toMatch(/nie ma panelu „zzz”/);
  });

  it("read_pane: ekran panelu albo błąd", async () => {
    const { h } = host();
    expect(await runVoiceTool("read_pane", { id: "a1b2c3" }, h, signal)).toEqual({ ok: true, text: "linia 1\nlinia 2" });
    expect((await runVoiceTool("read_pane", { id: "x" }, h, signal)).ok).toBe(false);
  });

  it("schemat open_panes wylicza dostępnych agentów", () => {
    const open = voiceTools(["claude", "pi"]).find((t) => t.name === "open_panes")!;
    expect(JSON.stringify(open.parameters)).toContain('"enum":["claude","pi"]');
  });
});

describe("cardAnswer", () => {
  it("krótkie tak / nie / popraw", () => {
    for (const t of ["Tak.", "OK, uruchom!", "no to dawaj", "Okej, deploy", "uruchom"]) expect(cardAnswer(t), t).toEqual({ kind: "run" });
    for (const t of ["Nie.", "anuluj", "nie, zostaw", "Stop!"]) expect(cardAnswer(t), t).toEqual({ kind: "cancel" });
    expect(cardAnswer("Popraw.")).toEqual({ kind: "fix" });
  });

  it("dłuższa wypowiedź to poprawka z treścią; pusta = brak decyzji", () => {
    expect(cardAnswer("tak, ale niech drugi robi testy")).toEqual({ kind: "fix", note: "tak, ale niech drugi robi testy" });
    expect(cardAnswer("zmień tytuł na parser")).toEqual({ kind: "fix", note: "zmień tytuł na parser" });
    expect(cardAnswer(" … ")).toBeNull();
  });
});
