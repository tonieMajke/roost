//! Zmiana rozmiaru okna bez ramki od uchwytów w UI (`ResizeEdges` w `src/TitleBar.tsx`).

type Rect = { x: number; y: number; width: number; height: number };

/** Granice po przeciągnięciu krawędzi `edge` o (`dx`, `dy`) od `from`; przeciwległa krawędź stoi. */
export function resizedBounds(from: Rect, edge: string, dx: number, dy: number, [minW, minH]: number[]): Rect {
  let { x, y, width, height } = from;
  if (edge.includes("East")) width = Math.max(minW, from.width + dx);
  if (edge.includes("South")) height = Math.max(minH, from.height + dy);
  if (edge.includes("West")) {
    width = Math.max(minW, from.width - dx);
    x = from.x + from.width - width;
  }
  if (edge.includes("North")) {
    height = Math.max(minH, from.height - dy);
    y = from.y + from.height - height;
  }
  return { x: Math.round(x), y: Math.round(y), width: Math.round(width), height: Math.round(height) };
}

/** Chromium wybiera Wayland sam, gdy jest `WAYLAND_DISPLAY`, chyba że wymuszono X11. */
export function usesWayland(env: NodeJS.ProcessEnv, ozone: string): boolean {
  if (ozone) return ozone === "wayland";
  return !!env.WAYLAND_DISPLAY;
}
