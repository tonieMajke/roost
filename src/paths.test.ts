import { describe, expect, it } from "vitest";
import { tildify } from "./paths";

describe("tildify", () => {
  it("zastępuje katalog domowy tyldą", () => {
    expect(tildify("/home/majke/Dokumenty/x", "/home/majke")).toBe("~/Dokumenty/x");
    expect(tildify("/home/majke", "/home/majke")).toBe("~");
  });

  it("obcina końcowe ukośniki", () => {
    expect(tildify("/home/majke/", "/home/majke")).toBe("~");
    expect(tildify("/home/majke/x/", "/home/majke")).toBe("~/x");
    expect(tildify("/home/majke/x", "/home/majke/")).toBe("~/x");
    expect(tildify("/", "/home/majke")).toBe("/");
  });

  it("zostawia ścieżki spoza domu", () => {
    expect(tildify("/opt/project", "/home/majke")).toBe("/opt/project");
    // sam prefiks nie jest domem: "/home/majkex" to nie "/home/majke"
    expect(tildify("/home/majkex/y", "/home/majke")).toBe("/home/majkex/y");
  });

  it("bez użytecznego domu tylko czyści ścieżkę", () => {
    expect(tildify("/data/x/", "")).toBe("/data/x");
    expect(tildify("/data/x/", "/")).toBe("/data/x");
    expect(tildify("/", "/")).toBe("/");
  });
});
