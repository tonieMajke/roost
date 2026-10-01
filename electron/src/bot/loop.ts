//! Pętla narzędzi dla dostawców HTTP (`openai`, `anthropic`): model → wywołania → wyniki →
//! model, najwyżej `MAX_STEPS` razy na wiadomość. Claude i codex mają własną pętlę i dostają
//! te same narzędzia przez MCP (`bridge.ts`).

import { t } from "../i18n";
import type { ChatEvent, ChatRequest, ToolCall, ToolSpec, Turn } from "../../../src/chat";
import { clipResult } from "../../../src/bot";
import type { ToolOutcome } from "./tools";

export const MAX_STEPS = 25;

/** Jedno wywołanie modelu (`streamOpenAI` / `streamAnthropic` z kluczem): zwraca wywołania narzędzi. */
export type Step = (req: ChatRequest, signal: AbortSignal, emit: (e: ChatEvent) => void) => Promise<ToolCall[]>;
/** Wykonanie narzędzia (`runTool` z kontekstem bota i rozmowy, razem z pytaniem o zgodę). */
export type RunTool = (name: string, args: Record<string, unknown>) => Promise<ToolOutcome>;

/** Wywołanie narzędzia ze zdarzeniami `tool_call` / `tool_result` (pętla HTTP i serwer MCP). */
export async function reportedCall(c: ToolCall, run: RunTool, emit: (e: ChatEvent) => void): Promise<ToolOutcome> {
  emit({ type: "tool_call", id: c.id, name: c.name, args: c.args });
  const out: ToolOutcome =
    c.bad !== undefined
      ? { ok: false, text: `argumenty nie są poprawnym obiektem JSON: ${c.bad.slice(0, 200)}`, approval: "auto" }
      : await run(c.name, c.args);
  emit({ type: "tool_result", id: c.id, text: clipResult(out.text), error: !out.ok, approval: out.approval });
  return out;
}

/** Kody, którymi serwer odrzuca samo `tools` (np. llama-server bez `--jinja`); 401/404/429 to co innego. */
const REJECTS_TOOLS = new Set([400, 422, 500, 501]);
/** Szablon wywołania wypisany jako tekst: serwer nie rozpoznał narzędzi w odpowiedzi modelu. */
const LEAKED_CALL = /<tool_call>|<function=|<\|tool_call/;

/** Jedna odpowiedź bota. `req.turns` = historia z ostatnim pytaniem (`botTurns`), `tools` = puste,
 *  gdy rozmowa ma `toolsUnsupported`. Zdarzenia jak w Czacie plus `tool_call` / `tool_result`
 *  i `tools_unsupported`; zapis rozmowy robi właściciel (`applyBotEvent`). Stop = `signal`. */
export async function runBotTurn(
  req: ChatRequest,
  tools: ToolSpec[],
  step: Step,
  run: RunTool,
  signal: AbortSignal,
  emit: (e: ChatEvent) => void,
): Promise<void> {
  const turns: Turn[] = [...(req.turns ?? req.messages)];
  let specs: ToolSpec[] | undefined = tools.length ? tools : undefined;
  let toolsWorked = false; // po pierwszym udanym kroku z narzędziami błąd HTTP nie znaczy „brak obsługi”
  let wrote = false;
  const unsupported = () => {
    specs = undefined;
    emit({ type: "tools_unsupported" });
  };

  for (let i = 0; i < MAX_STEPS; i++) {
    let text = "";
    const stepEmit = (e: ChatEvent) => {
      if (e.type === "text") {
        if (text === "" && wrote) emit({ type: "text", text: "\n\n" }); // tekst kolejnego kroku od nowego akapitu
        text += e.text;
        wrote = true;
      }
      emit(e);
    };
    let calls: ToolCall[];
    try {
      calls = await step({ ...req, turns, tools: specs }, signal, stepEmit);
    } catch (e) {
      const status = (e as { status?: number }).status;
      if (!specs || toolsWorked || signal.aborted || status === undefined || !REJECTS_TOOLS.has(status)) throw e;
      try {
        calls = await step({ ...req, turns, tools: undefined }, signal, stepEmit);
      } catch {
        throw e; // bez narzędzi też nie działa: pokaż pierwotny błąd
      }
      unsupported();
    }
    if (calls.length === 0) {
      if (specs && LEAKED_CALL.test(text)) unsupported();
      return;
    }
    toolsWorked = true;
    turns.push({ role: "assistant", content: text, calls });
    for (const c of calls) {
      const out = await reportedCall(c, run, emit);
      turns.push({ role: "tool", id: c.id, content: out.text, ...(out.ok ? {} : { error: true }) });
      if (signal.aborted) return;
    }
  }
  emit({ type: "text", text: t("loop.maxSteps", { n: MAX_STEPS }) });
}
