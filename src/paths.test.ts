import { describe, expect, it } from "vitest";
import { baseName, isUnder, programName, tildify, trimSep } from "./paths";

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

describe("ścieżki Windows", () => {
  it("tildify: dom bez względu na wielkość liter, separator jak w ścieżce", () => {
    expect(tildify("C:\\Users\\Ja\\proj", "C:\\Users\\Ja")).toBe("~\\proj");
    expect(tildify("c:\\users\\ja\\", "C:\\Users\\Ja")).toBe("~");
    expect(tildify("C:\\Users\\Jan\\x", "C:\\Users\\Ja")).toBe("C:\\Users\\Jan\\x");
    expect(tildify("D:\\kod", "C:\\Users\\Ja")).toBe("D:\\kod");
  });
  it("trimSep zostawia korzeń, baseName bierze ostatni człon", () => {
    expect(trimSep("C:\\")).toBe("C:\\");
    expect(trimSep("C:\\a\\")).toBe("C:\\a");
    expect(trimSep("/")).toBe("/");
    expect(baseName("C:\\Users\\Ja\\proj\\")).toBe("proj");
    expect(baseName("/home/ja/proj/")).toBe("proj");
    expect(baseName("~")).toBe("~");
  });
  it("isUnder: Windows bez względu na ukośnik i wielkość liter, bez fałszywego prefiksu", () => {
    expect(isUnder("C:\\kod\\a\\b.ts", "c:/KOD/a")).toBe(true);
    expect(isUnder("C:\\kod\\ab", "C:\\kod\\a")).toBe(false);
    expect(isUnder("/home/ja/Proj", "/home/ja/proj")).toBe(false);
  });
  it("programName: nazwa programu agenta z dowolnej ścieżki", () => {
    expect(programName("claude")).toBe("claude");
    expect(programName("/usr/bin/claude")).toBe("claude");
    expect(programName("C:\\Users\\Ja\\.local\\bin\\claude.exe")).toBe("claude");
    expect(programName("C:\\npm\\Codex.CMD")).toBe("codex");
    expect(programName("$SHELL")).toBe("$SHELL");
  });
});
