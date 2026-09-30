/** Context meter of agent panes (pane header `.ctx`, dock `.ctx-row`). Pure: no React, no DOM. */
import type { AgentDef } from "./agents";
import type { ToolUse } from "./feed";
import type { Pane, Project } from "./workspace";

/** Which session file reader (Rust `session_context`) understands this agent. */
export type ContextKind = "claude" | "pi";

/** Numbers read from the newest turn of a session file; `window` = from the agent's model config (pi);
 *  `tools` = newest tool calls, oldest first (feed „Na żywo”); `title` = name of the conversation. */
export type SessionContext = {
  tokens: number;
  model: string | null;
  window: number | null;
  tools: ToolUse[];
  title: string | null;
};

/** How often open conversations are re-read (plus once right after `finished`). */
export const CONTEXT_POLL_MS = 5000;

/** Share of the window that turns the meter to the accent color. */
export const CONTEXT_WARN_PCT = 80;

const DEFAULT_LIMITS: Record<ContextKind, number> = { claude: 200_000, pi: 128_000 };

/** Claude window by model id: 1M from Opus/Sonnet 4.6 and for Fable/Mythos, 200k for Haiku and older. */
export function claudeWindow(model: string | null | undefined): number | null {
  if (!model) return null;
  if (/fable|mythos/.test(model)) return 1_000_000;
  const m = /claude-(?:opus|sonnet)-(\d+)(?:-(\d{1,2}))?(?!\d)/.exec(model);
  if (m) {
    const version = Number(m[1]) + Number(m[2] ?? 0) / 10;
    return version >= 4.6 ? 1_000_000 : 200_000;
  }
  return /claude-/.test(model) ? 200_000 : null; // haiku, claude-3-* etc.
}

/** Reader by the program the agent runs (`/usr/bin/claude` too); others have no meter. */
export function contextKind(agent: AgentDef | undefined): ContextKind | null {
  if (!agent?.session) return null;
  const program = agent.command.split("/").pop();
  return program === "claude" || program === "pi" ? program : null;
}

/** Window size in tokens: `context` from agents.json, else the model of the last turn
 *  (pi: its config, claude: the model id), else the default of the kind. */
export function contextLimit(agent: AgentDef | undefined, ctx?: SessionContext): number | null {
  const kind = contextKind(agent);
  if (kind === null) return null;
  const byModel = ctx?.window ?? (kind === "claude" ? claudeWindow(ctx?.model) : null);
  return agent?.context ?? byModel ?? DEFAULT_LIMITS[kind];
}

/** Panes whose conversation can be measured: they need a session id and a known reader. */
export function contextTargets(
  panes: Pane[],
  agents: AgentDef[],
): { paneId: string; sessionId: string; kind: ContextKind }[] {
  const out: { paneId: string; sessionId: string; kind: ContextKind }[] = [];
  for (const pane of panes) {
    const kind = contextKind(agents.find((a) => a.id === pane.agentId));
    if (kind !== null && pane.sessionId) out.push({ paneId: pane.id, sessionId: pane.sessionId, kind });
  }
  return out;
}

/** `84k`, `1.2M` – short token counts, as in wzor D. */
export function formatTokens(n: number): string {
  return n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : `${Math.round(n / 1000)}k`;
}

export type ContextMeter = { known: boolean; pct: number; used: string; limit: string; warn: boolean };

/** Meter for `tokens` of `limit`; no data yet = 0 % with a dash. */
export function contextMeter(tokens: number | undefined, limit: number): ContextMeter {
  const pct = tokens === undefined ? 0 : Math.min(100, Math.round((tokens / limit) * 100));
  return {
    known: tokens !== undefined,
    pct,
    used: tokens === undefined ? "–" : formatTokens(tokens),
    limit: formatTokens(limit),
    warn: pct >= CONTEXT_WARN_PCT,
  };
}

/** Conversation title per pane id, all projects (dock: „Kontekst” and „Na żywo” rows). */
export function sessionTitles(projects: Project[], contexts: Record<string, SessionContext>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const pane of projects.flatMap((p) => p.panes)) {
    const title = pane.sessionId ? contexts[pane.sessionId]?.title : null;
    if (title) out[pane.id] = title;
  }
  return out;
}

/** Meter of one pane, or `null` when its agent has none (shell, unknown program, no session). */
export function paneMeter(
  pane: Pane,
  agent: AgentDef | undefined,
  contexts: Record<string, SessionContext>,
): ContextMeter | null {
  if (!pane.sessionId) return null;
  const ctx = contexts[pane.sessionId];
  const limit = contextLimit(agent, ctx);
  if (limit === null) return null;
  return contextMeter(ctx?.tokens, limit);
}
