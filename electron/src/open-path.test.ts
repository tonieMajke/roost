import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, expect, it } from "vitest";
import { resolveFiles } from "./open-path";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "aw-open-"));
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));
fs.mkdirSync(path.join(dir, "src"));
fs.writeFileSync(path.join(dir, "src", "foo.ts"), "x");

it("zwraca tylko istniejące zwykłe pliki, względne i bezwzględne", () => {
  const abs = path.join(dir, "src", "foo.ts");
  expect(resolveFiles(dir, ["src/foo.ts", "./src/../src/foo.ts", abs, "src/brak.ts", "src", "", "a\0b"])).toEqual([abs, abs, abs, null, null, null, null]);
});

it("~/ w ścieżce rozwija się do katalogu domowego", () => {
  expect(resolveFiles(dir, ["~/src/foo.ts"], dir)).toEqual([path.join(dir, "src", "foo.ts")]);
});
