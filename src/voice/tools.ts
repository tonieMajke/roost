// Narzędzia rozmówcy (etap 5, `docs/plan-glos.md`): panele aktywnego projektu i „deploy”.
// Czyste funkcje na udawanym gospodarzu — prawdziwy (`App.tsx`) zna panele i terminale.

import type { ToolSpec } from "../chat";
import type { VoicePane } from "./voice";

/** Zadanie dla nowego panelu (`open_panes`) albo wklejka do istniejącego (`send_to_pane`). */
export type DeployTask = { agent: string; title: string; prompt: string };

/** Karta nad kuleczką: zadania czekają na „Uruchom” / „Popraw” / „Anuluj” (klik albo głos). */
export type DeployCard = { kind: "open" | "send"; tasks: DeployTask[] };

/** `fix`: użytkownik chce zmian; `note` = co powiedział (gdy powiedział coś innego niż „popraw”). */
export type CardDecision = { kind: "run" } | { kind: "cancel" } | { kind: "fix"; note?: string };

export type VoiceHost = {
  /** Panele aktywnego projektu; `null` = nie ma aktywnego projektu. */
  panes(): VoicePane[] | null;
  /** Agenci, których można otworzyć (id z `agents.json`). */
  agents(): { id: string; name: string }[];
  /** Ile paneli da się jeszcze dodać do aktywnego projektu. */
  free(): number;
  confirm(card: DeployCard, signal: AbortSignal): Promise<CardDecision>;
  /** Otwiera panele i wkleja zadania, gdy agent wstanie; zwraca opis wyniku dla modelu. */
  open(tasks: DeployTask[]): Promise<string>;
  /** Wkleja tekst i wysyła Enterem; tekst = błąd. */
  send(paneId: string, text: string): string | null;
  /** Ostatnie linie z ekranu panelu; `null` = nie ma takiego terminala. */
  read(paneId: string, lines: number): string | null;
};

/** Gospodarz od strony okna (`App.tsx`); kartę pokazuje sesja rozmowy. */
export type PaneHost = Omit<VoiceHost, "confirm">;

export type VoiceToolResult = { ok: boolean; text: string };

export const VOICE_MAX_STEPS = 8;
export const READ_LINES = 60;
const READ_LIMIT = 6000;
const PROMPT_LIMIT = 8000;
export const SHORT_ID = 6;

export const shortId = (id: string) => id.slice(0, SHORT_ID);

export function voiceTools(agentIds: string[]): ToolSpec[] {
  const pane = { type: "string", description: "id panelu z list_panes" };
  return [
    {
      name: "list_panes",
      description: "Panele z agentami w aktywnym projekcie: id, agent, tytuł rozmowy, czy pracuje.",
      parameters: { type: "object", properties: {} },
    },
    {
      name: "open_panes",
      description:
        "Otwiera nowe panele z agentami i daje każdemu zadanie. Użytkownik najpierw widzi kartę i ją potwierdza. " +
        "Używaj, gdy użytkownik zatwierdzi plan („OK, deploy”). Zadania mają być niezależne od siebie.",
      parameters: {
        type: "object",
        properties: {
          tasks: {
            type: "array",
            minItems: 1,
            items: {
              type: "object",
              properties: {
                agent: { type: "string", enum: agentIds, description: "który agent" },
                title: { type: "string", description: "krótki tytuł zadania, 2–5 słów" },
                prompt: { type: "string", description: "pełne polecenie dla agenta, zrozumiałe bez tej rozmowy" },
              },
              required: ["agent", "title", "prompt"],
            },
          },
        },
        required: ["tasks"],
      },
    },
    {
      name: "send_to_pane",
      description: "Wysyła wiadomość do agenta w istniejącym panelu (wkleja i naciska Enter). Użytkownik potwierdza kartą.",
      parameters: { type: "object", properties: { id: pane, text: { type: "string" } }, required: ["id", "text"] },
    },
    {
      name: "read_pane",
      description: `Ostatnie około ${READ_LINES} linii z ekranu panelu – żeby sprawdzić, co agent robi albo co odpowiedział.`,
      parameters: { type: "object", properties: { id: pane }, required: ["id"] },
    },
  ];
}

const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");

/** Panel po krótkim (albo pełnym) id. */
function findPane(panes: VoicePane[], id: string): VoicePane | null {
  const want = shortId(id.trim());
  return want ? (panes.find((p) => p.id === want) ?? null) : null;
}

/** Agent po id albo nazwie (model mówi „Claude”, a id to `claude`). */
function findAgent(agents: { id: string; name: string }[], name: string): string | null {
  const n = name.toLowerCase();
  return (agents.find((a) => a.id.toLowerCase() === n) ?? agents.find((a) => a.name.toLowerCase() === n))?.id ?? null;
}

const refused = (d: CardDecision): VoiceToolResult =>
  d.kind === "cancel"
    ? { ok: false, text: "użytkownik odmówił – nic nie zrobiono" }
    : { ok: false, text: `użytkownik chce poprawić${d.kind === "fix" && d.note ? `: „${d.note}”` : " – zapytaj, co zmienić"}. Nic nie zrobiono.` };

export async function runVoiceTool(name: string, args: Record<string, unknown>, host: VoiceHost, signal: AbortSignal): Promise<VoiceToolResult> {
  const panes = host.panes();
  if (panes === null) return { ok: false, text: "nie ma otwartego projektu – użytkownik musi najpierw wybrać albo dodać projekt" };
  switch (name) {
    case "list_panes":
      if (panes.length === 0) return { ok: true, text: "projekt nie ma paneli" };
      return { ok: true, text: panes.map((p) => `${p.id}: ${p.agent}, „${p.title}”, ${p.busy ? "pracuje" : "czeka"}`).join("\n") };

    case "open_panes": {
      const raw = Array.isArray(args.tasks) ? (args.tasks as Record<string, unknown>[]) : [];
      if (raw.length === 0) return { ok: false, text: "`tasks` musi być niepustą listą zadań" };
      const free = host.free();
      if (raw.length > free) return { ok: false, text: `za dużo zadań: można dodać jeszcze ${free} panel(i) w tym projekcie` };
      const agents = host.agents();
      const tasks: DeployTask[] = [];
      for (const [i, t] of raw.entries()) {
        const agent = findAgent(agents, str(t?.agent));
        const title = str(t?.title);
        const prompt = str(t?.prompt);
        if (!agent) return { ok: false, text: `zadanie ${i + 1}: nieznany agent „${str(t?.agent)}” (dostępni: ${agents.map((a) => a.id).join(", ")})` };
        if (!title || !prompt) return { ok: false, text: `zadanie ${i + 1}: brak tytułu albo polecenia` };
        if (prompt.length > PROMPT_LIMIT) return { ok: false, text: `zadanie ${i + 1}: polecenie dłuższe niż ${PROMPT_LIMIT} znaków` };
        tasks.push({ agent, title, prompt });
      }
      const d = await host.confirm({ kind: "open", tasks }, signal);
      if (d.kind !== "run") return refused(d);
      return { ok: true, text: await host.open(tasks) };
    }

    case "send_to_pane": {
      const p = findPane(panes, str(args.id));
      const text = str(args.text);
      if (!p) return { ok: false, text: `nie ma panelu „${str(args.id)}” – sprawdź list_panes` };
      if (!text) return { ok: false, text: "pusta wiadomość" };
      const d = await host.confirm({ kind: "send", tasks: [{ agent: p.agent, title: p.title, prompt: text }] }, signal);
      if (d.kind !== "run") return refused(d);
      const err = host.send(p.id, text);
      return err ? { ok: false, text: err } : { ok: true, text: `wysłano do ${p.id} (${p.agent})` };
    }

    case "read_pane": {
      const p = findPane(panes, str(args.id));
      if (!p) return { ok: false, text: `nie ma panelu „${str(args.id)}” – sprawdź list_panes` };
      const screen = host.read(p.id, READ_LINES);
      if (screen === null) return { ok: false, text: `panel ${p.id} nie ma terminala` };
      const text = screen.length > READ_LIMIT ? `…${screen.slice(-READ_LIMIT)}` : screen;
      return { ok: true, text: text.trim() ? text : "(ekran pusty)" };
    }
  }
  return { ok: false, text: `nieznane narzędzie „${name}”` };
}

/** Jedna linia do zapisu rozmowy: co rozmówca zrobił. */
export function voiceToolLabel(name: string, args: Record<string, unknown>): string {
  switch (name) {
    case "list_panes":
      return "sprawdza panele";
    case "open_panes": {
      const n = Array.isArray(args.tasks) ? args.tasks.length : 0;
      return `otwiera ${n} panel(e)`;
    }
    case "send_to_pane":
      return `pisze do panelu ${str(args.id)}`;
    case "read_pane":
      return `czyta panel ${str(args.id)}`;
  }
  return name;
}

const YES = /^(tak|ok|okej|okay|dobra|dobrze|jasne|zgoda|uruchom|uruchamiaj|odpal|odpalaj|dawaj|start|startuj|deploy|potwierdzam|wysyłaj|wyślij|leć|lecimy|jedziemy|zaczynaj)$/;
const NO = /^(nie|anuluj|odwołaj|stop|stój|zostaw|rezygnuję|nieważne)$/;
const FIX = /^(popraw|zmień|poczekaj|czekaj|moment|chwila)$/;

/** Odpowiedź głosem na widoczną kartę: krótkie „tak” / „nie” / „popraw”. Cokolwiek innego to
 *  poprawka z treścią (użytkownik mówi, co zmienić). Pusty transkrypt = brak decyzji. */
export function cardAnswer(text: string): CardDecision | null {
  const words = text
    .toLowerCase()
    .replace(/[^\p{L}\s]/gu, " ")
    .split(/\s+/)
    .filter(Boolean);
  if (words.length === 0) return null;
  if (words.length <= 4) {
    const first = words[0];
    if (NO.test(first)) return { kind: "cancel" };
    if (FIX.test(first)) return words.length === 1 ? { kind: "fix" } : { kind: "fix", note: text.trim() };
    if (words.every((w) => YES.test(w) || w === "to" || w === "no" || w === "go" || w === "puść")) return { kind: "run" };
  }
  return { kind: "fix", note: text.trim() };
}
