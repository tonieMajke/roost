import { describe, expect, it } from "vitest";
import { TOAST_MS, toastText } from "./toast";

describe("toastText", () => {
  it("składa części w jedno zdanie", () => {
    expect(toastText("a", "b")).toBe("a · b");
  });

  it("puste i null wypadają", () => {
    expect(toastText(null, "  ", "Brak agentów: codex")).toBe("Brak agentów: codex");
    expect(toastText()).toBe("");
  });
});

describe("TOAST_MS", () => {
  it("komunikat wisi 4 s (plan M2, etap 5)", () => {
    expect(TOAST_MS).toBe(4000);
  });
});
