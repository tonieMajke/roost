import { afterEach, describe, expect, it } from "vitest";
import { botGreeting, creatorBot, displayName, runWhen, scheduleLabel, toolLabel } from "./bot";
import { setLang } from "./i18n";

afterEach(() => setLang("pl"));

describe("bot: angielski", () => {
  it("harmonogram i terminy", () => {
    setLang("en");
    expect(scheduleLabel({ kind: "daily", at: "08:00", days: [1, 2, 3, 4, 5] })).toBe("Mon–Fri 08:00");
    expect(scheduleLabel({ kind: "every", minutes: 15 })).toBe("every 15 min");
    const now = new Date(2026, 9, 1, 12).getTime();
    expect(runWhen(new Date(2026, 9, 2, 8).getTime(), now)).toBe("tomorrow 08:00");
    expect(runWhen(new Date(2026, 9, 9, 8).getTime(), now)).toBe("Fri Oct 9 08:00");
  });
  it("etykiety narzędzi i Kreator", () => {
    setLang("en");
    expect(toolLabel("read_file", { path: "/a/b/c.rs" })).toBe("Reads `…/b/c.rs`");
    expect(displayName(creatorBot(0))).toBe("Creator");
    expect(botGreeting(creatorBot(0))).toMatch(/^I'm the Creator/);
    setLang("pl");
    expect(displayName(creatorBot(0))).toBe("Kreator");
  });
});
