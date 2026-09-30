import { describe, expect, it } from "vitest";
import { mockBackend } from "./backend-mock";
import type { ExitInfo, PtyHandle } from "./backend";

const dec = new TextDecoder();

async function start() {
  const chunks: string[] = [];
  const exits: ExitInfo[] = [];
  const pty: PtyHandle = await mockBackend.spawnPty(
    { command: "claude", args: ["--resume"], cwd: "~/proj", cols: 80, rows: 24 },
    (bytes) => chunks.push(dec.decode(bytes)),
    (info) => exits.push(info),
  );
  return { pty, text: () => chunks.join(""), exits };
}

describe("mock backend (tryb podglądu)", () => {
  it("wypisuje banner ze specą spawnu", async () => {
    const { text } = await start();
    const out = text();
    expect(out).toContain("[podgląd]");
    expect(out).toContain("claude --resume w ~/proj");
    expect(out.endsWith("$ ")).toBe(true);
  });

  it("odbija znaki i Enter daje nowy prompt", async () => {
    const { pty, text, exits } = await start();
    pty.write("abc");
    expect(text().endsWith("abc")).toBe(true);
    pty.write("\r");
    expect(text().endsWith("abc\r\n$ ")).toBe(true);
    expect(exits).toEqual([]);
  });

  it("Backspace cofa znak, Ctrl+C czysci linię", async () => {
    const { pty, text } = await start();
    pty.write("ab\x7f");
    expect(text().endsWith("ab\b \b")).toBe(true);
    pty.write("\x03");
    expect(text().endsWith("$ ")).toBe(true);
  });

  it("exit kończy z kodem 0, fail z kodem 1", async () => {
    const a = await start();
    a.pty.write("exit\r");
    expect(a.exits).toEqual([{ code: 0, signal: null }]);
    a.pty.write("cos\r");
    expect(a.exits).toHaveLength(1);

    const b = await start();
    b.pty.write("fail\r");
    expect(b.exits).toEqual([{ code: 1, signal: null }]);
  });

  it("kill kończy z kodem 0 po krótkiej chwili, jednorazowo", async () => {
    const { pty, exits } = await start();
    pty.kill();
    pty.kill();
    expect(exits).toEqual([]);
    await new Promise((r) => setTimeout(r, 150));
    expect(exits).toEqual([{ code: 0, signal: null }]);
  });
});
