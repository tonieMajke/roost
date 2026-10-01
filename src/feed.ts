/** Feed „Na żywo” in the dock: events from all projects. Pure: no React, no DOM. Never saved. */
import type { ExitInfo } from "./backend";
import { exitText } from "./activity";
import { t } from "./i18n";

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
  /** `tool` = one call of the agent: only the newest per pane is kept; `event` = start, finish, exit, handoff. */
  kind: "tool" | "event";
};

export const FEED_MAX = 30;

/** How often the „N s temu” labels are recomputed while the dock is open. */
export const FEED_CLOCK_MS = 5000;

/**
 * Newest first, at most FEED_MAX; `items` come oldest first. A pane shows what it does
 * now: its older `tool` rows go away when a newer one (or any event) arrives.
 */
export function pushFeed(feed: FeedItem[], items: FeedItem[]): FeedItem[] {
  if (items.length === 0) return feed;
  const fresh = new Set(items.map((i) => i.paneId));
  const kept = feed.filter((i) => i.kind !== "tool" || !fresh.has(i.paneId));
  const added = [...items].reverse().filter((i, n, all) => i.kind !== "tool" || all.findIndex((j) => j.kind === "tool" && j.paneId === i.paneId) === n);
  return added.concat(kept).slice(0, FEED_MAX);
}

/** Rows shown under the dock switch: all projects, or only the one on screen. */
export function feedFor(feed: FeedItem[], scope: "all" | "project", projectId: string | null): FeedItem[] {
  return scope === "all" ? feed : feed.filter((item) => item.projectId === projectId);
}

/** „teraz”, „40 s temu”, „3 min temu”, „2 godz. temu”, „5 d temu”. */
export function relativeTime(at: number, now: number): string {
  const s = Math.floor((now - at) / 1000);
  if (s < 10) return t("ui2.feed.now"); // also a clock that went back
  if (s < 60) return t("ui2.feed.sec", { n: Math.floor(s / 10) * 10 });
  const m = Math.floor(s / 60);
  if (m < 60) return t("ui2.feed.min", { n: m });
  const h = Math.floor(m / 60);
  if (h < 24) return t("ui2.feed.hour", { n: h });
  return t("ui2.feed.day", { n: Math.floor(h / 24) });
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

export const startedText = () => t("ui2.feed.started");
export const finishedText = () => t("ui2.feed.finished");

export function exitedText(info: ExitInfo): string {
  return t("ui2.feed.exited", { text: exitText(info) });
}
