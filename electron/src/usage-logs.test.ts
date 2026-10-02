import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { chatLogExcludes, logRoots, parseLogText, UsageScanner } from "./usage-logs";

const jl = (...lines: unknown[]) => lines.map((l) => JSON.stringify(l)).join("\n");

const claudeLine = (o: { id: string; req: string; out: number; at?: string; model?: string; cwd?: string; input?: number; cacheRead?: number }) => ({
  type: "assistant",
  timestamp: o.at ?? "2026-09-30T10:00:00.000Z",
  cwd: o.cwd ?? "/p/a",
  requestId: o.req,
  message: {
    id: o.id,
    model: o.model ?? "claude-opus-5-5",
    usage: { input_tokens: o.input ?? 10, output_tokens: o.out, cache_read_input_tokens: o.cacheRead ?? 100, cache_creation_input_tokens: 5, output_tokens_details: { thinking_tokens: 2 } },
  },
});

describe("Claude Code", () => {
  it("jedno wywołanie zapisane w kilku liniach liczy się raz, z największym wyjściem", () => {
    const rows = parseLogText("claude", jl(claudeLine({ id: "m1", req: "r1", out: 1 }), claudeLine({ id: "m1", req: "r1", out: 40 }), claudeLine({ id: "m1", req: "r1", out: 40 })));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ source: "pane", provider: "claude", model: "claude-opus-5-5", project: "/p/a", input: 10, output: 40, cacheRead: 100, cacheWrite: 5, reasoning: 2, n: 1 });
  });
  it("różne wywołania sumują się, model <synthetic> i linie bez usage są pomijane", () => {
    const rows = parseLogText(
      "claude",
      jl(
        claudeLine({ id: "m1", req: "r1", out: 40 }),
        claudeLine({ id: "m2", req: "r2", out: 60 }),
        claudeLine({ id: "m3", req: "r3", out: 0, model: "<synthetic>" }),
        { type: "user", message: { content: "x" } },
      ),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ output: 100, n: 2 });
  });
  it("dzień z lokalnej strefy, model znormalizowany, konto na wierszu", () => {
    const rows = parseLogText("claude", jl(claudeLine({ id: "m", req: "r", out: 1, model: "claude-haiku-4-5-20251001", at: "2026-09-30T23:30:00.000Z" })), "praca");
    expect(rows[0]).toMatchObject({ day: "2026-10-01", model: "claude-haiku-4-5", account: "praca" }); // TZ Europe/Warsaw
  });
  it("uszkodzona linia nie przerywa i jest liczona jako pominięta", () => {
    const rows = parseLogText("claude", `${JSON.stringify(claudeLine({ id: "m", req: "r", out: 5 }))}\n{"usage": urwana\n`);
    expect(rows[0].output).toBe(5);
  });
});

describe("Codex", () => {
  const meta = { type: "session_meta", timestamp: "2026-09-30T10:00:00.000Z", payload: { cwd: "/p/c" } };
  const turn = (model: string) => ({ type: "turn_context", timestamp: "2026-09-30T10:00:01.000Z", payload: { model, cwd: "/p/c" } });
  const tc = (input: number, cached: number, out: number, reasoning = 0) => ({
    type: "event_msg",
    timestamp: "2026-09-30T10:00:05.000Z",
    payload: { type: "token_count", info: { total_token_usage: { input_tokens: input, cached_input_tokens: cached, cache_write_input_tokens: 0, output_tokens: out, reasoning_output_tokens: reasoning } } },
  });

  it("przyrosty sum, wejście bez cache, model z turn_context", () => {
    const rows = parseLogText("codex", jl(meta, turn("gpt-5.6-luna"), tc(1000, 0, 50), tc(3000, 1500, 120, 30)));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ provider: "codex", model: "gpt-5.6-luna", project: "/p/c", input: 1500, cacheRead: 1500, output: 120, reasoning: 30, n: 2 });
  });
  it("powtórzone zdarzenie z tą samą sumą nie liczy się drugi raz", () => {
    const rows = parseLogText("codex", jl(meta, turn("m"), tc(1000, 0, 50), tc(1000, 0, 50)));
    expect(rows[0]).toMatchObject({ input: 1000, output: 50, n: 1 });
  });
  it("zdarzenie bez info (same limity) jest pomijane", () => {
    const rows = parseLogText("codex", jl(meta, turn("m"), { type: "event_msg", timestamp: "2026-09-30T10:00:05.000Z", payload: { type: "token_count", info: null } }));
    expect(rows).toEqual([]);
  });
  it("model zmieniony w trakcie sesji dzieli zużycie", () => {
    const rows = parseLogText("codex", jl(meta, turn("a"), tc(100, 0, 10), turn("b"), tc(300, 0, 30)));
    expect(rows.map((x) => [x.model, x.input, x.output]).sort()).toEqual([["a", 100, 10], ["b", 200, 20]]);
  });
});

describe("pi", () => {
  it("cwd z sesji, usage z odpowiedzi asystenta", () => {
    const rows = parseLogText(
      "pi",
      jl(
        { type: "session", cwd: "/p/pi", timestamp: "2026-09-30T10:00:00.000Z" },
        { type: "message", timestamp: "2026-09-30T10:00:10.000Z", message: { role: "user", content: "x" } },
        { type: "message", timestamp: "2026-09-30T10:00:20.000Z", message: { role: "assistant", model: "Qwen", usage: { input: 11, output: 22, cacheRead: 3, cacheWrite: 0 } } },
      ),
    );
    expect(rows).toEqual([expect.objectContaining({ provider: "pi", model: "Qwen", project: "/p/pi", input: 11, output: 22, cacheRead: 3, n: 1 })]);
  });
});

describe("foldery logów", () => {
  it("konta dodają swoje foldery, domyślny folder nie liczy się dwa razy", () => {
    const roots = logRoots(
      [
        { id: "praca", name: "Praca", kind: "claude", dir: "/x/claude-praca" },
        { id: "dom", name: "Dom", kind: "claude", dir: "/h/.claude" },
        { id: "cx", name: "Cx", kind: "codex", dir: "/x/codex" },
      ],
      "/h",
    );
    expect(roots.filter((r) => r.kind === "claude").map((r) => [r.dir, r.account])).toEqual([
      [path.join("/h", ".claude", "projects"), undefined],
      [path.join("/x", "claude-praca", "projects"), "praca"],
    ]);
    expect(roots.some((r) => r.dir === path.join("/x", "codex", "sessions") && r.account === "cx")).toBe(true);
  });
});

describe("UsageScanner", () => {
  const dirs: string[] = [];
  const tmp = () => {
    const d = fs.mkdtempSync(path.join(os.tmpdir(), "usage-"));
    dirs.push(d);
    return d;
  };
  afterEach(() => {
    for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
  });

  const setup = () => {
    const cfg = tmp();
    const logs = tmp();
    fs.mkdirSync(path.join(logs, "proj", "sess", "subagents"), { recursive: true });
    fs.writeFileSync(path.join(logs, "proj", "s.jsonl"), jl(claudeLine({ id: "m1", req: "r1", out: 10 })));
    fs.writeFileSync(path.join(logs, "proj", "sess", "subagents", "agent-1.jsonl"), jl(claudeLine({ id: "m9", req: "r9", out: 7 })));
    return { cfg, logs, scanner: new UsageScanner(cfg, () => [{ kind: "claude", dir: logs }]) };
  };

  it("czyta też pliki subagentów i zapisuje indeks", async () => {
    const { cfg, scanner } = setup();
    const r = await scanner.scan();
    expect(r).toMatchObject({ files: 2, parsed: 2 });
    expect(r.rows.reduce((s, x) => s + x.output, 0)).toBe(17);
    expect(fs.existsSync(path.join(cfg, "usage-index.json"))).toBe(true);
  });
  it("drugi skan nie czyta niezmienionych plików, a zmieniony czyta od nowa", async () => {
    const { logs, scanner } = setup();
    await scanner.scan();
    expect((await scanner.scan()).parsed).toBe(0);
    fs.writeFileSync(path.join(logs, "proj", "s.jsonl"), jl(claudeLine({ id: "m1", req: "r1", out: 10 }), claudeLine({ id: "m2", req: "r2", out: 5 })));
    const r = await scanner.scan();
    expect(r.parsed).toBe(1);
    expect(r.rows.reduce((s, x) => s + x.output, 0)).toBe(22);
  });
  it("indeks przeżywa restart (przed skanem usunięty log jeszcze liczy), skan go odcina", async () => {
    const { cfg, logs, scanner } = setup();
    await scanner.scan();
    fs.rmSync(path.join(logs, "proj"), { recursive: true });
    const fresh = new UsageScanner(cfg, () => [{ kind: "claude", dir: logs }]);
    expect(fresh.rows().reduce((s, x) => s + x.output, 0)).toBe(17);
    const r = await fresh.scan();
    expect(r.parsed).toBe(0);
    expect(r.rows).toEqual([]);
  });
  it("usunięcie jednego logu odcina tylko jego wiersze", async () => {
    const { logs, scanner } = setup();
    await scanner.scan();
    fs.rmSync(path.join(logs, "proj", "sess"), { recursive: true });
    const r = await scanner.scan();
    expect(r.rows.reduce((s, x) => s + x.output, 0)).toBe(10);
  });
  it("logi z katalogów wykluczonych (Czat i Boty) są pomijane", async () => {
    const cfg = tmp();
    const logs = tmp();
    fs.writeFileSync(path.join(logs, "a.jsonl"), jl(claudeLine({ id: "m1", req: "r1", out: 10, cwd: `${cfg}/chat-cwd` }), claudeLine({ id: "m2", req: "r2", out: 3, cwd: "/p/a" })));
    const scanner = new UsageScanner(cfg, () => [{ kind: "claude", dir: logs }], [path.join(cfg, "chat-cwd")]);
    const r = await scanner.scan();
    expect(r.rows.map((x) => x.output)).toEqual([3]);
  });
  it("równoległe skany dzielą jedną pracę", async () => {
    const { scanner } = setup();
    const [a, b] = await Promise.all([scanner.scan(), scanner.scan()]);
    expect(a).toBe(b);
  });
  it("brakujący folder logów nie jest błędem", async () => {
    const cfg = tmp();
    const r = await new UsageScanner(cfg, () => [{ kind: "claude", dir: path.join(cfg, "nie-ma") }]).scan();
    expect(r).toMatchObject({ files: 0, rows: [] });
  });
});

describe("chatLogExcludes", () => {
  it("obejmuje chat-cwd i bots w nowym i starym katalogu", () => {
    const p = (...s: string[]) => path.join("/c", ...s);
    expect(chatLogExcludes(p("roost"), p("agents"))).toEqual([p("roost", "chat-cwd"), p("roost", "bots"), p("agents", "chat-cwd"), p("agents", "bots")]);
  });
});
