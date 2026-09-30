import { describe, expect, it } from "vitest";
import { commandFor, type KeyLike } from "./keys";

const k = (key: string, mods: Partial<KeyLike> = {}): KeyLike => ({
  key,
  ctrlKey: false,
  altKey: false,
  shiftKey: false,
  metaKey: false,
  ...mods,
});
const ca = (key: string) => k(key, { ctrlKey: true, altKey: true });

describe("commandFor (skróty etapu 8)", () => {
  it("Ctrl+Alt+strzałki to ruch po siatce", () => {
    expect(commandFor(ca("ArrowLeft"))).toEqual({ type: "move", dir: "left" });
    expect(commandFor(ca("ArrowRight"))).toEqual({ type: "move", dir: "right" });
    expect(commandFor(ca("ArrowUp"))).toEqual({ type: "move", dir: "up" });
    expect(commandFor(ca("ArrowDown"))).toEqual({ type: "move", dir: "down" });
  });

  it("Ctrl+Alt+Enter, N, W, R, P, B", () => {
    expect(commandFor(ca("Enter"))).toEqual({ type: "toggleMaximize" });
    expect(commandFor(ca("n"))).toEqual({ type: "newPane" });
    expect(commandFor(ca("w"))).toEqual({ type: "closePane" });
    expect(commandFor(ca("r"))).toEqual({ type: "restartPane" });
    expect(commandFor(ca("p"))).toEqual({ type: "newProject" });
    expect(commandFor(ca("b"))).toEqual({ type: "toggleRail" });
  });

  it("Ctrl+Alt+1…9 wybiera projekt (0-based)", () => {
    expect(commandFor(ca("1"))).toEqual({ type: "selectProject", index: 0 });
    expect(commandFor(ca("5"))).toEqual({ type: "selectProject", index: 4 });
    expect(commandFor(ca("9"))).toEqual({ type: "selectProject", index: 8 });
  });

  it("Ctrl+Shift+C / Ctrl+Shift+V to schowek", () => {
    expect(commandFor(k("c", { ctrlKey: true, shiftKey: true }))).toEqual({ type: "copy" });
    expect(commandFor(k("v", { ctrlKey: true, shiftKey: true }))).toEqual({ type: "paste" });
  });

  it("litery bez znaczenia wielkości (CapsLock, układ z Shift)", () => {
    expect(commandFor(ca("N"))).toEqual({ type: "newPane" });
    expect(commandFor(ca("P"))).toEqual({ type: "newProject" });
    expect(commandFor(k("C", { ctrlKey: true, shiftKey: true }))).toEqual({ type: "copy" });
  });

  it("zwykłe Ctrl+C i Ctrl+V zostają dla terminala", () => {
    expect(commandFor(k("c", { ctrlKey: true }))).toBeNull();
    expect(commandFor(k("v", { ctrlKey: true }))).toBeNull();
    expect(commandFor(k("c"))).toBeNull();
    expect(commandFor(k("v"))).toBeNull();
  });

  it("Alt bez Ctrl, Ctrl+Alt+0 i Ctrl+Alt+Shift nic nie robią", () => {
    expect(commandFor(k("n", { altKey: true }))).toBeNull();
    expect(commandFor(k("1", { altKey: true }))).toBeNull();
    expect(commandFor(ca("0"))).toBeNull();
    expect(commandFor(k("n", { ctrlKey: true, altKey: true, shiftKey: true }))).toBeNull();
    expect(commandFor(k("c", { ctrlKey: true, shiftKey: true, altKey: true }))).toBeNull();
  });

  it("Super nie jest używany, inne klawisze przechodzą do terminala", () => {
    expect(commandFor(k("n", { metaKey: true, ctrlKey: true, altKey: true }))).toBeNull();
    expect(commandFor(k("a", { ctrlKey: true, shiftKey: true }))).toBeNull();
    expect(commandFor(k("Enter"))).toBeNull();
    expect(commandFor(k("Escape", { ctrlKey: true, altKey: true }))).toBeNull();
  });
});
