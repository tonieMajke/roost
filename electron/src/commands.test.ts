import { describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { commandExists, commandsAvailable } from "./commands";

function bin(files: Record<string, number>): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "roost-cmd-"));
  for (const [name, mode] of Object.entries(files)) fs.writeFileSync(path.join(dir, name), "#!/bin/sh\n", { mode });
  return dir;
}

describe("commandExists", () => {
  it("znajduje wykonywalny plik w PATH i pomija nie-wykonywalny", () => {
    const dir = bin({ agent: 0o755, plain: 0o644 });
    expect(commandExists("agent", dir)).toBe(true);
    expect(commandExists("plain", dir)).toBe(false);
    expect(commandExists("missing", dir)).toBe(false);
  });

  it("szuka we wszystkich katalogach PATH i znosi puste wpisy", () => {
    const a = bin({});
    const b = bin({ tool: 0o755 });
    expect(commandExists("tool", [a, "", b].join(path.delimiter))).toBe(true);
  });

  it("nie traktuje katalogu jako programu", () => {
    const dir = bin({});
    fs.mkdirSync(path.join(dir, "sub"));
    expect(commandExists("sub", dir)).toBe(false);
  });

  it("komenda ze ścieżką jest sprawdzana wprost, bez PATH", () => {
    const dir = bin({ x: 0o755 });
    expect(commandExists(path.join(dir, "x"), "")).toBe(true);
    expect(commandExists(path.join(dir, "nope"), dir)).toBe(false);
  });

  it.skipIf(process.platform === "win32")("rozwija $SHELL (pusty = /bin/sh) i odrzuca pustą komendę", () => {
    const dir = bin({ sh: 0o755 });
    const old = process.env.SHELL;
    process.env.SHELL = path.join(dir, "sh");
    try {
      expect(commandExists("$SHELL", "")).toBe(true);
      process.env.SHELL = "";
      expect(commandExists("$SHELL", "")).toBe(fs.existsSync("/bin/sh"));
      expect(commandExists("", dir)).toBe(false);
    } finally {
      if (old === undefined) delete process.env.SHELL;
      else process.env.SHELL = old;
    }
  });

  it("commandsAvailable zwraca wynik po tekście komendy", () => {
    const dir = bin({ claude: 0o755 });
    expect(commandsAvailable(["claude", "pi"], dir)).toEqual({ claude: true, pi: false });
  });
});
