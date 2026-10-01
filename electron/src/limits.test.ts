import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { LIMITS_FILE, parseStatus, settingsArg, store, userHasStatusLine } from "./limits";

const tempDir = () => fs.mkdtempSync(path.join(os.tmpdir(), "aw-limits-"));

describe("limits", () => {
  it("zostawia tylko okna", () => {
    const input = `{"session_id":"x","cwd":"/secret","rate_limits":{
      "five_hour":{"used_percentage":42.5,"resets_at":1790000000},
      "seven_day":{"used_percentage":18,"resets_at":1790500000}}}`;
    const got = parseStatus(input, 7)!;
    expect(got.fiveHour).toEqual({ pct: 42.5, resetsAt: 1_790_000_000 });
    expect(got.sevenDay?.pct).toBe(18);
    const json = JSON.stringify(got);
    expect(json).not.toContain("secret");
    expect(json).toContain('"resetsAt"');
  });

  it("bez limitów nie ma zapisu", () => {
    expect(parseStatus('{"model":{"id":"m"}}', 1)).toBeNull();
    expect(parseStatus('{"rate_limits":{"spend_limit":{"used_percentage":1,"resets_at":2}}}', 1)).toBeNull();
    expect(parseStatus("not json", 1)).toBeNull();
    const one = parseStatus('{"rate_limits":{"seven_day":{"used_percentage":3,"resets_at":9}}}', 1)!;
    expect([one.fiveHour, one.sevenDay?.resetsAt]).toEqual([null, 9]);
  });

  it("store zapisuje i nie zostawia pliku tymczasowego", () => {
    const dir = tempDir();
    try {
      const file = path.join(dir, LIMITS_FILE);
      const limits = parseStatus('{"rate_limits":{"five_hour":{"used_percentage":1,"resets_at":2}}}', 3)!;
      store(file, limits);
      expect(JSON.parse(fs.readFileSync(file, "utf8"))).toEqual(limits);
      expect(fs.readdirSync(dir)).toEqual([LIMITS_FILE]);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("settingsArg cytuje ścieżki ze spacjami i apostrofami", () => {
    const v = JSON.parse(settingsArg("/a b/agents", "/x/statusline.cjs", "/c/it's.json"));
    expect(v.statusLine.type).toBe("command");
    expect(v.statusLine.command).toBe(`ELECTRON_RUN_AS_NODE=1 '/a b/agents' '/x/statusline.cjs' '/c/it'\\''s.json'`);
  });

  it("wykrywa własną linię statusu użytkownika", () => {
    const dir = tempDir();
    try {
      const file = path.join(dir, "settings.json");
      expect(userHasStatusLine(file)).toBe(false);
      fs.writeFileSync(file, '{"model":"opus"}');
      expect(userHasStatusLine(file)).toBe(false);
      fs.writeFileSync(file, '{"statusLine":{"type":"command","command":"x"}}');
      expect(userHasStatusLine(file)).toBe(true);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("polecenie z settingsArg przez sh zapisuje limity (zbudowany statusline.cjs)", () => {
    const helper = path.join(__dirname, "..", "out", "statusline.cjs");
    if (!fs.existsSync(helper)) return; // przed `npm run build:main` nie ma czego uruchomić
    const dir = tempDir();
    try {
      const file = path.join(dir, LIMITS_FILE);
      // node zamiast binarki Electrona: ELECTRON_RUN_AS_NODE robi z niej node, tu jest nim już
      const { command } = JSON.parse(settingsArg(process.execPath, helper, file)).statusLine;
      const out = execFileSync("sh", ["-c", command], {
        input: '{"rate_limits":{"five_hour":{"used_percentage":5,"resets_at":6}}}',
        encoding: "utf8",
      });
      expect(out).toBe("");
      expect(JSON.parse(fs.readFileSync(file, "utf8")).fiveHour).toEqual({ pct: 5, resetsAt: 6 });
      // śmieci na wejściu: nadal kod 0 i stary zapis zostaje
      execFileSync("sh", ["-c", command], { input: "nie json" });
      expect(JSON.parse(fs.readFileSync(file, "utf8")).fiveHour.pct).toBe(5);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
