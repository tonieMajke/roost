import { describe, expect, it } from "vitest";
import { filterBoard, fold, idlePaneIds, isIdle, matchesQuery, type BoardRow } from "./board";

const row = (over: Partial<BoardRow> = {}): BoardRow => ({
  paneId: "p1",
  projectId: "pr1",
  title: "Naprawa żółwia",
  agent: "claude",
  project: "Łódź-api",
  branch: "feat/login",
  lastMessage: "Edit src/main.ts",
  state: {},
  ...over,
});

describe("fold", () => {
  it("drops case and Polish diacritics", () => {
    expect(fold("ŁÓDŹ Żółć")).toBe("lodz zolc");
  });
});

describe("matchesQuery", () => {
  it("matches empty and blank queries", () => {
    expect(matchesQuery(row(), "")).toBe(true);
    expect(matchesQuery(row(), "   ")).toBe(true);
  });
  it("searches title, agent, project, branch and last message", () => {
    for (const q of ["naprawa", "CLAUDE", "lodz", "login", "main.ts"]) expect(matchesQuery(row(), q)).toBe(true);
  });
  it("ignores diacritics both ways", () => {
    expect(matchesQuery(row(), "zolwia")).toBe(true);
    expect(matchesQuery(row({ title: "zolw" }), "żółw")).toBe(true);
  });
  it("requires every word, in any field (AND)", () => {
    expect(matchesQuery(row(), "claude login")).toBe(true);
    expect(matchesQuery(row(), "claude nieistnieje")).toBe(false);
  });
  it("works without branch and last message", () => {
    const r = row({ branch: undefined, lastMessage: undefined });
    expect(matchesQuery(r, "undefined")).toBe(false);
    expect(matchesQuery(r, "claude")).toBe(true);
  });
});

describe("filterBoard", () => {
  it("keeps order and returns all for empty query", () => {
    const rows = [row({ paneId: "a" }), row({ paneId: "b", title: "inne", agent: "pi", lastMessage: "x" })];
    expect(filterBoard(rows, "").map((r) => r.paneId)).toEqual(["a", "b"]);
    expect(filterBoard(rows, "inne pi").map((r) => r.paneId)).toEqual(["b"]);
  });
});

describe("idle", () => {
  const exited = { code: 1, signal: null };
  it("only panes with an exited process are idle", () => {
    expect(isIdle({})).toBe(false);
    expect(isIdle({ exited })).toBe(true);
    expect(isIdle({ working: true })).toBe(false);
    expect(isIdle({ unread: true })).toBe(false);
    expect(isIdle({ done: true })).toBe(false);
  });
  it("lists ids of idle rows only", () => {
    const rows = [
      row({ paneId: "w", state: { working: true } }),
      row({ paneId: "i" }),
      row({ paneId: "u", state: { unread: true } }),
      row({ paneId: "e", state: { exited } }),
    ];
    expect(idlePaneIds(rows)).toEqual(["e"]);
    expect(idlePaneIds([])).toEqual([]);
  });
});
