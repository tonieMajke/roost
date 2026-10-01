import { afterEach, expect, it } from "vitest";
import { setLang } from "./i18n";
import { exitText, paneStatus } from "./activity";
import { relativeTime, exitedText } from "./feed";
import { limitHit, resetText } from "./limits";
import { branchLabel, canCommit, syncLabel } from "./git";

afterEach(() => setLang("pl"));

it("activity and feed texts follow the language", () => {
  setLang("en");
  expect(exitText({ code: 2, signal: null })).toBe("code 2");
  expect(paneStatus({ working: true }).text).toBe("working");
  expect(paneStatus({}).text).toBe("waiting");
  expect(exitedText({ code: 0, signal: "SIGKILL" })).toBe("process exited (signal SIGKILL)");
  expect(relativeTime(0, 3 * 60_000)).toBe("3 min ago");
  expect(relativeTime(0, 1000)).toBe("now");
});

it("limits and git labels follow the language", () => {
  setLang("en");
  const now = new Date(2026, 8, 30, 12, 0).getTime();
  expect(resetText(new Date(2026, 8, 30, 22, 40).getTime() / 1000, now)).toBe("resets at 22:40");
  expect(resetText(new Date(2026, 9, 1, 2, 5).getTime() / 1000, now)).toBe("resets tomorrow 02:05");
  const w = { fiveHour: { pct: 100, resetsAt: new Date(2026, 8, 30, 23, 0).getTime() / 1000 }, sevenDay: null, at: 1 };
  expect(limitHit(w, now)?.text).toBe("Session (5 h) limit reached · resets at 23:00");
  expect(canCommit([], "")).toBe("Enter a message");
  expect(syncLabel({ head: "m", oid: null, upstream: null, ahead: 0, behind: 0 })).toBe("no upstream");
  expect(branchLabel({ head: null, oid: "abcdef0123", upstream: null, ahead: 0, behind: 0 })).toBe("detached HEAD @ abcdef0");
});
