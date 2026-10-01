import { describe, expect, it } from "vitest";
import { allowNavigation, buildCsp, shouldApplyCsp } from "./security";

describe("buildCsp", () => {
  const csp = buildCsp();
  it("blokuje sieć i obce źródła", () => {
    expect(csp).toContain("default-src 'none'");
    expect(csp).toContain("connect-src 'none'");
    expect(csp).not.toMatch(/https?:/);
    expect(csp).not.toContain("'unsafe-eval'");
    expect(csp).not.toMatch(/script-src[^;]*'unsafe-inline'/);
  });
  it("pozwala na wasm shiki, awatary i fonty", () => {
    expect(csp).toMatch(/script-src[^;]*'wasm-unsafe-eval'/);
    expect(csp).toMatch(/img-src[^;]*data:/);
    expect(csp).toMatch(/font-src[^;]*'self'/);
  });
});

describe("shouldApplyCsp", () => {
  it("tylko file://", () => {
    expect(shouldApplyCsp("file:///a/dist-web/index.html")).toBe(true);
    expect(shouldApplyCsp("http://localhost:5173/")).toBe(false);
  });
});

describe("allowNavigation", () => {
  const file = "file:///app/dist-web/index.html";
  it("bez dev: tylko ta sama strona", () => {
    expect(allowNavigation("file:///app/dist-web/index.html#x", { file })).toBe(true);
    expect(allowNavigation("file:///etc/passwd", { file })).toBe(false);
    expect(allowNavigation("https://evil.example/", { file })).toBe(false);
    expect(allowNavigation("nonsens", { file })).toBe(false);
  });
  it("z dev: tylko ten origin", () => {
    const a = { dev: "http://localhost:5173/", file };
    expect(allowNavigation("http://localhost:5173/x", a)).toBe(true);
    expect(allowNavigation("http://localhost:5174/", a)).toBe(false);
    expect(allowNavigation("file:///app/dist-web/index.html", a)).toBe(false);
  });
});
