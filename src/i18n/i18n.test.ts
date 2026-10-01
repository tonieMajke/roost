import { afterEach, describe, expect, it } from "vitest";
import { getLang, resolveLang, setLang, t, tp } from "./index";

afterEach(() => setLang("pl"));

describe("resolveLang", () => {
  it("follows the system language only on auto", () => {
    expect(resolveLang("auto", "pl-PL")).toBe("pl");
    expect(resolveLang("auto", "en-GB")).toBe("en");
    expect(resolveLang("auto", "de-DE")).toBe("en");
    expect(resolveLang("auto", undefined)).toBe("en");
    expect(resolveLang("en", "pl-PL")).toBe("en");
    expect(resolveLang("pl", "en-US")).toBe("pl");
  });
});

describe("language switch", () => {
  it("setLang changes the current language", () => {
    setLang("en");
    expect(getLang()).toBe("en");
  });
});

describe("t / tp", () => {
  it("returns the key itself for an unknown key", () => {
    expect(t("no.such.key" as never)).toBe("no.such.key");
    expect(tp("no.such.key" as never, 2)).toBe("no.such.key");
  });
});
