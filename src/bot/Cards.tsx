import { useEffect, useRef, useState } from "react";
import {
  BookOpen,
  Brain,
  Check,
  ChevronRight,
  FilePen,
  FileText,
  FolderOpen,
  Globe,
  LoaderCircle,
  MessageSquare,
  Search,
  ShieldAlert,
  SquareTerminal,
  Wand2,
  X,
  type LucideIcon,
} from "lucide-react";
import { BotPreviewCard } from "./BotPreview";
import { TOOL_GROUP, type ApprovalDecision, type ApprovalRequest, type ToolCallRecord, type ToolName, toolLabel } from "../bot";

const ICONS: Partial<Record<ToolName, LucideIcon>> = {
  read_file: FileText,
  list_dir: FolderOpen,
  grep: Search,
  write_file: FilePen,
  edit_file: FilePen,
  bash: SquareTerminal,
  web_search: Globe,
  web_fetch: Globe,
  memory: Brain,
  history_search: Brain,
  skill_view: BookOpen,
  skill_create: BookOpen,
  skill_patch: BookOpen,
  bot_create: Wand2,
  bot_update: Wand2,
};

/** Tekst z fragmentami w backtickach jako kod (etykiety z `toolLabel`, tytuły zgód). */
export function Ticks({ text }: { text: string }) {
  return (
    <>
      {text.split(/(`[^`]+`)/).map((part, i) =>
        part.startsWith("`") && part.endsWith("`") && part.length > 1 ? <code key={i}>{part.slice(1, -1)}</code> : <span key={i}>{part}</span>,
      )}
    </>
  );
}

const APPROVAL_TEXT: Record<ApprovalDecision, string> = { once: "zezwolono raz", chat: "zezwolono w rozmowie", deny: "odmowa" };

/** Wywołanie narzędzia: zwinięte jednym wierszem, rozwinięte z argumentami i wynikiem.
 *  `talk`: bot utworzony przez Kreatora – przycisk pod kartą przełącza na niego. */
export function ToolCard({ call, live, talk }: { call: ToolCallRecord; live: boolean; talk?: { name: string; onClick(): void } }) {
  const [open, setOpen] = useState(false);
  const Icon = ICONS[call.name as ToolName] ?? Wand2;
  const running = call.result === undefined && call.error === undefined;
  const state = running ? (live ? "is-running" : "is-stopped") : call.error !== undefined ? "is-error" : "is-ok";
  const denied = call.approval === "deny";
  return (
    <div className={`bot-tool ${state}${open ? " is-open" : ""}`}>
      <button type="button" className="bot-tool-head" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
        <Icon className="bot-tool-icon" aria-hidden />
        <span className="bot-tool-label">
          <Ticks text={toolLabel(call.name, call.args)} />
        </span>
        {call.approval && call.approval !== "auto" && <span className={`bot-tool-approval${denied ? " is-deny" : ""}`}>{APPROVAL_TEXT[call.approval]}</span>}
        <span className="bot-tool-state" aria-hidden>
          {running ? live ? <LoaderCircle className="spin" /> : null : call.error !== undefined ? <X /> : <Check />}
        </span>
        <ChevronRight className="bot-tool-chev" aria-hidden />
      </button>
      {open && (
        <div className="bot-tool-body">
          <div className="bot-tool-part">
            <div className="bot-tool-caption">{call.name}</div>
            <pre>{JSON.stringify(call.args, null, 2)}</pre>
          </div>
          <div className="bot-tool-part">
            <div className="bot-tool-caption">{call.error !== undefined ? "Błąd" : "Wynik"}</div>
            <pre className={call.error !== undefined ? "is-error" : ""}>{call.error ?? call.result ?? (live ? "…" : "przerwane")}</pre>
          </div>
        </div>
      )}
      {talk && (
        <div className="bot-tool-foot">
          <button type="button" className="bot-btn is-primary" onClick={talk.onClick}>
            <MessageSquare aria-hidden />
            Porozmawiaj z {talk.name}
          </button>
        </div>
      )}
    </div>
  );
}

/** Szczegóły zgody: zmiana pliku (`- ` / `+ `) w kolorach diffu, reszta jak jest. */
function Detail({ tool, text }: { tool: string; text: string }) {
  if (tool !== "edit_file") return <pre className="bot-approval-detail">{text}</pre>;
  return (
    <pre className="bot-approval-detail">
      {text.split("\n").map((l, i) => (
        <span key={i} className={l.startsWith("+ ") ? "is-add" : l.startsWith("- ") ? "is-del" : ""}>
          {l}
          {"\n"}
        </span>
      ))}
    </pre>
  );
}

/** Prośba o zgodę: Enter = „Zezwól raz”, Esc = „Odrzuć” (poza polem z wpisanym tekstem). */
export function ApprovalCard({ req, botName, active, onDecide }: { req: ApprovalRequest; botName: string; active: boolean; onDecide(d: ApprovalDecision): void }) {
  const decide = useRef(onDecide);
  decide.current = onDecide;
  useEffect(() => {
    if (!active) return;
    const key = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.isComposing) return;
      const t = e.target as HTMLElement | null;
      const typing = t instanceof HTMLTextAreaElement || t instanceof HTMLInputElement ? t.value.trim() !== "" : false;
      if (typing) return;
      if (e.key === "Enter" && !e.shiftKey && !e.ctrlKey && !e.altKey) {
        e.preventDefault();
        decide.current("once");
      } else if (e.key === "Escape") {
        e.preventDefault();
        decide.current("deny");
      }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [active]);
  const write = TOOL_GROUP[req.tool] === "write" || TOOL_GROUP[req.tool] === "bash";
  return (
    <div className={`bot-approval${write ? " is-write" : ""}`} role="alertdialog" aria-label={`${botName} prosi o zgodę`}>
      <div className="bot-approval-head">
        <ShieldAlert aria-hidden />
        <span className="bot-approval-who">{botName} prosi o zgodę</span>
      </div>
      <div className="bot-approval-title">
        <Ticks text={req.title} />
      </div>
      {req.preview ? <BotPreviewCard preview={req.preview} /> : req.detail && <Detail tool={req.tool} text={req.detail} />}
      <div className="bot-approval-actions">
        <button type="button" className="bot-btn is-primary" onClick={() => onDecide("once")}>
          Zezwól raz <kbd>Enter</kbd>
        </button>
        {req.canGrant && (
          <button type="button" className="bot-btn" onClick={() => onDecide("chat")} title="Nie pytaj więcej o to w tej rozmowie">
            Zezwalaj w tej rozmowie
          </button>
        )}
        <span className="chat-composer-gap" />
        <button type="button" className="bot-btn is-deny" onClick={() => onDecide("deny")}>
          Odrzuć <kbd>Esc</kbd>
        </button>
      </div>
    </div>
  );
}
