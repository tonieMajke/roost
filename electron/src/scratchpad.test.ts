import { afterEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { MAX_BYTES, scratchpadLoad, scratchpadPath, scratchpadSave } from "./scratchpad";

const ID = "3f2a1b0c-0000-4000-8000-000000000001";
const dirs: string[] = [];
const tempDir = () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "aw-scratch-"));
  dirs.push(d);
  return d;
};
afterEach(() => {
  vi.restoreAllMocks();
  dirs.splice(0).forEach((d) => fs.rmSync(d, { recursive: true, force: true }));
});

describe("scratchpad", () => {
  it("ścieżka: <dir>/scratchpad/<id>.md; id spoza UUID odrzucone", () => {
    const dir = tempDir();
    expect(scratchpadPath(ID, dir)).toBe(path.join(dir, "scratchpad", `${ID}.md`));
    for (const bad of ["", "../x", "a/b", "..", "ABC", "x.md"]) expect(() => scratchpadPath(bad, dir)).toThrow();
  });

  it("brak notatki = pusty tekst, potem zapisana treść (z polskimi znakami)", () => {
    const dir = tempDir();
    expect(scratchpadLoad(ID, dir)).toBe("");
    scratchpadSave(ID, "# Zażółć\n- [ ] gęślą", dir);
    expect(scratchpadLoad(ID, dir)).toBe("# Zażółć\n- [ ] gęślą");
  });

  it("nie zostawia pliku tymczasowego, notatki projektów są osobne", () => {
    const dir = tempDir();
    const other = "3f2a1b0c-0000-4000-8000-000000000002";
    scratchpadSave(ID, "a", dir);
    scratchpadSave(ID, "b", dir);
    scratchpadSave(other, "c", dir);
    expect(fs.readdirSync(path.join(dir, "scratchpad")).sort()).toEqual([`${ID}.md`, `${other}.md`]);
    expect(scratchpadLoad(ID, dir)).toBe("b");
  });

  it("przerwany zapis (błąd przy rename) zostawia poprzednią wersję i sprząta tmp", () => {
    const dir = tempDir();
    scratchpadSave(ID, "stara", dir);
    vi.spyOn(fs, "renameSync").mockImplementation(() => {
      throw new Error("awaria");
    });
    expect(() => scratchpadSave(ID, "nowa", dir)).toThrow("awaria");
    vi.restoreAllMocks();
    expect(scratchpadLoad(ID, dir)).toBe("stara");
    expect(fs.readdirSync(path.join(dir, "scratchpad"))).toEqual([`${ID}.md`]);
  });

  it("odrzuca notatkę ponad limit, nic nie zapisując", () => {
    const dir = tempDir();
    scratchpadSave(ID, "x", dir);
    expect(() => scratchpadSave(ID, "a".repeat(MAX_BYTES + 1), dir)).toThrow(/za duża/);
    expect(scratchpadLoad(ID, dir)).toBe("x");
  });
});
