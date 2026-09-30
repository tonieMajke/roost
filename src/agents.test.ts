import { describe, expect, it } from "vitest";
import { agentColor, buildArgs, DEFAULT_AGENTS, parseAgents, type AgentDef } from "./agents";

const ID = "3f2a1b0c-0000-4000-8000-000000000001";

const byId = (id: string): AgentDef => DEFAULT_AGENTS.find((a) => a.id === id)!;

describe("buildArgs", () => {
  it("claude: new conversation uses --session-id", () => {
    expect(buildArgs(byId("claude"), ID, false)).toEqual(["--session-id", ID]);
  });

  it("claude: existing conversation uses --resume", () => {
    expect(buildArgs(byId("claude"), ID, true)).toEqual(["--resume", ID]);
  });

  it("pi: same flag for new and resume", () => {
    expect(buildArgs(byId("pi"), ID, false)).toEqual(["--session-id", ID]);
    expect(buildArgs(byId("pi"), ID, true)).toEqual(["--session-id", ID]);
  });

  it("shell: no session at all", () => {
    expect(buildArgs(byId("shell"), ID, true)).toEqual([]);
  });

  it("without a sessionId only the fixed args remain", () => {
    expect(buildArgs(byId("claude"), undefined, true)).toEqual([]);
    expect(buildArgs({ id: "x", name: "x", command: "x", args: ["--yolo"] }, undefined, false)).toEqual(["--yolo"]);
  });

  it("fixed args come before the session args", () => {
    expect(buildArgs({ ...byId("claude"), args: ["--foo"] }, ID, true)).toEqual(["--foo", "--resume", ID]);
  });
});

describe("parseAgents", () => {
  it("accepts the defaults round-tripped through JSON", () => {
    const raw = JSON.parse(JSON.stringify({ agents: DEFAULT_AGENTS }));
    const { agents, errors } = parseAgents(raw);
    expect(errors).toEqual([]);
    expect(agents).toEqual(DEFAULT_AGENTS);
  });

  it("skips the second entry with a duplicate id", () => {
    const { agents, errors } = parseAgents({
      agents: [
        { id: "a", name: "A", command: "a" },
        { id: "a", name: "A2", command: "b" },
      ],
    });
    expect(agents.map((a) => a.name)).toEqual(["A"]);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain("duplicate id");
  });

  it("skips entries missing id, name or command", () => {
    const { agents, errors } = parseAgents({
      agents: [
        { name: "NoId", command: "x" },
        { id: "b", command: "x" },
        { id: "c", name: "NoCommand" },
        { id: "d", name: "OK", command: "d" },
      ],
    });
    expect(agents.map((a) => a.id)).toEqual(["d"]);
    expect(errors).toHaveLength(3);
    expect(errors.join("\n")).toMatch(/`id`.*`name`.*`command`/s);
  });

  it("empty list falls back to the defaults with an error", () => {
    const { agents, errors } = parseAgents({ agents: [] });
    expect(agents).toEqual(DEFAULT_AGENTS);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain("defaults");
  });

  it("garbage input falls back to the defaults with an error", () => {
    for (const raw of [null, "x", {}, { agents: "no" }, []]) {
      const { agents, errors } = parseAgents(raw);
      expect(agents).toEqual(DEFAULT_AGENTS);
      expect(errors.length).toBeGreaterThan(0);
    }
  });

  it("skips entries with a broken session block", () => {
    const { agents, errors } = parseAgents({
      agents: [
        { id: "a", name: "A", command: "a", session: { new: "--session-id" } },
        { id: "b", name: "B", command: "b", session: { new: ["x"], resume: ["y"], check: "magic" } },
      ],
    });
    expect(agents.map((a) => a.id)).toEqual(["b"]);
    expect(agents[0].session).toEqual({ new: ["x"], resume: ["y"] });
    expect(errors.some((e) => e.includes("duplicate") === false)).toBe(true);
    expect(errors.join("\n")).toContain("check");
  });

  it("keeps a valid #rrggbb color, drops a bad one with an error", () => {
    const { agents, errors } = parseAgents({
      agents: [
        { id: "a", name: "A", command: "a", color: "#3Dffa2" },
        { id: "b", name: "B", command: "b", color: "red" },
      ],
    });
    expect(agents.map((a) => a.id)).toEqual(["a", "b"]);
    expect(agents[0].color).toBe("#3Dffa2");
    expect(agents[1].color).toBeUndefined();
    expect(errors.join("\n")).toContain("`color`");
  });

  it("keeps a positive whole `context`, drops a bad one with an error", () => {
    const { agents, errors } = parseAgents({
      agents: [
        { id: "a", name: "A", command: "a", context: 1_000_000 },
        { id: "b", name: "B", command: "b", context: "200k" },
        { id: "c", name: "C", command: "c", context: 0 },
      ],
    });
    expect(agents.map((a) => a.context)).toEqual([1_000_000, undefined, undefined]);
    expect(errors.filter((e) => e.includes("`context`"))).toHaveLength(2);
  });
});

describe("agentColor", () => {
  const a = (id: string, color?: string): AgentDef => ({ id, name: id, command: id, ...(color ? { color } : {}) });

  it("prefers the agent's own color", () => {
    expect(agentColor(a("claude", "#000000"))).toBe("#000000");
  });

  it("falls back to the wzor palette by id, then to the generic blue", () => {
    expect(agentColor(a("claude"))).toBe("#ff7a3d");
    expect(agentColor(a("pi"))).toBe("#a78bfa");
    expect(agentColor(a("codex"))).toBe("#3dffa2");
    expect(agentColor(a("shell"))).toBe("#8fd3ff");
    expect(agentColor(undefined)).toBe("#8fd3ff");
  });
});
