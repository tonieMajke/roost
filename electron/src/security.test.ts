import { describe, expect, it } from "vitest";
import { allowNavigation, buildCsp, isTrustedSender, allowPermission, PickedFiles, shouldApplyCsp, validateArgs, validateSpawnSpec } from "./security";

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

describe("isTrustedSender", () => {
  const file = "file:///app/dist-web/index.html";
  it("brak ramki albo obcy adres: nie", () => {
    expect(isTrustedSender(undefined, { file })).toBe(false);
    expect(isTrustedSender("", { file })).toBe(false);
    expect(isTrustedSender("https://evil.example/", { file })).toBe(false);
    expect(isTrustedSender("file:///tmp/x.html", { file })).toBe(false);
    expect(isTrustedSender("about:blank", { file })).toBe(false);
  });
  it("nasza strona: tak", () => {
    expect(isTrustedSender("file:///app/dist-web/index.html#/x", { file })).toBe(true);
  });
  it("dev: ten sam origin, nie plik", () => {
    const appUrl = { dev: "http://localhost:5173/", file };
    expect(isTrustedSender("http://localhost:5173/", appUrl)).toBe(true);
    expect(isTrustedSender("http://localhost:5174/", appUrl)).toBe(false);
    expect(isTrustedSender(file, appUrl)).toBe(false);
  });
});

describe("validateArgs", () => {
  it("przepuszcza poprawne i opcjonalne", () => {
    expect(() => validateArgs("x", ["a", 1, undefined], ["str", "int", "path?"])).not.toThrow();
    expect(() => validateArgs("x", ["a", ["b"]], ["path", "paths"])).not.toThrow();
  });
  it("odrzuca zły typ, nul w ścieżce, za dużo i brak", () => {
    expect(() => validateArgs("x", [1], ["str"])).toThrow(/argument 1/);
    expect(() => validateArgs("x", ["a\0b"], ["path"])).toThrow(/bajtu zerowego/);
    expect(() => validateArgs("x", [["a", 2]], ["strs"])).toThrow();
    expect(() => validateArgs("x", [1.5], ["int"])).toThrow();
    expect(() => validateArgs("x", [], ["str"])).toThrow(/podany/);
    expect(() => validateArgs("x", ["a", "b"], ["str"])).toThrow(/za dużo/);
    expect(() => validateArgs("x", [[]], ["obj"])).toThrow();
    expect(() => validateArgs("x", ["a".repeat(5000)], ["path"])).toThrow();
  });
});

describe("validateSpawnSpec", () => {
  const ok = { command: "claude", args: ["-p"], cwd: "/tmp", cols: 80, rows: 24, env: [["A", "b"]] };
  it("poprawny", () => expect(() => validateSpawnSpec(ok)).not.toThrow());
  it("zły", () => {
    for (const bad of [null, "x", { ...ok, command: 1 }, { ...ok, args: [1] }, { ...ok, cols: "8" }, { ...ok, env: [["A"]] }, { ...ok, cwd: "a\0" }, { ...ok, command: "" }]) {
      expect(() => validateSpawnSpec(bad)).toThrow();
    }
  });
});

describe("PickedFiles", () => {
  it("jednorazowo", () => {
    const p = new PickedFiles();
    p.add("/a.png");
    expect(p.take("/b.png")).toBe(false);
    expect(p.take("/a.png")).toBe(true);
    expect(p.take("/a.png")).toBe(false);
  });
});

describe("allowPermission", () => {
  const app = { file: "file:///opt/roost/dist-web/index.html" };
  const dev = { dev: "http://localhost:5183", file: app.file };
  it("mikrofon tylko dla audio i tylko dla naszej strony", () => {
    expect(allowPermission("media", app.file, app, ["audio"])).toBe(true);
    expect(allowPermission("media", app.file, app, ["audio", "video"])).toBe(false);
    expect(allowPermission("media", app.file, app, ["video"])).toBe(false);
    expect(allowPermission("media", app.file, app, [])).toBe(false);
    expect(allowPermission("media", "https://evil.example/", app, ["audio"])).toBe(false);
    expect(allowPermission("media", "http://localhost:5183/", dev, ["audio"])).toBe(true);
    expect(allowPermission("media", undefined, app, ["audio"])).toBe(false);
  });
  it("schowek: tylko zapis; reszta odmowa", () => {
    expect(allowPermission("clipboard-sanitized-write", app.file, app)).toBe(true);
    for (const p of ["clipboard-read", "notifications", "geolocation", "fullscreen", "midi", "openExternal", "display-capture"]) {
      expect(allowPermission(p, app.file, app)).toBe(false);
    }
    expect(allowPermission("clipboard-sanitized-write", "https://evil.example/", app)).toBe(false);
  });
});
