import { MessagesSquare, SquareTerminal } from "lucide-react";

export type Mode = "code" | "chat";

/** Przełącznik zakładek na górze lewej kolumny (szyna projektów / lista rozmów). */
export function ModeTabs({ mode, onMode }: { mode: Mode; onMode(m: Mode): void }) {
  return (
    <div className="mode-tabs" role="tablist" aria-label="Zakładka">
      <button type="button" role="tab" aria-selected={mode === "code"} className={mode === "code" ? "is-on" : ""} title="Agenci (Ctrl+Alt+C)" onClick={() => onMode("code")}>
        <SquareTerminal aria-hidden />
        <span>Code</span>
      </button>
      <button type="button" role="tab" aria-selected={mode === "chat"} className={mode === "chat" ? "is-on" : ""} title="Czat (Ctrl+Alt+C)" onClick={() => onMode("chat")}>
        <MessagesSquare aria-hidden />
        <span>Czat</span>
      </button>
    </div>
  );
}
