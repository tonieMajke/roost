import { describe, expect, it } from "vitest";
import { resizedBounds, usesWayland } from "./window";

const from = { x: 100, y: 50, width: 800, height: 600 };
const min = [640, 400];

describe("resizedBounds", () => {
  it("prawo i dół zmieniają tylko rozmiar", () => {
    expect(resizedBounds(from, "SouthEast", 30, -20, min)).toEqual({ x: 100, y: 50, width: 830, height: 580 });
  });

  it("lewo i góra przesuwają okno, prawy dolny róg stoi", () => {
    expect(resizedBounds(from, "NorthWest", -10, 40, min)).toEqual({ x: 90, y: 90, width: 810, height: 560 });
  });

  it("nie schodzi poniżej minimum i wtedy nie przesuwa okna dalej", () => {
    expect(resizedBounds(from, "West", 500, 0, min)).toEqual({ x: 260, y: 50, width: 640, height: 600 });
    expect(resizedBounds(from, "South", 0, -999, min).height).toBe(400);
  });
});

describe("usesWayland", () => {
  it("wymuszony przełącznik wygrywa ze środowiskiem", () => {
    expect(usesWayland({ WAYLAND_DISPLAY: "wayland-0" }, "x11")).toBe(false);
    expect(usesWayland({}, "wayland")).toBe(true);
  });

  it("bez przełącznika decyduje WAYLAND_DISPLAY", () => {
    expect(usesWayland({ WAYLAND_DISPLAY: "wayland-0", DISPLAY: ":1" }, "")).toBe(true);
    expect(usesWayland({ DISPLAY: ":1" }, "")).toBe(false);
  });
});
