import { describe, expect, it } from "vitest";
import { searchAction } from "./term-search";

const k = (key: string, mods: Partial<Record<"ctrlKey" | "altKey" | "shiftKey" | "metaKey", boolean>> = {}) => ({
  key, ctrlKey: false, altKey: false, shiftKey: false, metaKey: false, ...mods,
});

describe("searchAction", () => {
  it("Ctrl+F otwiera pole, także gdy już otwarte", () => {
    expect(searchAction(k("f", { ctrlKey: true }), false)).toBe("open");
    expect(searchAction(k("F", { ctrlKey: true }), true)).toBe("open");
  });
  it("Ctrl+G / Ctrl+Shift+G tylko przy otwartym polu", () => {
    expect(searchAction(k("g", { ctrlKey: true }), false)).toBeNull();
    expect(searchAction(k("g", { ctrlKey: true }), true)).toBe("next");
    expect(searchAction(k("G", { ctrlKey: true, shiftKey: true }), true)).toBe("prev");
  });
  it("Enter, Shift+Enter i Esc tylko przy otwartym polu", () => {
    expect(searchAction(k("Enter"), false)).toBeNull();
    expect(searchAction(k("Escape"), false)).toBeNull();
    expect(searchAction(k("Enter"), true)).toBe("next");
    expect(searchAction(k("Enter", { shiftKey: true }), true)).toBe("prev");
    expect(searchAction(k("Escape"), true)).toBe("close");
  });
  it("nie przechwytuje cudzych skrótów", () => {
    expect(searchAction(k("f", { ctrlKey: true, altKey: true }), true)).toBeNull();
    expect(searchAction(k("f", { ctrlKey: true, shiftKey: true }), true)).toBeNull();
    expect(searchAction(k("f", { metaKey: true }), true)).toBeNull();
    expect(searchAction(k("a"), true)).toBeNull();
  });
});
