import { describe, expect, it } from "vitest";
import {
  MAX_PANES,
  activeProject,
  emptyWorkspace,
  gridShape,
  neighbor,
  parseWorkspace,
  projectName,
  reduce,
  type Action,
  type Pane,
  type Project,
  type Workspace,
} from "./workspace";

const pane = (id: string, agentId = "claude"): Pane => ({ id, agentId, run: 1 });
const project = (id: string, path: string, paneIds: string[] = []): Project => ({
  id,
  name: projectName(path),
  path,
  panes: paneIds.map((p) => pane(p)),
  focused: paneIds[paneIds.length - 1] ?? null,
  maximized: null,
});
const ws = (...projects: Project[]): Workspace => ({
  version: 1,
  projects,
  active: projects[0]?.id ?? null,
  presets: [],
});

function deepFreeze<T>(v: T): T {
  if (typeof v === "object" && v !== null) {
    for (const x of Object.values(v)) deepFreeze(x);
    Object.freeze(v);
  }
  return v;
}

describe("gridShape", () => {
  it("matches cols = ceil(sqrt(n)), rows = ceil(n / cols)", () => {
    expect(gridShape(0)).toEqual({ cols: 0, rows: 0 });
    expect(gridShape(1)).toEqual({ cols: 1, rows: 1 });
    expect(gridShape(2)).toEqual({ cols: 2, rows: 1 });
    expect(gridShape(3)).toEqual({ cols: 2, rows: 2 });
    expect(gridShape(4)).toEqual({ cols: 2, rows: 2 });
    expect(gridShape(5)).toEqual({ cols: 3, rows: 2 });
    expect(gridShape(7)).toEqual({ cols: 3, rows: 3 });
    expect(gridShape(9)).toEqual({ cols: 3, rows: 3 });
    expect(gridShape(10)).toEqual({ cols: 4, rows: 3 });
    expect(gridShape(16)).toEqual({ cols: 4, rows: 4 });
  });
});

describe("neighbor", () => {
  // 3 panes: grid 2x2, hole at index 3
  it("moves around a 2x2 grid with a hole", () => {
    for (const [i, dir, want] of [
      [0, "up", 0], [0, "left", 0], [0, "right", 1], [0, "down", 2],
      [1, "up", 1], [1, "right", 1], [1, "left", 0], [1, "down", 2], // down into the hole -> last pane
      [2, "up", 0], [2, "left", 2], [2, "right", 2], [2, "down", 2],
      [3, "up", 3], // index past the last pane is unchanged
    ] as const) {
      expect(neighbor(i, dir, 3), `neighbor(${i}, ${dir}, 3)`).toBe(want);
    }
  });

  // 5 panes: grid 3x2, hole at index 5
  it("moves around a 3x2 grid with a hole", () => {
    for (const [i, dir, want] of [
      [0, "up", 0], [0, "left", 0], [0, "right", 1], [0, "down", 3],
      [2, "up", 2], [2, "right", 2], [2, "left", 1], [2, "down", 4], // down into the hole -> last pane
      [3, "up", 0], [3, "right", 4], [3, "left", 3], [3, "down", 3],
      [4, "up", 1], [4, "left", 3], [4, "right", 4], [4, "down", 4],
    ] as const) {
      expect(neighbor(i, dir, 5), `neighbor(${i}, ${dir}, 5)`).toBe(want);
    }
  });
});

describe("projectName", () => {
  it("takes the last path segment", () => {
    expect(projectName("/a/b")).toBe("b");
    expect(projectName("/a/b/")).toBe("b");
    expect(projectName("~")).toBe("~");
    expect(projectName("~/proj")).toBe("proj");
    expect(projectName("/")).toBe("/");
  });
});

describe("activeProject", () => {
  it("finds the active project", () => {
    const w = ws(project("p1", "/a"), project("p2", "/b"));
    expect(activeProject(w)?.id).toBe("p1");
    expect(activeProject({ ...w, active: "nope" })).toBeNull();
    expect(activeProject(emptyWorkspace)).toBeNull();
  });
});

describe("reduce", () => {
  it("addProject appends and activates; existing path only activates", () => {
    const w = ws(project("p1", "/a"));
    const added = reduce(w, { type: "addProject", project: project("p2", "/b") });
    expect(added.projects.map((p) => p.id)).toEqual(["p1", "p2"]);
    expect(added.active).toBe("p2");

    const dup = reduce(w, { type: "addProject", project: project("p3", "/a") });
    expect(dup.projects.map((p) => p.id)).toEqual(["p1"]);
    expect(dup.active).toBe("p1");

    const same = reduce(w, { type: "addProject", project: project("p1", "/a") });
    expect(same).toBe(w);
  });

  it("removeProject picks next, then previous, then null", () => {
    const w = ws(project("p1", "/a"), project("p2", "/b"), project("p3", "/c"));
    expect(reduce(w, { type: "removeProject", id: "p1" }).active).toBe("p2");
    expect(reduce(w, { type: "removeProject", id: "p3" }).active).toBe("p1"); // p3 was inactive
    const mid = reduce({ ...w, active: "p2" }, { type: "removeProject", id: "p2" });
    expect(mid.active).toBe("p3"); // next
    const prev = reduce({ ...w, active: "p3" }, { type: "removeProject", id: "p3" });
    expect(prev.active).toBe("p2"); // no next -> previous
    const one = ws(project("p1", "/a"));
    expect(reduce(one, { type: "removeProject", id: "p1" }).active).toBeNull();
    expect(reduce(w, { type: "removeProject", id: "nope" })).toBe(w);
  });

  it("selectProject and renameProject", () => {
    const w = ws(project("p1", "/a"), project("p2", "/b"));
    expect(reduce(w, { type: "selectProject", id: "p2" }).active).toBe("p2");
    expect(reduce(w, { type: "selectProject", id: "nope" })).toBe(w);
    expect(reduce(w, { type: "selectProject", id: "p1" })).toBe(w);
    const r = reduce(w, { type: "renameProject", id: "p2", name: "Renamed" });
    expect(r.projects[1].name).toBe("Renamed");
    expect(w.projects[1].name).toBe("b");
  });

  it("add appends and focuses, stops at MAX_PANES, needs an active project", () => {
    const w = ws(project("p1", "/a", ["x1"]));
    const added = reduce(w, { type: "add", pane: pane("x2") });
    expect(added.projects[0].panes.map((p) => p.id)).toEqual(["x1", "x2"]);
    expect(added.projects[0].focused).toBe("x2");

    const full = ws(project("p1", "/a", Array.from({ length: MAX_PANES }, (_, i) => `f${i}`)));
    expect(reduce(full, { type: "add", pane: pane("over") })).toBe(full);
    expect(reduce(emptyWorkspace, { type: "add", pane: pane("x") })).toBe(emptyWorkspace);
  });

  it("close moves focus to the same index, else previous, and clears maximize", () => {
    const w = ws(project("p1", "/a", ["a", "b", "c"]));
    const closed = reduce(w, { type: "close", id: "b" });
    expect(closed.projects[0].panes.map((p) => p.id)).toEqual(["a", "c"]);
    expect(closed.projects[0].focused).toBe("c"); // same index as "b" had

    const last = reduce(w, { type: "close", id: "c" }); // focused was "c"
    expect(last.projects[0].focused).toBe("b"); // previous

    const empty = reduce(ws(project("p1", "/a", ["a"])), { type: "close", id: "a" });
    expect(empty.projects[0].panes).toEqual([]);
    expect(empty.projects[0].focused).toBeNull();

    const max = reduce(reduce(w, { type: "toggleMaximize", id: "b" }), { type: "close", id: "b" });
    expect(max.projects[0].maximized).toBeNull();
    expect(reduce(w, { type: "close", id: "nope" })).toBe(w);
  });

  it("restart and newConversation bump run", () => {
    const w = ws(project("p1", "/a", ["a"]));
    expect(reduce(w, { type: "restart", id: "a" }).projects[0].panes[0].run).toBe(2);
    const nc = reduce(w, { type: "newConversation", id: "a", sessionId: "sid-2" });
    expect(nc.projects[0].panes[0]).toEqual({ id: "a", agentId: "claude", run: 2, sessionId: "sid-2" });
    expect(w.projects[0].panes[0].run).toBe(1);
  });

  it("focus switches project when the pane lives elsewhere", () => {
    const w = ws(project("p1", "/a", ["a"]), project("p2", "/b", ["b1", "b2"]));
    const focused = reduce(w, { type: "focus", id: "b1" });
    expect(focused.active).toBe("p2");
    expect(focused.projects[1].focused).toBe("b1");
    expect(focused.projects[0].focused).toBe("a"); // other project untouched
    expect(reduce(w, { type: "focus", id: "nope" })).toBe(w);
    const already = reduce(w, { type: "focus", id: "a" });
    expect(already).toBe(w);
  });

  it("move focuses the grid neighbor", () => {
    const w = ws(project("p1", "/a", ["a", "b", "c", "d", "e"])); // focused "e" (index 4, grid 3x2)
    expect(reduce(w, { type: "move", dir: "up" }).projects[0].focused).toBe("b");
    const atA = reduce(reduce(w, { type: "focus", id: "a" }), { type: "move", dir: "down" });
    expect(atA.projects[0].focused).toBe("d");
    expect(reduce(w, { type: "move", dir: "right" })).toBe(w); // e is at the edge
    const noPanes = ws(project("p1", "/a"));
    expect(reduce(noPanes, { type: "move", dir: "up" })).toBe(noPanes);
  });

  it("toggleMaximize uses the focused pane without an id", () => {
    const w = ws(project("p1", "/a", ["a", "b"])); // focused "b"
    const max = reduce(w, { type: "toggleMaximize" });
    expect(max.projects[0].maximized).toBe("b");
    expect(reduce(max, { type: "toggleMaximize" }).projects[0].maximized).toBeNull();
    expect(reduce(w, { type: "toggleMaximize", id: "a" }).projects[0].maximized).toBe("a");
    expect(reduce(w, { type: "toggleMaximize", id: "nope" })).toBe(w);
  });

  it("load replaces the state", () => {
    const loaded = ws(project("p9", "/z", ["q"]));
    expect(reduce(emptyWorkspace, { type: "load", workspace: loaded })).toBe(loaded);
  });

  it("never mutates a frozen input", () => {
    const frozen = deepFreeze(
      ws(project("p1", "/a", ["a", "b", "c"]), project("p2", "/b", ["x"])),
    );
    const actions: Action[] = [
      { type: "addProject", project: project("p3", "/c") },
      { type: "removeProject", id: "p2" },
      { type: "selectProject", id: "p2" },
      { type: "renameProject", id: "p1", name: "n" },
      { type: "add", pane: pane("new") },
      { type: "close", id: "b" },
      { type: "restart", id: "a" },
      { type: "newConversation", id: "a", sessionId: "s" },
      { type: "focus", id: "x" },
      { type: "move", dir: "left" },
      { type: "toggleMaximize" },
      { type: "load", workspace: emptyWorkspace },
    ];
    for (const a of actions) {
      expect(() => reduce(frozen, a), a.type).not.toThrow();
    }
  });
});

describe("reduce presets", () => {
  it("savePreset copies the active project's panes in their order", () => {
    const w = ws({ ...project("p1", "/a", ["x1", "x2"]), panes: [pane("x1", "claude"), pane("x2", "pi")] });
    const r = reduce(w, { type: "savePreset", name: "duo" });
    expect(r.presets).toEqual([{ name: "duo", agents: ["claude", "pi"] }]);
    expect(w.presets).toEqual([]);
  });

  it("savePreset overwrites the same name and appends a new one", () => {
    const w = { ...ws(project("p1", "/a", ["x1"])), presets: [{ name: "a", agents: ["pi"] }, { name: "b", agents: ["claude"] }] };
    const over = reduce(w, { type: "savePreset", name: " a " });
    expect(over.presets).toEqual([{ name: "a", agents: ["claude"] }, { name: "b", agents: ["claude"] }]);
    const added = reduce(w, { type: "savePreset", name: "c" });
    expect(added.presets.map((p) => p.name)).toEqual(["a", "b", "c"]);
  });

  it("savePreset ignores an empty name, a project with no panes and no active project", () => {
    const w = ws(project("p1", "/a"));
    expect(reduce(w, { type: "savePreset", name: "  " })).toBe(w);
    expect(reduce(w, { type: "savePreset", name: "x" })).toBe(w);
    expect(reduce(emptyWorkspace, { type: "savePreset", name: "x" })).toBe(emptyWorkspace);
  });

  it("deletePreset removes by name; unknown name changes nothing", () => {
    const w = { ...ws(project("p1", "/a")), presets: [{ name: "a", agents: ["pi"] }] };
    expect(reduce(w, { type: "deletePreset", name: "a" }).presets).toEqual([]);
    expect(reduce(w, { type: "deletePreset", name: "nope" })).toBe(w);
  });

  it("does not mutate a frozen workspace", () => {
    const w = deepFreeze({ ...ws(project("p1", "/a", ["x1"])), presets: [{ name: "a", agents: ["pi"] }] });
    expect(reduce(w, { type: "savePreset", name: "b" }).presets.length).toBe(2);
    expect(reduce(w, { type: "deletePreset", name: "a" }).presets.length).toBe(0);
  });
});

describe("parseWorkspace", () => {
  const agents = ["claude", "pi"];

  it("rejects junk", () => {
    for (const raw of [null, "x", 42, []]) {
      const { workspace, errors } = parseWorkspace(raw, agents);
      expect(workspace, String(raw)).toEqual(emptyWorkspace);
      expect(errors.length).toBeGreaterThan(0);
    }
  });

  it("rejects an unknown version", () => {
    const { workspace, errors } = parseWorkspace({ version: 2, projects: [] }, agents);
    expect(workspace).toEqual(emptyWorkspace);
    expect(errors.join(" ")).toContain("version");
  });

  it("fills in missing fields", () => {
    const { workspace, errors } = parseWorkspace({ projects: [{ path: "/a/b", panes: [{ agentId: "pi" }] }] }, agents);
    expect(errors).toEqual([]);
    const p = workspace.projects[0];
    expect(p.name).toBe("b");
    expect(p.id).toMatch(/-/);
    expect(p.panes[0]).toMatchObject({ agentId: "pi", run: 1 });
    expect(p.panes[0].id).toMatch(/-/);
    expect(p.focused).toBeNull();
    expect(workspace.active).toBe(p.id);
    expect(workspace.version).toBe(1);
  });

  it("removes panes with an unknown agent and reports it", () => {
    const { workspace, errors } = parseWorkspace(
      { projects: [{ path: "/a", panes: [{ id: "p1", agentId: "claude" }, { id: "p2", agentId: "codex" }] }] },
      agents,
    );
    expect(workspace.projects[0].panes.map((p) => p.id)).toEqual(["p1"]);
    expect(errors.join(" ")).toContain("codex");
  });

  it("truncates more than MAX_PANES panes", () => {
    const panes = Array.from({ length: 20 }, (_, i) => ({ id: `p${i}`, agentId: "claude" }));
    const { workspace, errors } = parseWorkspace({ projects: [{ path: "/a", panes }] }, agents);
    expect(workspace.projects[0].panes.length).toBe(MAX_PANES);
    expect(errors.join(" ")).toContain("truncated");
  });

  it("keeps the first of two projects with the same path", () => {
    const { workspace, errors } = parseWorkspace(
      { projects: [{ path: "/a" }, { path: "/a" }, { path: "/b" }] },
      agents,
    );
    expect(workspace.projects.map((p) => p.path)).toEqual(["/a", "/b"]);
    expect(errors.join(" ")).toContain("duplicate path");
  });

  it("repairs dangling active/focused/maximized references", () => {
    const { workspace } = parseWorkspace(
      {
        projects: [
          { id: "p1", path: "/a", panes: [{ id: "x1", agentId: "claude" }], focused: "gone", maximized: "gone" },
          { id: "p2", path: "/b" },
        ],
        active: "nope",
      },
      agents,
    );
    expect(workspace.active).toBe("p1");
    expect(workspace.projects[0].focused).toBeNull();
    expect(workspace.projects[0].maximized).toBeNull();
  });

  it("drops malformed preset entries and keeps the good ones", () => {
    const { workspace, errors } = parseWorkspace(
      { presets: [{ name: "ok", agents: ["claude"] }, { name: "" }, { name: "x", agents: "pi" }] },
      agents,
    );
    expect(workspace.presets).toEqual([{ name: "ok", agents: ["claude"] }]);
    expect(errors.length).toBe(2);
  });

  it("round-trips a valid workspace", () => {
    const w: Workspace = {
      version: 1,
      projects: [
        {
          id: "p1",
          name: "proj",
          path: "~/proj",
          panes: [
            { id: "a", agentId: "claude", sessionId: "s1", run: 3 },
            { id: "b", agentId: "pi", run: 1 },
          ],
          focused: "b",
          maximized: null,
        },
      ],
      active: "p1",
      presets: [{ name: "duo", agents: ["claude", "pi"] }],
    };
    const { workspace, errors } = parseWorkspace(JSON.parse(JSON.stringify(w)), agents);
    expect(errors).toEqual([]);
    expect(workspace).toEqual(w);
  });
});
