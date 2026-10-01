import { describe, expect, it } from "vitest";
import { ensureFreeToken, freetokenInstance, type Env } from "./freetoken";

const M = "Swift-Flash-Next-NVFP4";

function fakeEnv(o: Partial<Env> & { upAfter?: number } = {}) {
  const calls: string[] = [];
  let polls = 0;
  const env: Env = {
    answers: async () => (o.upAfter === undefined ? false : ++polls > o.upAfter),
    served: async () => undefined,
    unitActive: async () => calls.includes("start swift-flash-next"),
    systemctl: async (...a) => (calls.push(a[0] + " " + a[1].replace(/^freetoken@|\.service$/g, "")), 0),
    freeRouter: async () => (calls.push("freeRouter"), []),
    vram: async () => [2500, 600],
    blocker: () => null,
    ...o,
  };
  return { env, calls };
}
const sig = () => new AbortController().signal;

describe("freetokenInstance", () => {
  it("tylko 127.0.0.1:1919 i znany model", () => {
    expect(freetokenInstance("http://127.0.0.1:1919/v1", M)).toBe("swift-flash-next");
    expect(freetokenInstance("http://127.0.0.1:1919/v1", "inny")).toBeNull();
    expect(freetokenInstance("http://127.0.0.1:8080/v1", M)).toBeNull();
    expect(freetokenInstance(undefined, M)).toBeNull();
  });
});

describe("ensureFreeToken", () => {
  it("działający serwer: nic nie uruchamia", async () => {
    const { env, calls } = fakeEnv({ answers: async () => true });
    await ensureFreeToken(M, "swift-flash-next", sig(), () => {}, env);
    expect(calls).toEqual([]);
  });
  it("martwy serwer: zwalnia router, startuje jednostkę, czeka", async () => {
    const { env, calls } = fakeEnv({ upAfter: 1 });
    const msgs: string[] = [];
    await ensureFreeToken(M, "swift-flash-next", sig(), (m) => msgs.push(m), env, 10_000);
    expect(calls).toEqual(["freeRouter", "start swift-flash-next"]);
    expect(msgs.length).toBe(2);
  });
  it("zajęta karta albo sesja pi: błąd bez startu", async () => {
    const a = fakeEnv({ vram: async () => [2500, 30000] });
    await expect(ensureFreeToken(M, "swift-flash-next", sig(), () => {}, a.env)).rejects.toThrow(/GPU1/);
    expect(a.calls).not.toContain("start swift-flash-next");
    const b = fakeEnv({ blocker: () => "sesja pi (pid 1)" });
    await expect(ensureFreeToken(M, "swift-flash-next", sig(), () => {}, b.env)).rejects.toThrow(/sesja pi/);
  });
  it("router, który nie oddaje GPU: błąd", async () => {
    const { env } = fakeEnv({ freeRouter: async () => ["qwen"] });
    await expect(ensureFreeToken(M, "swift-flash-next", sig(), () => {}, env)).rejects.toThrow(/qwen/);
  });
});
