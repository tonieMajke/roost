/** Agent definitions loaded from agents.json (see Rust `agents_load`). */
export type AgentDef = {
  id: string;
  name: string;
  command: string; // "$SHELL" is expanded by Rust
  args?: string[];
  session?: {
    new: string[]; // "{session}" is replaced with the session id
    resume: string[];
    check?: "claude"; // how to tell if a conversation exists; absent = always "new"
  };
  color?: string; // "#rrggbb", accent of this agent in the UI; absent = agentColor() default
};

export const DEFAULT_AGENTS: AgentDef[] = [
  {
    id: "claude",
    name: "Claude",
    command: "claude",
    session: { new: ["--session-id", "{session}"], resume: ["--resume", "{session}"], check: "claude" },
  },
  {
    id: "pi",
    name: "pi",
    command: "pi",
    session: { new: ["--session-id", "{session}"], resume: ["--session-id", "{session}"] },
  },
  { id: "shell", name: "Terminal", command: "$SHELL" },
];

const isStringArray = (v: unknown): v is string[] => Array.isArray(v) && v.every((x) => typeof x === "string");

const COLOR_RE = /^#[0-9a-fA-F]{6}$/;

/** UI colors of the wzor-D palette, keyed by agent id (agents.ts table in the plan). */
export const DEFAULT_AGENT_COLORS: Record<string, string> = {
  claude: "#ff7a3d",
  pi: "#a78bfa",
  codex: "#3dffa2",
};
const FALLBACK_AGENT_COLOR = "#8fd3ff";

/** Color of an agent: its `color` if set, else the palette by id, else the fallback. */
export function agentColor(agent: AgentDef | undefined): string {
  if (!agent) return FALLBACK_AGENT_COLOR;
  return agent.color ?? DEFAULT_AGENT_COLORS[agent.id] ?? FALLBACK_AGENT_COLOR;
}

/** Parse `{agents: [...]}`; bad entries are skipped and described in `errors`. Empty result falls back to defaults. */
export function parseAgents(raw: unknown): { agents: AgentDef[]; errors: string[] } {
  const errors: string[] = [];
  const list = (raw as { agents?: unknown })?.agents;
  if (!Array.isArray(list)) {
    return { agents: DEFAULT_AGENTS, errors: ["agents.json: expected an object with an `agents` array"] };
  }

  const agents: AgentDef[] = [];
  const seen = new Set<string>();
  list.forEach((entry, i) => {
    const where = `agents[${i}]`;
    if (typeof entry !== "object" || entry === null) {
      errors.push(`${where}: not an object, skipped`);
      return;
    }
    const e = entry as Record<string, unknown>;
    for (const field of ["id", "name", "command"] as const) {
      if (typeof e[field] !== "string" || e[field] === "") {
        errors.push(`${where}: missing \`${field}\`, skipped`);
        return;
      }
    }
    const id = e.id as string;
    if (seen.has(id)) {
      errors.push(`${where}: duplicate id \`${id}\`, skipped`);
      return;
    }
    if (e.args !== undefined && !isStringArray(e.args)) {
      errors.push(`${where}: \`args\` must be a list of strings, skipped`);
      return;
    }
    const agent: AgentDef = { id, name: e.name as string, command: e.command as string };
    if (e.args !== undefined) agent.args = e.args as string[];
    if (e.color !== undefined) {
      if (typeof e.color === "string" && COLOR_RE.test(e.color)) agent.color = e.color;
      else errors.push(`${where}: \`color\` must be "#rrggbb", field ignored`);
    }
    if (e.session !== undefined) {
      const s = e.session as Record<string, unknown>;
      if (typeof s !== "object" || s === null || !isStringArray(s.new) || !isStringArray(s.resume)) {
        errors.push(`${where}: \`session\` needs string lists \`new\` and \`resume\`, skipped`);
        return;
      }
      agent.session = { new: s.new as string[], resume: s.resume as string[] };
      if (s.check === "claude") agent.session.check = "claude";
      else if (s.check !== undefined) errors.push(`${where}: unknown session check \`${String(s.check)}\`, ignored`);
    }
    seen.add(id);
    agents.push(agent);
  });

  if (agents.length === 0) {
    errors.push("agents.json: no valid agents, using defaults");
    return { agents: DEFAULT_AGENTS, errors };
  }
  return { agents, errors };
}

/** Args for a launch: fixed args, then the new- or resume-conversation args for this session. */
export function buildArgs(agent: AgentDef, sessionId: string | undefined, exists: boolean): string[] {
  const args = [...(agent.args ?? [])];
  if (!agent.session || !sessionId) return args;
  const template = exists ? agent.session.resume : agent.session.new;
  return [...args, ...template.map((a) => a.replaceAll("{session}", sessionId))];
}
