import { useEffect, useState } from "react";
import { Copy, Minus, Square, X } from "lucide-react";
import type { WindowControls } from "./backend";
import { IconButton } from "./IconButton";

/** Pasek tytułu w UI (okno bez dekoracji systemowych): przeciąganie, min/max/zamknij. */
export function TitleBar({
  win,
  title,
  onMaximized,
}: {
  win: WindowControls;
  title: string;
  onMaximized: (max: boolean) => void;
}) {
  const [maximized, setMaximized] = useState(false);

  // Tytuł okna systemu: pasek zadań i Alt+Tab pokazują temat rozmowy w fokusie.
  useEffect(() => {
    win.setTitle(title);
  }, [win, title]);

  useEffect(() => {
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
      off();
    };
  }, [win, onMaximized]);

  return (
    <div className="titlebar" data-tauri-drag-region onDoubleClick={() => win.toggleMaximize()}>
      <span className="titlebar-mark" aria-hidden />
      <span className="titlebar-title" data-tauri-drag-region title={title}>
        {title}
      </span>
      <div className="titlebar-btns" onDoubleClick={(e) => e.stopPropagation()}>
        <IconButton icon={Minus} label="Minimalizuj" onClick={() => win.minimize()} />
        <IconButton
          icon={maximized ? Copy : Square}
          label={maximized ? "Przywróć" : "Maksymalizuj"}
          onClick={() => win.toggleMaximize()}
        />
        <IconButton icon={X} label="Zamknij" className="titlebar-close" onClick={() => win.close()} />
      </div>
    </div>
  );
}

/** Uchwyty zmiany rozmiaru przy krawędziach okna bez ramki: Tauri łapie tylko 5 px, a róg
 *  to 5×5 px – za mało. Tu krawędzie 10 px (góra 6), rogi dolne 24 px (górne 12: przyciski paska). */
export function ResizeEdges({ win }: { win: WindowControls }) {
  return (
    <>
      {win.edges.map((edge) => (
        <div
          key={edge}
          className={`resize-edge re-${edge.toLowerCase()}`}
          aria-hidden
          onPointerDown={(e) => {
            if (e.button !== 0) return;
            e.preventDefault();
            win.startResize(edge, e.nativeEvent);
          }}
        />
      ))}
    </>
  );
}
