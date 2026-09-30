import { describe, expect, it } from "vitest";
import { FEED_MAX, exitedText, feedFor, newTools, pushFeed, relativeTime, toolText, type FeedItem, type ToolUse } from "./feed";

const item = (id: number): FeedItem => ({
  id,
  paneId: "p",
  projectId: "pr",
  agentId: "claude",
  project: "x",
  text: `e${id}`,
  at: id,
});
const tool = (id: string, extra: Partial<ToolUse> = {}): ToolUse => ({
  id,
  name: "Read",
  file: null,
  command: null,
  ...extra,
});

describe("relativeTime", () => {
  it.each([
    [0, "teraz"],
    [9_999, "teraz"],
    [-5_000, "teraz"],
    [10_000, "10 s temu"],
    [47_000, "40 s temu"],
    [59_999, "50 s temu"],
    [60_000, "1 min temu"],
    [3 * 60_000 + 30_000, "3 min temu"],
    [59 * 60_000, "59 min temu"],
    [2 * 3_600_000 + 5, "2 godz. temu"],
    [49 * 3_600_000, "2 d temu"],
  ])("%i ms → %s", (ago, text) => {
    expect(relativeTime(1_000_000_000 - ago, 1_000_000_000)).toBe(text);
  });
});

describe("feedFor", () => {
  it("all = the same list, project = only that project's rows, order kept", () => {
    const feed = [{ ...item(3), projectId: "b" }, item(2), { ...item(1), projectId: "b" }];
    expect(feedFor(feed, "all", "a")).toBe(feed);
    expect(feedFor(feed, "project", "b").map((f) => f.id)).toEqual([3, 1]);
    expect(feedFor(feed, "project", null)).toEqual([]);
  });
});

describe("pushFeed", () => {
  it("puts the newest first and keeps FEED_MAX", () => {
    const feed = pushFeed([item(2), item(1)], [item(3), item(4)]);
    expect(feed.map((f) => f.id)).toEqual([4, 3, 2, 1]);
    const full = pushFeed([], Array.from({ length: 40 }, (_, i) => item(i)));
    expect(full).toHaveLength(FEED_MAX);
    expect(full[0].id).toBe(39);
  });

  it("returns the same array when nothing is new", () => {
    const feed = [item(1)];
    expect(pushFeed(feed, [])).toBe(feed);
  });
});

describe("newTools", () => {
  const list = [tool("a"), tool("b"), tool("c")];

  it("first read of a conversation is only the baseline", () => {
    expect(newTools(undefined, list)).toEqual([]);
  });

  it("no call seen yet: all of them", () => {
    expect(newTools(null, list)).toEqual(list);
  });

  it("only calls after the seen one", () => {
    expect(newTools("a", list).map((t) => t.id)).toEqual(["b", "c"]);
    expect(newTools("c", list)).toEqual([]);
  });

  it("seen call scrolled out of the list: all of them", () => {
    expect(newTools("zz", list)).toEqual(list);
  });
});

describe("toolText", () => {
  it("shows the file relative to the project", () => {
    const t = tool("1", { name: "Write", file: "/home/u/Agents workspace/src/feed.ts" });
    expect(toolText(t, "~/Agents workspace", "/home/u")).toBe("Write src/feed.ts");
    expect(toolText(t, "/home/u/Agents workspace/", "/home/u")).toBe("Write src/feed.ts");
  });

  it("keeps paths outside the project and relative pi paths", () => {
    expect(toolText(tool("1", { file: "/etc/hosts" }), "~/p", "/home/u")).toBe("Read /etc/hosts");
    expect(toolText(tool("1", { name: "edit", file: "src/x.ts" }), "~/p", "/home/u")).toBe("edit src/x.ts");
    // a sibling that only shares the prefix is not inside
    expect(toolText(tool("1", { file: "/home/u/p2/a" }), "~/p", "/home/u")).toBe("Read /home/u/p2/a");
  });

  it("falls back to the command, then the bare name", () => {
    expect(toolText(tool("1", { name: "Bash", command: "pnpm test" }), "~/p", "/h")).toBe("Bash pnpm test");
    expect(toolText(tool("1", { name: "Glob" }), "~/p", "/h")).toBe("Glob");
  });
});

it("exitedText names the code or the signal", () => {
  expect(exitedText({ code: 2, signal: null })).toBe("proces zakończony (kod 2)");
  expect(exitedText({ code: 0, signal: "SIGKILL" })).toBe("proces zakończony (sygnał SIGKILL)");
});
