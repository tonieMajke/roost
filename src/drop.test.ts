import { describe, expect, it } from "vitest";
import { droppedPaths, hasFiles, quotePath, quotePaths } from "./drop";

describe("quotePath", () => {
  it("zwykła ścieżka i spacje w podwójnym cudzysłowie", () => {
    expect(quotePath("/home/majke/a.txt")).toBe('"/home/majke/a.txt"');
    expect(quotePath("/home/majke/Moje Dokumenty/a b.txt")).toBe('"/home/majke/Moje Dokumenty/a b.txt"');
  });
  it("ucieka cudzysłów, ukośnik, dolara i odwrotny apostrof", () => {
    expect(quotePath('/x/a"b')).toBe('"/x/a\\"b"');
    expect(quotePath("/x/a\\b")).toBe('"/x/a\\\\b"');
    expect(quotePath("/x/$HOME`id`")).toBe('"/x/\\$HOME\\`id\\`"');
  });
  it("apostrof zostaje w podwójnym cudzysłowie", () => {
    expect(quotePath("/x/it's")).toBe(`"/x/it's"`);
  });
  it("wykrzyknik: apostrofy, apostrof jako '\\''", () => {
    expect(quotePath("/x/hej!")).toBe("'/x/hej!'");
    expect(quotePath("/x/it's!")).toBe(`'/x/it'\\''s!'`);
  });
  it("polskie znaki i nowa linia bez zmian", () => {
    expect(quotePath("/x/zażółć\ngęślą")).toBe('"/x/zażółć\ngęślą"');
  });
});

describe("quotePaths", () => {
  it("łączy spacją, bez Entera, pomija puste", () => {
    expect(quotePaths(["/a b", "", "/c"])).toBe('"/a b" "/c"');
    expect(quotePaths([])).toBe("");
  });
});

describe("hasFiles", () => {
  it("rozpoznaje tylko pliki", () => {
    expect(hasFiles(["text/plain", "Files"])).toBe(true);
    expect(hasFiles(["text/uri-list"])).toBe(false);
    expect(hasFiles(null)).toBe(false);
  });
});

describe("droppedPaths", () => {
  it("pomija pliki bez ścieżki", () => {
    const files = [{ n: "a" }, { n: "b" }, { n: "c" }] as unknown as File[];
    const n = (f: File) => (f as unknown as { n: string }).n;
    expect(droppedPaths(files, (f) => (n(f) === "b" ? "" : `/p/${n(f)}`))).toEqual(["/p/a", "/p/c"]);
  });
});
