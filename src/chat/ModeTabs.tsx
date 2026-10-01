import { useT, type Key } from "../i18n";
import { Bot, MessagesSquare, SquareTerminal } from "lucide-react";

export type Mode = "code" | "chat" | "bot";

const TABS: { mode: Mode; label: Key; title: Key; icon: typeof Bot }[] = [
  { mode: "code", label: "chat.tab.code", title: "chat.tab.code.title", icon: SquareTerminal },
  { mode: "chat", label: "chat.tab.chat", title: "chat.tab.chat.title", icon: MessagesSquare },
  { mode: "bot", label: "chat.tab.bot", title: "chat.tab.bot.title", icon: Bot },
];

/** Przełącznik zakładek na górze lewej kolumny (szyna projektów / lista rozmów / boty). */
export function ModeTabs({ mode, onMode }: { mode: Mode; onMode(m: Mode): void }) {
  const { t: tr } = useT();
  return (
    <div className="mode-tabs" role="tablist" aria-label={tr("chat.tab.aria")}>
      {TABS.map((t) => (
        <button key={t.mode} type="button" role="tab" aria-selected={mode === t.mode} className={mode === t.mode ? "is-on" : ""} title={tr(t.title)} onClick={() => onMode(t.mode)}>
          <t.icon aria-hidden />
          <span>{tr(t.label)}</span>
        </button>
      ))}
    </div>
  );
}
