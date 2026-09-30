import { describe, expect, it } from "vitest";
import { dialogKey, tileDelayMs } from "./new-pane";

describe("tileDelayMs (wjazd kafelków)", () => {
  it("startuje od 80 ms i dokłada 55 ms na kafelek", () => {
    expect(tileDelayMs(0)).toBe(80);
    expect(tileDelayMs(1)).toBe(135);
    expect(tileDelayMs(3)).toBe(245);
  });
});

describe("dialogKey (okno „Nowy panel”)", () => {
  it("cyfra 1–9 wybiera agenta od razu", () => {
    expect(dialogKey("1", 0, 3)).toEqual({ type: "pick", index: 0 });
    expect(dialogKey("3", 0, 3)).toEqual({ type: "pick", index: 2 });
  });

  it("cyfra ponad liczbę agentów i inne znaki nic nie robią", () => {
    expect(dialogKey("4", 0, 3)).toBeNull();
    expect(dialogKey("9", 1, 2)).toBeNull();
    expect(dialogKey("a", 0, 3)).toBeNull();
    expect(dialogKey("Enter", 0, 0)).toBeNull();
  });

  it("strzałki przesuwają zaznaczenie i zatrzymują się na brzegach", () => {
    expect(dialogKey("ArrowDown", 0, 3)).toEqual({ type: "move", index: 1 });
    expect(dialogKey("ArrowDown", 2, 3)).toEqual({ type: "move", index: 2 });
    expect(dialogKey("ArrowUp", 1, 3)).toEqual({ type: "move", index: 0 });
    expect(dialogKey("ArrowUp", 0, 3)).toEqual({ type: "move", index: 0 });
  });

  it("Enter zatwierdza zaznaczonego, Esc zamyka", () => {
    expect(dialogKey("Enter", 1, 3)).toEqual({ type: "pick", index: 1 });
    expect(dialogKey("Escape", 1, 3)).toEqual({ type: "close" });
    expect(dialogKey("Escape", 0, 0)).toEqual({ type: "close" });
  });

  it("zaznaczenie poza listą (agentów ubyło) jest sprowadzane na koniec", () => {
    expect(dialogKey("Enter", 7, 3)).toEqual({ type: "pick", index: 2 });
    expect(dialogKey("ArrowUp", 7, 3)).toEqual({ type: "move", index: 1 });
  });
});
