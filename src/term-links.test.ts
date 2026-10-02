import { describe, expect, it } from "vitest";
import { absolutePath, findPathRefs, openPlan } from "./term-links";

const paths = (s: string) => findPathRefs(s).map((r) => r.path);

describe("findPathRefs", () => {
  it("ścieżka z linią i kolumną, zakres obejmuje sufiks", () => {
    const line = "  at src/foo.ts:41:7 done";
    const [r] = findPathRefs(line);
    expect(r).toMatchObject({ path: "src/foo.ts", line: 41, col: 7 });
    expect(line.slice(r!.start, r!.end)).toBe("src/foo.ts:41:7");
  });
  it("bez numeru linii", () => {
    const [r] = findPathRefs("zmieniono src/foo.ts");
    expect(r).toEqual({ start: 10, end: 20, path: "src/foo.ts" });
  });
  it("absolutne, ~ i ./ ../", () => {
    expect(paths("/etc/hosts ~/a/b.md ./x.ts ../y/z.py:3")).toEqual(["/etc/hosts", "~/a/b.md", "./x.ts", "../y/z.py"]);
  });
  it("goły plik z rozszerzeniem", () => {
    expect(paths("zobacz README.md:12")).toEqual(["README.md"]);
  });
  it("interpunkcja na końcu i w nawiasach", () => {
    expect(paths("(src/a.ts), potem src/b.ts.")).toEqual(["src/a.ts", "src/b.ts"]);
    expect(findPathRefs("błąd w src/a.ts:5.")[0]).toMatchObject({ path: "src/a.ts", line: 5 });
  });
  it("pomija adresy, wersje, katalogi i zwykłe słowa", () => {
    expect(paths("https://example.com/a/b.ts")).toEqual([]);
    expect(paths("wersja 1.5 i 0.1.2, tak; zwykłe słowa")).toEqual([]);
    expect(paths("katalog src/ oraz ...")).toEqual([]);
  });
  it("linia 0 jest ignorowana, myślniki i polskie litery", () => {
    expect(findPathRefs("a/b.ts:0")[0]).toMatchObject({ path: "a/b.ts", end: 6 });
    expect(findPathRefs("a/b.ts:0")[0]!.line).toBeUndefined();
    expect(paths("docs/plan-kalendarz-mail.md żółć/pliczek.txt")).toEqual(["docs/plan-kalendarz-mail.md", "żółć/pliczek.txt"]);
  });
  it("Windows: dysk, ukośniki wsteczne, sufiks linii po dwukropku dysku", () => {
    const line = "error at C:\\Users\\Ja\\proj\\src\\main.rs:12:5 oraz src\\lib.rs";
    const refs = findPathRefs(line);
    expect(refs[0]).toMatchObject({ path: "C:\\Users\\Ja\\proj\\src\\main.rs", line: 12, col: 5 });
    expect(line.slice(refs[0]!.start, refs[0]!.end)).toBe("C:\\Users\\Ja\\proj\\src\\main.rs:12:5");
    expect(refs[1]).toMatchObject({ path: "src\\lib.rs" });
    expect(paths("D:/kod/a.ts .\\x.ts ~\\notatki.md")).toEqual(["D:/kod/a.ts", ".\\x.ts", "~\\notatki.md"]);
    // litera bez ukośnika to nie dysk; ścieżka sieciowa i sam `\n` też nie
    expect(paths("klasa A:b \\\\serwer\\udział tekst\\n")).toEqual([]);
    expect(paths('"src/a.ts\\n"')).toEqual(["src/a.ts"]);
  });
  it("nie zawiesza się na bardzo długiej linii", () => {
    expect(findPathRefs("a/b ".repeat(5000)).length).toBeLessThanOrEqual(40);
  });
});

describe("absolutePath", () => {
  it("względne do cwd, ~ i normalizacja ..", () => {
    expect(absolutePath("src/a.ts", "/p/x", "/h")).toBe("/p/x/src/a.ts");
    expect(absolutePath("../b.ts", "/p/x", "/h")).toBe("/p/b.ts");
    expect(absolutePath("~/n.md", "/p", "/h")).toBe("/h/n.md");
    expect(absolutePath("/etc/./hosts", "/p", "/h")).toBe("/etc/hosts");
  });
});

describe("openPlan", () => {
  it("edytory GUI dostają plik:linia, jako tablica argumentów", () => {
    expect(openPlan("/a b.ts", 4, 2, "code")).toEqual({ command: "code", args: ["-g", "/a b.ts:4:2"] });
    expect(openPlan("/a.ts", 4, undefined, "/usr/bin/kate")).toEqual({ command: "kate", args: ["-l", "4", "/a.ts"] });
    expect(openPlan("/a.ts", undefined, undefined, "code --wait")).toEqual({ command: "code", args: ["/a.ts"] });
  });
  it("edytor terminalowy, nieznany albo brak: xdg-open", () => {
    for (const e of ["vim", "nano", "", undefined, "rm", "; rm -rf ~"]) {
      expect(openPlan("/a.ts", 3, 1, e)).toEqual({ command: "xdg-open", args: ["/a.ts"] });
    }
    expect(openPlan("/a.ts", 3, 1, "constructor").command).toBe("xdg-open");
  });
});
