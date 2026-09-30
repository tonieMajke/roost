/** Feed „Na żywo” in the dock: events from all projects. Pure: no React, no DOM. Never saved. */
import type { ExitInfo } from "./backend";
import { exitText } from "./activity";

/** One tool call from the agent's session file (Rust `session_context`, oldest first). */
export type ToolUse = { id: string; name: string; file: string | null; command: string | null };

export type FeedItem = {
  id: number;
  paneId: string;
  projectId: string;
  agentId: string;
  /** Project name at the time of the event: the pane may be gone when the row is read. */
  project: string;
  text: string;
  at: number;
};

export const FEED_MAX = 30;

/** How often the „N s temu” labels are recomputed while the dock is open. */
export const FEED_CLOCK_MS = 5000;

/** Newest first, at most FEED_MAX; `items` come oldest first. */
export function pushFeed(feed: FeedItem[], items: FeedItem[]): FeedItem[] {
  if (items.length === 0) return feed;
  return [...items].reverse().concat(feed).slice(0, FEED_MAX);
}

/** Rows shown under the dock switch: all projects, or only the one on screen. */
export function feedFor(feed: FeedItem[], scope: "all" | "project", projectId: string | null): FeedItem[] {
  return scope === "all" ? feed : feed.filter((item) => item.projectId === projectId);
}

/** „teraz”, „40 s temu”, „3 min temu”, „2 godz. temu”, „5 d temu”. */
export function relativeTime(at: number, now: number): string {
  const s = Math.floor((now - at) / 1000);
  if (s < 10) return "teraz"; // also a clock that went back
  if (s < 60) return `${Math.floor(s / 10) * 10} s temu`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} min temu`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} godz. temu`;
  return `${Math.floor(h / 24)} d temu`;
}

/**
 * Calls after the last one already shown. `seen === undefined` = first read of this
 * conversation: everything in the file is old news (app start, resumed session).
 * `seen` missing from the list = more new calls than the list holds: all of them.
 */
export function newTools(seen: string | null | undefined, tools: ToolUse[]): ToolUse[] {
  if (seen === undefined) return [];
  if (seen === null) return tools;
  const i = tools.findIndex((t) => t.id === seen);
  return i < 0 ? tools : tools.slice(i + 1);
}

/** `~/x` → `/home/u/x`, so it can be compared with the absolute paths claude writes. */
function expand(path: string, home: string): string {
  return home !== "" && (path === "~" || path.startsWith("~/")) ? home + path.slice(1) : path;
}

/** `Write src/feed.ts`, `bash pnpm test`: the path relative to the project when inside it. */
export function toolText(tool: ToolUse, projectPath: string, home: string): string {
  let detail = tool.command ?? "";
  if (tool.file !== null) {
    const dir = expand(projectPath, home).replace(/\/+$/, "") + "/";
    detail = tool.file.startsWith(dir) ? tool.file.slice(dir.length) : tool.file;
  }
  return detail === "" ? tool.name : `${tool.name} ${detail}`;
}

export const STARTED_TEXT = "uruchomiony";
export const FINISHED_TEXT = "skończył pracę";

export function exitedText(info: ExitInfo): string {
  return `proces zakończony (${exitText(info)})`;
}
