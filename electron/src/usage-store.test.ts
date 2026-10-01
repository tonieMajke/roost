import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ledgerRows, providerLabel, UsageLedger } from "./usage-store";

const dirs: string[] = [];
const tmp = () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "ledger-"));
  dirs.push(d);
  return d;
};
afterEach(() => {
  for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

const u = (input: number, output: number) => ({ input, output, cacheRead: 0, cacheWrite: 0, reasoning: 0 });
const T = new Date(2026, 8, 30, 12).getTime();

describe("UsageLedger", () => {
  it("dopisuje linie i sumuje do dni", () => {
    const l = new UsageLedger(tmp());
    l.record({ ts: T, source: "chat", provider: "claude", model: "claude-opus-5-5", usage: u(10, 5) });
    l.record({ ts: T + 1000, source: "chat", provider: "claude", model: "claude-opus-5-5", usage: u(20, 5), costUsd: 0.01 });
    l.record({ ts: T, source: "bot", provider: "llama", model: "Qwen", usage: u(1, 1), ref: "bot1" });
    const rows = l.rows();
    expect(rows).toHaveLength(2);
    expect(rows.find((r) => r.source === "chat")).toMatchObject({ day: "2026-09-30", input: 30, output: 10, n: 2, costUsd: 0.01 });
  });
  it("pomija puste zużycie i normalizuje model", () => {
    const l = new UsageLedger(tmp());
    l.record({ ts: T, source: "chat", provider: "claude", model: "haiku", usage: u(0, 0) });
    expect(l.rows()).toEqual([]);
    l.record({ ts: T, source: "chat", provider: "claude", model: "haiku", usage: u(1, 1) });
    expect(l.rows()[0].model).toBe("claude-haiku-4-5");
  });
  it("brak pliku = pusto; uszkodzona linia nie psuje reszty", () => {
    expect(new UsageLedger(tmp()).rows()).toEqual([]);
    const ok = JSON.stringify({ ts: T, source: "chat", provider: "p", model: "m", usage: u(3, 4) });
    expect(ledgerRows(`${ok}\n{"ts":1,"usa\n${JSON.stringify({ ts: T, source: "pane", provider: "p", model: "m", usage: u(9, 9) })}\n`)).toHaveLength(1);
  });
  it("błąd zapisu nie rzuca", () => {
    const d = tmp();
    fs.writeFileSync(path.join(d, "plik"), "");
    expect(() => new UsageLedger(path.join(d, "plik", "pod")).record({ ts: T, source: "chat", provider: "p", model: "m", usage: u(1, 1) })).not.toThrow();
  });
});

describe("providerLabel", () => {
  it("programy CLI mają nazwę programu, reszta id dostawcy", () => {
    expect(providerLabel({ id: "chatgpt", kind: "codex-cli" })).toBe("codex");
    expect(providerLabel({ id: "claude", kind: "claude-cli" })).toBe("claude");
    expect(providerLabel({ id: "openrouter", kind: "openai" })).toBe("openrouter");
  });
});
