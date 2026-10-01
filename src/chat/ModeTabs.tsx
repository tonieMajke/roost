import { Bot, MessagesSquare, SquareTerminal } from "lucide-react";

export type Mode = "code" | "chat" | "bot";

const TABS: { mode: Mode; label: string; title: string; icon: typeof Bot }[] = [
  { mode: "code", label: "Code", title: "Agenci (Ctrl+Alt+C)", icon: SquareTerminal },
  { mode: "chat", label: "Czat", title: "Czat (Ctrl+Alt+C)", icon: MessagesSquare },
  { mode: "bot", label: "Bot", title: "Boty (Ctrl+Alt+C)", icon: Bot },
];

/** Przełącznik zakładek na górze lewej kolumny (szyna projektów / lista rozmów / boty). */
export function ModeTabs({ mode, onMode }: { mode: Mode; onMode(m: Mode): void }) {
  return (
    <div className="mode-tabs" role="tablist" aria-label="Zakładka">
      {TABS.map((t) => (
        <button key={t.mode} type="button" role="tab" aria-selected={mode === t.mode} className={mode === t.mode ? "is-on" : ""} title={t.title} onClick={() => onMode(t.mode)}>
          <t.icon aria-hidden />
          <span>{t.label}</span>
        </button>
      ))}
    </div>
  );
}
