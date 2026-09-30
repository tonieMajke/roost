import { useEffect, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { Copy, Minus, Square, X } from "lucide-react";
import { IconButton } from "./IconButton";

/** Pasek tytułu w UI (okno bez dekoracji systemowych): przeciąganie, min/max/zamknij. */
export function TitleBar({ onMaximized }: { onMaximized: (max: boolean) => void }) {
  const [maximized, setMaximized] = useState(false);

  useEffect(() => {
    const win = getCurrentWindow();
    let live = true;
    const sync = () =>
      void win
        .isMaximized()
        .then((m) => {
          if (!live) return;
          setMaximized(m);
          onMaximized(m);
        })
        .catch(() => undefined);
    sync();
    const off = win.onResized(sync);
    return () => {
      live = false;
      void off.then((f) => f());
    };
  }, [onMaximized]);

  const win = getCurrentWindow();
  return (
    <div className="titlebar" data-tauri-drag-region onDoubleClick={() => void win.toggleMaximize()}>
      <span className="titlebar-mark" aria-hidden />
      <span className="titlebar-title" data-tauri-drag-region>
        Agents
      </span>
      <div className="titlebar-btns" onDoubleClick={(e) => e.stopPropagation()}>
        <IconButton icon={Minus} label="Minimalizuj" onClick={() => void win.minimize()} />
        <IconButton
          icon={maximized ? Copy : Square}
          label={maximized ? "Przywróć" : "Maksymalizuj"}
          onClick={() => void win.toggleMaximize()}
        />
        <IconButton icon={X} label="Zamknij" className="titlebar-close" onClick={() => void win.close()} />
      </div>
    </div>
  );
}

type Edge = "North" | "South" | "East" | "West" | "NorthEast" | "NorthWest" | "SouthEast" | "SouthWest";
const EDGES: Edge[] = ["North", "South", "East", "West", "NorthWest", "NorthEast", "SouthWest", "SouthEast"];

/** Uchwyty zmiany rozmiaru przy krawędziach okna bez ramki: Tauri łapie tylko 5 px, a róg
 *  to 5×5 px – za mało. Tu krawędzie 7 px, rogi dolne 18 px (górne mniejsze: przyciski paska). */
export function ResizeEdges() {
  const win = getCurrentWindow();
  return (
    <>
      {EDGES.map((edge) => (
        <div
          key={edge}
          className={`resize-edge re-${edge.toLowerCase()}`}
          aria-hidden
          onPointerDown={(e) => {
            if (e.button !== 0) return;
            e.preventDefault();
            void win.startResizeDragging(edge);
          }}
        />
      ))}
    </>
  );
}
