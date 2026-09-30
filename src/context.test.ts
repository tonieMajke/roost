import { describe, expect, it } from "vitest";
import { DEFAULT_AGENTS, type AgentDef } from "./agents";
import { claudeWindow, contextKind, contextLimit, contextMeter, contextTargets, formatTokens, paneMeter } from "./context";

const [claude, pi, shell] = DEFAULT_AGENTS;

describe("contextKind / contextLimit", () => {
  it("knows claude and pi by the program, also with a path", () => {
    expect(contextKind(claude)).toBe("claude");
    expect(contextKind(pi)).toBe("pi");
    expect(contextKind({ ...claude, id: "opus", command: "/usr/bin/claude" })).toBe("claude");
  });

  it("gives no meter without a session or for other programs", () => {
    expect(contextKind(shell)).toBeNull();
    expect(contextKind({ ...claude, session: undefined })).toBeNull();
    expect(contextKind({ ...pi, command: "codex" })).toBeNull();
    expect(contextKind(undefined)).toBeNull();
    expect(contextLimit(shell)).toBeNull();
  });

  it("uses `context` from agents.json, else 200k for claude and 128k for pi", () => {
    expect(contextLimit(claude)).toBe(200_000);
    expect(contextLimit(pi)).toBe(128_000);
    expect(contextLimit({ ...claude, context: 1_000_000 })).toBe(1_000_000);
    const codex: AgentDef = { id: "codex", name: "codex", command: "codex", context: 272_000 };
    expect(contextLimit(codex)).toBeNull(); // no reader for its files
  });

  it("takes the window of the last turn's model, `context` still wins", () => {
    const local = { tokens: 1, model: "Flash-Next-NVFP4", window: 262_144 };
    expect(contextLimit(pi, local)).toBe(262_144);
    expect(contextLimit(pi, { ...local, window: null })).toBe(128_000);
    expect(contextLimit(claude, { tokens: 1, model: "claude-sonnet-5-5", window: null })).toBe(1_000_000);
    expect(contextLimit(claude, { tokens: 1, model: "claude-haiku-4-5", window: null })).toBe(200_000);
    expect(contextLimit({ ...pi, context: 32_000 }, local)).toBe(32_000);
  });
});

describe("claudeWindow", () => {
  it("1M from Opus/Sonnet 4.6 on and for Fable/Mythos, 200k before and for Haiku", () => {
    for (const m of ["claude-sonnet-5-5", "claude-sonnet-5", "claude-opus-5-5", "claude-opus-4-6", "claude-sonnet-4-6", "claude-fable-5-1", "claude-mythos-5-1"]) {
      expect(claudeWindow(m), m).toBe(1_000_000);
    }
    for (const m of ["claude-haiku-4-5", "claude-opus-4-5-20251101", "claude-sonnet-4-5", "claude-3-7-sonnet-20250219"]) {
      expect(claudeWindow(m), m).toBe(200_000);
    }
    expect(claudeWindow("<synthetic>")).toBeNull();
    expect(claudeWindow(null)).toBeNull();
  });
});

describe("contextTargets", () => {
  it("keeps panes with a session id and a known reader", () => {
    const panes = [
      { id: "1", agentId: "claude", run: 1, sessionId: "s1" },
      { id: "2", agentId: "shell", run: 1 },
      { id: "3", agentId: "pi", run: 1, sessionId: "s3" },
      { id: "4", agentId: "claude", run: 1 },
      { id: "5", agentId: "gone", run: 1, sessionId: "s5" },
    ];
    expect(contextTargets(panes, DEFAULT_AGENTS)).toEqual([
      { paneId: "1", sessionId: "s1", kind: "claude" },
      { paneId: "3", sessionId: "s3", kind: "pi" },
    ]);
  });
});

describe("formatTokens / contextMeter", () => {
  it("shortens like wzor D", () => {
    expect(formatTokens(84_400)).toBe("84k");
    expect(formatTokens(400)).toBe("0k");
    expect(formatTokens(1_250_000)).toBe("1.3M");
  });

  it("rounds the share, caps it at 100 and warns from 80 %", () => {
    expect(contextMeter(50_000, 200_000)).toEqual({ known: true, pct: 25, used: "50k", limit: "200k", warn: false });
    expect(contextMeter(159_000, 200_000).warn).toBe(true); // 79,5 % -> 80
    expect(contextMeter(157_000, 200_000).warn).toBe(false);
    expect(contextMeter(300_000, 200_000).pct).toBe(100);
  });

  it("shows a dash before the first reading", () => {
    expect(contextMeter(undefined, 128_000)).toEqual({ known: false, pct: 0, used: "–", limit: "128k", warn: false });
  });
});

describe("paneMeter", () => {
  const contexts = { s1: { tokens: 170_000, model: "m", window: null } };
  it("reads the pane's own session with the agent's limit", () => {
    const pane = { id: "1", agentId: "claude", run: 1, sessionId: "s1" };
    expect(paneMeter(pane, claude, contexts)).toMatchObject({ known: true, pct: 85, warn: true });
    expect(paneMeter({ ...pane, sessionId: "s2" }, claude, contexts)?.known).toBe(false);
  });
  it("is null for panes without a meter", () => {
    expect(paneMeter({ id: "2", agentId: "shell", run: 1 }, shell, contexts)).toBeNull();
    expect(paneMeter({ id: "3", agentId: "claude", run: 1 }, claude, contexts)).toBeNull();
  });
});
