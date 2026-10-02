import { afterEach, expect, test } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { readyOptions, updatable } from "./updater";
import { setMainLang } from "./i18n";

afterEach(() => setMainLang("pl"));

test("Linux: tylko spakowany AppImage", () => {
  const o = { packaged: true, platform: "linux" as const, env: { APPIMAGE: "/home/x/Roost-0.0.2.AppImage" }, exePath: "/tmp/.mount_x/roost-app" };
  expect(updatable(o)).toBe(true);
  expect(updatable({ ...o, packaged: false })).toBe(false);
  expect(updatable({ ...o, env: {} })).toBe(false);
  expect(updatable({ ...o, env: { ...o.env, ROOST_NO_UPDATE: "1" } })).toBe(false);
});

test("Windows: instalacja NSIS tak, zip przenośny nie", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "roost-up-"));
  const o = { packaged: true, platform: "win32" as const, env: {}, exePath: path.join(dir, "Roost.exe") };
  expect(updatable(o)).toBe(false);
  fs.writeFileSync(path.join(dir, "Uninstall Roost.exe"), "");
  expect(updatable(o)).toBe(true);
  expect(updatable({ ...o, platform: "darwin" })).toBe(false);
});

test("okno gotowej aktualizacji w obu językach, przycisk 0 uruchamia ponownie", () => {
  expect(readyOptions("0.0.3").message).toBe("Roost 0.0.3 jest gotowy");
  setMainLang("en");
  const o = readyOptions("0.0.3");
  expect(o.buttons).toEqual(["Restart", "Later"]);
  expect(o.defaultId).toBe(0);
});
