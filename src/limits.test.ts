import { describe, expect, it } from "vitest";
import { DEFAULT_AGENTS, type AgentDef } from "./agents";
import { limitBlocks, limitMeters, resetText, withClaudeSettings } from "./limits";

const claude = DEFAULT_AGENTS.find((a) => a.id === "claude")!;
const pi = DEFAULT_AGENTS.find((a) => a.id === "pi")!;
// Local time, like the UI: Wednesday 2026-09-30 21:00.
const now = new Date(2026, 8, 30, 21, 0).getTime();
const secs = (d: Date) => d.getTime() / 1000;

describe("withClaudeSettings", () => {
  const json = '{"statusLine":{}}';

  it("adds --settings to claude, also by full path", () => {
    expect(withClaudeSettings(claude, ["--resume", "x"], json)).toEqual(["--resume", "x", "--settings", json]);
    const local: AgentDef = { ...claude, id: "c2", command: "/usr/bin/claude" };
    expect(withClaudeSettings(local, [], json)).toEqual(["--settings", json]);
  });

  it("leaves other agents, a missing value and own settings alone", () => {
    expect(withClaudeSettings(pi, ["a"], json)).toEqual(["a"]);
    expect(withClaudeSettings(claude, ["a"], null)).toEqual(["a"]);
    expect(withClaudeSettings(claude, ["--settings", "mine.json"], json)).toEqual(["--settings", "mine.json"]);
    expect(withClaudeSettings(claude, ["--settings=mine.json"], json)).toEqual(["--settings=mine.json"]);
  });
});

describe("resetText", () => {
  it("today, tomorrow, later in the week", () => {
    expect(resetText(secs(new Date(2026, 8, 30, 22, 40)), now)).toBe("reset o 22:40");
    expect(resetText(secs(new Date(2026, 9, 1, 2, 5)), now)).toBe("reset jutro 02:05");
    expect(resetText(secs(new Date(2026, 9, 5, 9, 0)), now)).toBe("reset w pon. 09:00");
  });
});

describe("limitMeters", () => {
  it("no data yet: no meters", () => {
    expect(limitMeters(null, now)).toEqual([]);
  });

  it("five-hour first, rounded, past resets dropped", () => {
    const limits = {
      fiveHour: { pct: 42.6, resetsAt: secs(new Date(2026, 8, 30, 22, 40)) },
      sevenDay: { pct: 18, resetsAt: secs(new Date(2026, 9, 5, 9, 0)) },
      at: secs(new Date(now)),
    };
    expect(limitMeters(limits, now)).toEqual([
      { label: "Sesja (5 h)", pct: 43, note: "reset o 22:40" },
      { label: "Tydzień", pct: 18, note: "reset w pon. 09:00" },
    ]);
    const later = new Date(2026, 8, 30, 23, 0).getTime();
    expect(limitMeters(limits, later).map((m) => m.label)).toEqual(["Tydzień"]);
    expect(limitMeters({ ...limits, sevenDay: null }, later)).toEqual([]);
  });
});

describe("limitBlocks", () => {
  const sources = [
    { id: "", name: "Domyślne" },
    { id: "praca", name: "Praca" },
    { id: "priv", name: "Prywatne" },
  ];
  const live = { fiveHour: { pct: 40, resetsAt: secs(new Date(2026, 8, 30, 22, 40)) }, sevenDay: null, at: 1 };
  const stale = { fiveHour: { pct: 90, resetsAt: secs(new Date(2026, 8, 30, 20, 0)) }, sevenDay: null, at: 1 };

  it("one block per account with a live window, in source order", () => {
    const blocks = limitBlocks(sources, { praca: live, "": live }, now);
    expect(blocks.map((b) => b.id)).toEqual(["", "praca"]);
    expect(blocks[1].meters[0]).toMatchObject({ label: "Sesja (5 h)", pct: 40 });
  });

  it("drops accounts without a reading or past their reset", () => {
    expect(limitBlocks(sources, { praca: stale }, now)).toEqual([]);
    expect(limitBlocks(sources, {}, now)).toEqual([]);
  });
});
