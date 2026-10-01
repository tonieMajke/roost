import { describe, expect, it } from "vitest";
import { botEnv, runProc } from "./proc";

const opts = (extra: Partial<Parameters<typeof runProc>[2]> = {}) => ({ cwd: "/tmp", timeoutMs: 5000, maxBytes: 1024, signal: new AbortController().signal, ...extra });

describe("runProc", () => {
  it("stdout i stderr, kod wyjścia", async () => {
    const r = await runProc("/bin/sh", ["-c", "echo out; echo err >&2; exit 3"], opts());
    expect(r.out).toContain("out");
    expect(r.out).toContain("err");
    expect(r.code).toBe(3);
  });
  it("wyjście ucięte do limitu", async () => {
    const r = await runProc("/bin/sh", ["-c", "head -c 5000 /dev/zero | tr '\\0' a"], opts({ maxBytes: 100 }));
    expect(r.out).toHaveLength(100);
    expect(r.truncated).toBe(true);
  });
  it("limit czasu zabija całą grupę, też dziecko powłoki", async () => {
    const t = Date.now();
    const r = await runProc("/bin/sh", ["-c", "sleep 30 & echo $!; wait"], opts({ timeoutMs: 300 }));
    expect(r.timedOut).toBe(true);
    expect(Date.now() - t).toBeLessThan(3000);
    const child = Number(r.out.trim());
    expect(() => process.kill(child, 0)).toThrow();
  });
  it("Stop przerywa", async () => {
    const ctl = new AbortController();
    setTimeout(() => ctl.abort(), 100);
    const r = await runProc("/bin/sh", ["-c", "sleep 30"], opts({ signal: ctl.signal }));
    expect(r.signal).toBe("SIGTERM");
  });
  it("brak programu = odrzucenie", async () => {
    await expect(runProc("nie-ma-takiego-programu-xyz", [], opts())).rejects.toThrow("nie uruchomiono");
  });
});

describe("botEnv", () => {
  it("bez kluczy aplikacji i zmiennych Electrona", () => {
    const env = botEnv({ PATH: "/usr/bin", AW_CHAT_API_KEY: "sk", AW_BOT_TOKEN: "t", ELECTRON_RUN_AS_NODE: "1", HOME: "/h" });
    expect(env).toEqual({ PATH: "/usr/bin", HOME: "/h" });
  });
});
