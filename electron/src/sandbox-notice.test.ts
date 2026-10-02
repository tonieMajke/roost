import { afterEach, expect, test } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DISMISS_FILE, dismiss, noticeOptions, shouldWarn } from "./sandbox-notice";
import { setMainLang } from "./i18n";

afterEach(() => setMainLang("pl"));

test("ostrzega tylko spakowaną aplikację z --no-sandbox, do czasu „Nie pokazuj ponownie”", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "roost-sb-"));
  expect(shouldWarn(false, true, dir)).toBe(false);
  expect(shouldWarn(true, false, dir)).toBe(false);
  expect(shouldWarn(true, true, dir)).toBe(true);
  dismiss(path.join(dir, "nowy")); // katalog jeszcze nie istnieje
  expect(fs.statSync(path.join(dir, "nowy", DISMISS_FILE)).mode & 0o777).toBe(0o600);
  dismiss(dir);
  expect(shouldWarn(true, true, dir)).toBe(false);
});

test("teksty okna w obu językach, przycisk 0 to instrukcja", () => {
  expect(noticeOptions().buttons[0]).toBe("Pokaż instrukcję");
  setMainLang("en");
  const o = noticeOptions();
  expect(o.message).toBe("Roost is running without the Chromium sandbox");
  expect(o.cancelId).toBe(1);
});
