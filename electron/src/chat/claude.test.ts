import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { applyEvent, extractSources, type ChatEvent, type ChatRequest, type Message } from "../../../src/chat";
import { ClaudeParser, claudeArgs, searchLinks } from "./claude";
import { runCli, type LineParser } from "./cli";

const fixture = (name: string) =>
  fs
    .readFileSync(path.join(__dirname, "fixtures", name), "utf8")
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l) as unknown);

const parse = (name: string) => {
  const p = new ClaudeParser();
  const events = fixture(name).flatMap((l) => p.line(l));
  return { events, failure: p.failure() };
};

const reply = (events: ChatEvent[]): Message =>
  extractSources(events.reduce(applyEvent, { id: "a", role: "assistant", text: "", at: 0 } as Message));

const req = (extra: Partial<ChatRequest> = {}): ChatRequest => ({
  provider: { id: "claude", name: "Claude", kind: "claude-cli", group: "sub", models: [] },
  model: "haiku",
  system: "sys",
  messages: [],
  prompt: "hej",
  search: false,
  ...extra,
});

describe("claudeArgs", () => {
  it("bez narzędzi, nowa sesja z id", () => {
    const a = claudeArgs(req({ session: { id: "s1", resume: false } }));
    expect(a.slice(a.indexOf("--tools"), a.indexOf("--tools") + 2)).toEqual(["--tools", ""]);
    expect(a).not.toContain("--allowedTools");
    expect(a.slice(-4)).toEqual(["--model", "haiku", "--session-id", "s1"]);
  });
  it("wyszukiwanie: tylko WebSearch/WebFetch, wznowienie", () => {
    const a = claudeArgs(req({ search: true, session: { id: "s1", resume: true } }));
    expect(a).toContain("WebSearch,WebFetch");
    expect(a.slice(a.indexOf("--allowedTools"), a.indexOf("--allowedTools") + 2)).toEqual(["--allowedTools", "WebSearch,WebFetch"]);
    expect(a.slice(-2)).toEqual(["--resume", "s1"]);
  });
  it("folder: tylko czytanie (Read/Grep/Glob), z wyszukiwaniem dochodzi sieć", () => {
    const a = claudeArgs(req({ folder: "/tmp/x" }));
    expect(a.slice(a.indexOf("--tools"), a.indexOf("--tools") + 2)).toEqual(["--tools", "Read,Grep,Glob"]);
    expect(a).toContain("--allowedTools");
    expect(claudeArgs(req({ folder: "/tmp/x", search: true }))).toContain("Read,Grep,Glob,WebSearch,WebFetch");
    expect(a.join(" ")).not.toMatch(/Bash|Edit|Write/);
  });
});

describe("ClaudeParser (nagrane wyjście claude 2.1)", () => {
  it("zwykła odpowiedź: sesja i tekst z delt, bez dublowania z `assistant`", () => {
    const { events, failure } = parse("claude-text.jsonl");
    expect(failure).toBeNull();
    expect(events[0]).toEqual({ type: "session", id: "065309d9-6bbf-4d6f-982b-e562cc0b9eb5" });
    expect(reply(events).text).toBe("Cześć! Koty są inteligentnymi stworzeniami, które potrafią zapamiętać miejsce zamieszkania i zawsze tam wracają.");
  });

  it("wyszukiwanie: zapytanie, znalezione strony, źródła z końca odpowiedzi", () => {
    const { events } = parse("claude-search.jsonl");
    const m = reply(events);
    expect(m.searches).toEqual(["Node.js LTS najnowsza wersja 2026"]);
    expect(m.found!.length).toBeGreaterThan(3);
    expect(m.found![0]).toEqual({ title: "Node.js", url: "https://nodejs.org/en/blog/year-2026/page/2" });
    expect(m.sources?.[0]?.url).toMatch(/^https:\/\//);
    expect(m.text).not.toMatch(/Sources:/);
    expect(m.text).toContain("[1]");
  });

  it("błąd w `result` i odrzucony limit", () => {
    const p = new ClaudeParser();
    p.line({ type: "result", subtype: "error_during_execution", is_error: true, errors: ["No conversation found"] });
    expect(p.failure()).toBe("No conversation found");
    const q = new ClaudeParser();
    q.line({ type: "rate_limit_event", rate_limit_info: { status: "rejected", resetsAt: 1790864400 } });
    expect(q.failure()).toMatch(/^limit subskrypcji Claude wyczerpany \(odnowienie \d\d:\d\d\)$/);
  });

  it("searchLinks: kilka bloków, zepsuty JSON pominięty", () => {
    expect(searchLinks('Links: [{"title":"A","url":"https://a"}]\nLinks: [{"title":')).toEqual([{ title: "A", url: "https://a" }]);
    expect(searchLinks([{ type: "text", text: 'Links: [{"url":"https://b"}]' }])).toEqual([{ title: "", url: "https://b" }]);
  });
});

describe("runCli", () => {
  const echo: LineParser & { seen: unknown[] } = {
    seen: [],
    line(o) {
      this.seen.push(o);
      return [{ type: "text", text: String((o as { t: string }).t) }];
    },
    failure: () => null,
  };
  const cwd = path.join(os.tmpdir(), "aw-cli-test");
  const sh = (script: string) => ["-c", script];

  it("linie JSON z stdout, stdin dociera, kod 0", async () => {
    const out: ChatEvent[] = [];
    await runCli("sh", sh('read x; echo "{\\"t\\":\\"$x\\"}"; echo "nie json"; printf "{\\"t\\":\\"b\\"}"'), "a\n", cwd, echo, new AbortController().signal, (e) => out.push(e));
    expect(out).toEqual([
      { type: "text", text: "a" },
      { type: "text", text: "b" },
    ]);
  });

  it("kod ≠ 0: pierwsza linia stderr", async () => {
    await expect(runCli("sh", sh("echo 'zły klucz' >&2; exit 3"), "", cwd, echo, new AbortController().signal, () => {})).rejects.toThrow("sh: zły klucz");
  });

  it("brak programu", async () => {
    await expect(runCli("nie-ma-takiego-programu-aw", [], "", cwd, echo, new AbortController().signal, () => {})).rejects.toThrow(/nie uruchomiono/);
  });

  it("Stop zabija proces i kończy bez błędu", async () => {
    const ctl = new AbortController();
    const t0 = Date.now();
    const p = runCli("sh", sh("sleep 20"), "", cwd, echo, ctl.signal, () => {});
    setTimeout(() => ctl.abort(), 50);
    await p;
    expect(Date.now() - t0).toBeLessThan(3000);
  });

  it("signal już przerwany: proces nie startuje", async () => {
    const ctl = new AbortController();
    ctl.abort();
    const marker = path.join(cwd, "started");
    await runCli("sh", sh(`touch ${marker}`), "", cwd, echo, ctl.signal, () => {});
    await new Promise((r) => setTimeout(r, 100));
    expect(fs.existsSync(marker)).toBe(false);
  });
});
