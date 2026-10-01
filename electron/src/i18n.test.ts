import { afterEach, expect, test } from "vitest";
import { resolveMainLang, setMainLang, t } from "./i18n";

afterEach(() => setMainLang("pl"));

test("domyślnie polski, po setMainLang angielski, parametry się wstawiają", () => {
  expect(t("notify.open")).toBe("Otwórz");
  setMainLang("en");
  expect(t("notify.open")).toBe("Open");
  expect(t("git.timeout", { cmd: "pull" })).toBe("git pull: timed out");
});

test("resolveMainLang: auto idzie za systemem", () => {
  expect(resolveMainLang("auto", "pl-PL")).toBe("pl");
  expect(resolveMainLang(undefined, "de-DE")).toBe("en");
  expect(resolveMainLang("pl", "en-US")).toBe("pl");
});
