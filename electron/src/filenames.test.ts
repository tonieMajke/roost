import fs from "node:fs";
import path from "node:path";
import { expect, it } from "vitest";

/** Moduły w jednym folderze, których import (`./x`, bez rozszerzenia) różni się tylko wielkością liter.
 *  Na Windows i macOS system plików ich nie rozróżnia: `./Nebula` trafiał w `nebula.ts` zamiast `Nebula.tsx`. */
function caseClashes(dir: string): string[][] {
  const out: string[][] = [];
  const byStem = new Map<string, string[]>();
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === "node_modules" || e.name.startsWith(".")) continue;
    if (e.isDirectory()) out.push(...caseClashes(path.join(dir, e.name)));
    else if (/\.(tsx?|mts|cts)$/.test(e.name)) {
      const stem = e.name.replace(/\.(tsx?|mts|cts)$/, "");
      const key = stem.toLowerCase();
      byStem.set(key, [...(byStem.get(key) ?? []), stem]);
    }
  }
  for (const stems of byStem.values()) if (new Set(stems).size > 1) out.push(stems.map((s) => path.join(dir, s)));
  return out;
}

it("żadne dwa moduły nie różnią się tylko wielkością liter (Windows, macOS)", () => {
  const root = path.join(__dirname, "..", "..");
  expect([...caseClashes(path.join(root, "src")), ...caseClashes(path.join(root, "electron", "src"))]).toEqual([]);
});
