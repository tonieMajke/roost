// Narzędzia rozmówcy (`docs/plan-glos.md`, etapy 5 i 7): przegląd projektów i paneli, sterowanie
// nimi, „deploy”, presety, boty. Czyste funkcje na udawanym gospodarzu — prawdziwy (`App.tsx`)
// zna panele i terminale. Akcje, które coś uruchamiają, wysyłają albo zamykają, idą przez kartę.

import type { ToolSpec } from "../chat";

/** Panel widziany przez rozmówcę; `id` = krótki prefiks id panelu (`shortId`). */
export type VoicePane = {
  id: string;
  agent: string;
  /** Nazwa konta (Konta agentów); brak = domyślne. */
  account?: string;
  title: string;
  working: boolean;
  /** Skończył pracę, a użytkownik jeszcze nie zajrzał. */
  unread: boolean;
  /** Proces się zakończył: kod wyjścia. */
  exited?: number;
  /** Limit konta wyczerpany (tekst z paska limitu). */
  limit?: string;
  /** Zajętość okna kontekstu w %. */
  ctx?: number;
  /** Od ostatniego wyjścia terminala, ms; brak = nic jeszcze nie wypisał. */
  idleMs?: number;
};

export type VoiceProject = { id: string; name: string; active: boolean; panes: VoicePane[] };

export type VoiceAgent = { id: string; name: string; accounts: string[]; models: string[] };

/** Wiersz karty: nowy panel, wiadomość do panelu albo panel, którego dotyczy akcja. */
export type DeployTask = { agent: string; title: string; prompt: string; account?: string; model?: string };

/** Karta nad kuleczką: czeka na zatwierdzenie (klik albo głos). `action` = napis na przycisku. */
export type DeployCard = { head: string; action: string; tasks: DeployTask[] };

/** `fix`: użytkownik chce zmian; `note` = co powiedział (gdy powiedział coś innego niż „popraw”). */
export type CardDecision = { kind: "run" } | { kind: "cancel" } | { kind: "fix"; note?: string };

export type PaneControl = "stop" | "restart" | "new_conversation" | "close";
export type AppTab = "code" | "chat" | "bot";

export type VoiceHost = {
  projects(): VoiceProject[];
  agents(): VoiceAgent[];
  presets(): { name: string; agents: string[] }[];
  /** Ile paneli da się jeszcze dodać do projektu. */
  free(projectId: string): number;
  confirm(card: DeployCard, signal: AbortSignal): Promise<CardDecision>;
  /** Otwiera panele w projekcie i wkleja zadania, gdy agent wstanie; zwraca opis wyniku dla modelu. */
  open(projectId: string, tasks: DeployTask[]): Promise<string>;
  /** Wkleja tekst i wysyła Enterem; tekst = błąd. */
  send(paneId: string, text: string): string | null;
  /** Ostatnie linie z ekranu panelu; `null` = nie ma takiego terminala. */
  read(paneId: string, lines: number): string | null;
  /** Pokaż: przełącza projekt / zakładkę, ustawia fokus (i powiększa) panel. */
  show(t: { project?: string; pane?: string; tab?: AppTab; maximize?: boolean }): void;
  control(paneId: string, action: PaneControl): string | null;
  /** Cele „Kontynuuj gdzie indziej” dla panelu (etykiety jak w oknie). */
  continueTargets(paneId: string): string[];
  continueTo(paneId: string, target: string): string | null;
  applyPreset(projectId: string, name: string): string | null;
  bots(): Promise<{ id: string; name: string; about: string }[]>;
  /** Pytanie do bota z zakładki Bot (nowa rozmowa, zapisana); zwraca jego odpowiedź. */
  askBot(botId: string, question: string, signal: AbortSignal): Promise<string>;
};

/** Gospodarz od strony okna (`App.tsx`); kartę pokazuje sesja rozmowy. */
export type PaneHost = Omit<VoiceHost, "confirm">;

export type VoiceToolResult = { ok: boolean; text: string };

export const VOICE_MAX_STEPS = 8;
export const READ_LINES = 60;
const READ_LIMIT = 6000;
const PROMPT_LIMIT = 8000;
export const SHORT_ID = 6;
/** Kontekst od tego progu (%) wymaga uwagi: pora na nową rozmowę. */
export const CTX_WARN = 80;

export const shortId = (id: string) => id.slice(0, SHORT_ID);

// ── opis stanu ──────────────────────────────────────────────────────────────

/** Co w panelu wymaga uwagi użytkownika; `null` = nic. */
export function attention(p: VoicePane): string | null {
  if (p.exited !== undefined) return p.exited === 0 ? "proces się zakończył" : `proces padł (kod ${p.exited})`;
  if (p.limit) return `limit konta: ${p.limit}`;
  if (p.unread) return "skończył pracę, użytkownik jeszcze nie zajrzał";
  if (p.ctx !== undefined && p.ctx >= CTX_WARN) return `kontekst ${p.ctx}% – pora na nową rozmowę`;
  return null;
}

const ago = (ms: number) => {
  const min = Math.round(ms / 60_000);
  return min < 1 ? "przed chwilą" : min < 60 ? `${min} min temu` : `${Math.round(min / 60)} h temu`;
};

export function paneLine(p: VoicePane): string {
  const state = p.working ? "pracuje" : p.exited !== undefined ? "nie działa" : "czeka";
  const bits = [
    `${p.id}: ${p.agent}${p.account ? ` (konto ${p.account})` : ""}`,
    p.title ? `„${p.title}”` : "bez tytułu",
    state,
    !p.working && p.idleMs !== undefined ? `ostatnie wyjście ${ago(p.idleMs)}` : "",
    p.ctx !== undefined ? `kontekst ${p.ctx}%` : "",
  ].filter(Boolean);
  const a = attention(p);
  return `${bits.join(", ")}${a ? ` – UWAGA: ${a}` : ""}`;
}

/** Przegląd dla modelu: projekty, panele, co wymaga uwagi. */
export function overviewText(projects: VoiceProject[]): string {
  if (projects.length === 0) return "Nie ma żadnych projektów.";
  const out: string[] = [];
  const need: string[] = [];
  for (const pr of projects) {
    const busy = pr.panes.filter((p) => p.working).length;
    out.push(`Projekt ${pr.id} „${pr.name}”${pr.active ? " (aktywny)" : ""}: ${pr.panes.length} panel(i), pracuje ${busy}`);
    for (const p of pr.panes) {
      out.push(`  - ${paneLine(p)}`);
      const a = attention(p);
      if (a) need.push(`${p.agent} „${p.title || p.id}” w „${pr.name}”: ${a}`);
    }
  }
  out.push(need.length ? `Wymaga uwagi:\n${need.map((n) => `- ${n}`).join("\n")}` : "Nic nie wymaga uwagi.");
  return out.join("\n");
}

// ── schematy narzędzi ───────────────────────────────────────────────────────

export function voiceTools(agentIds: string[]): ToolSpec[] {
  const pane = { type: "string", description: "id panelu z overview" };
  const project = { type: "string", description: "id albo nazwa projektu z overview; brak = aktywny" };
  const obj = (properties: Record<string, unknown>, required: string[] = []) => ({ type: "object", properties, required });
  return [
    {
      name: "overview",
      description:
        "Wszystkie projekty i panele: agent, konto, tytuł rozmowy, czy pracuje, od kiedy cisza, kontekst %, oraz co wymaga uwagi " +
        "(skończył i czeka, proces padł, limit konta, pełny kontekst). Wołaj, gdy użytkownik pyta o postępy albo stan.",
      parameters: obj({}),
    },
    {
      name: "read_pane",
      description: `Ostatnie około ${READ_LINES} linii z ekranu panelu (z dowolnego projektu) – co agent robi albo co odpowiedział.`,
      parameters: obj({ id: pane }, ["id"]),
    },
    {
      name: "show",
      description:
        "Pokazuje użytkownikowi: przełącza projekt albo zakładkę aplikacji (code = terminale, chat = Czat, bot = Boty), " +
        "ustawia panel na wierzchu (opcjonalnie powiększony). Bez potwierdzenia.",
      parameters: obj({ project, pane, tab: { type: "string", enum: ["code", "chat", "bot"] }, maximize: { type: "boolean" } }),
    },
    {
      name: "open_panes",
      description:
        "Otwiera nowe panele z agentami i daje każdemu zadanie. Użytkownik najpierw widzi kartę i ją potwierdza. " +
        "Używaj, gdy użytkownik zatwierdzi plan („OK, deploy”). Zadania mają być niezależne od siebie. " +
        "Konto i model podawaj tylko, gdy użytkownik o nie prosi (listę daje list_agents).",
      parameters: obj(
        {
          project,
          tasks: {
            type: "array",
            minItems: 1,
            items: obj(
              {
                agent: { type: "string", enum: agentIds, description: "który agent" },
                title: { type: "string", description: "krótki tytuł zadania, 2–5 słów" },
                prompt: { type: "string", description: "pełne polecenie dla agenta, zrozumiałe bez tej rozmowy" },
                account: { type: "string", description: "nazwa konta agenta (opcjonalnie)" },
                model: { type: "string", description: "id albo nazwa modelu (opcjonalnie)" },
              },
              ["agent", "title", "prompt"],
            ),
          },
        },
        ["tasks"],
      ),
    },
    {
      name: "list_agents",
      description: "Agenci do nowych paneli z ich kontami i modelami oraz zapisane presety układów.",
      parameters: obj({}),
    },
    {
      name: "send_to_pane",
      description: "Wysyła wiadomość do agenta w istniejącym panelu (wkleja i naciska Enter). Użytkownik potwierdza kartą.",
      parameters: obj({ id: pane, text: { type: "string" } }, ["id", "text"]),
    },
    {
      name: "pane_control",
      description:
        "Panel: stop = przerwij agenta (Esc), restart = uruchom proces od nowa (rozmowa wznowiona), " +
        "new_conversation = nowa rozmowa w tym panelu, close = zamknij panel. Użytkownik potwierdza kartą.",
      parameters: obj({ id: pane, action: { type: "string", enum: ["stop", "restart", "new_conversation", "close"] } }, ["id", "action"]),
    },
    {
      name: "continue_elsewhere",
      description:
        "„Kontynuuj gdzie indziej”: nowy panel na innym koncie albo u innego agenta dostaje streszczenie rozmowy z tego panelu " +
        "(np. gdy skończył się limit). Bez `target` zwraca listę celów. Użytkownik potwierdza kartą.",
      parameters: obj({ id: pane, target: { type: "string", description: "etykieta celu z listy" } }, ["id"]),
    },
    {
      name: "apply_preset",
      description: "Dodaje do projektu panele z zapisanego presetu układu. Użytkownik potwierdza kartą.",
      parameters: obj({ name: { type: "string" }, project }, ["name"]),
    },
    {
      name: "ask_bot",
      description:
        "Zadaje pytanie botowi z zakładki Bot (każdy bot ma swój charakter, pamięć i narzędzia) i zwraca jego odpowiedź. " +
        "Bez `bot` zwraca listę botów. Rozmowa zostaje w zakładce Bot.",
      parameters: obj({ bot: { type: "string", description: "imię albo id bota" }, question: { type: "string" } }),
    },
  ];
}

// ── wykonanie ───────────────────────────────────────────────────────────────

const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");
const norm = (s: string) => s.trim().toLowerCase();

/** Projekt po id, nazwie albo jej początku; pusty = aktywny. */
function findProject(projects: VoiceProject[], q: string): VoiceProject | null {
  if (!q) return projects.find((p) => p.active) ?? null;
  const n = norm(q);
  return (
    projects.find((p) => p.id === shortId(q.trim())) ??
    projects.find((p) => norm(p.name) === n) ??
    projects.find((p) => norm(p.name).startsWith(n)) ??
    null
  );
}

function findPane(projects: VoiceProject[], id: string): { pane: VoicePane; project: VoiceProject } | null {
  const want = shortId(id.trim());
  if (!want) return null;
  for (const project of projects) {
    const pane = project.panes.find((p) => p.id === want);
    if (pane) return { pane, project };
  }
  return null;
}

/** Element listy po nazwie, jej początku albo fragmencie („opus” → `claude-opus-5-5`). */
function pick(list: string[], q: string): string | null {
  const n = norm(q);
  if (!n) return null;
  return list.find((x) => norm(x) === n) ?? list.find((x) => norm(x).startsWith(n)) ?? list.find((x) => norm(x).includes(n)) ?? null;
}

const refused = (d: CardDecision): VoiceToolResult =>
  d.kind === "cancel"
    ? { ok: false, text: "użytkownik odmówił – nic nie zrobiono" }
    : { ok: false, text: `użytkownik chce poprawić${d.kind === "fix" && d.note ? `: „${d.note}”` : " – zapytaj, co zmienić"}. Nic nie zrobiono.` };

const noPane = (id: string): VoiceToolResult => ({ ok: false, text: `nie ma panelu „${id}” – sprawdź overview` });
const noProject = (q: string): VoiceToolResult => ({
  ok: false,
  text: q ? `nie ma projektu „${q}” – sprawdź overview` : "nie ma aktywnego projektu – podaj projekt albo poproś użytkownika o dodanie",
});

const CONTROL: Record<PaneControl, { head: string; action: string }> = {
  stop: { head: "Przerwać agenta?", action: "Przerwij" },
  restart: { head: "Uruchomić panel od nowa?", action: "Restart" },
  new_conversation: { head: "Zacząć nową rozmowę w panelu?", action: "Nowa rozmowa" },
  close: { head: "Zamknąć panel?", action: "Zamknij" },
};

const row = (p: VoicePane, prompt = ""): DeployTask => ({ agent: p.agent, title: p.title || p.id, prompt, ...(p.account ? { account: p.account } : {}) });

export async function runVoiceTool(name: string, args: Record<string, unknown>, host: VoiceHost, signal: AbortSignal): Promise<VoiceToolResult> {
  const projects = host.projects();
  switch (name) {
    case "overview":
      return { ok: true, text: overviewText(projects) };

    case "list_agents": {
      const agents = host.agents().map(
        (a) =>
          `${a.id} (${a.name})` +
          (a.accounts.length ? `, konta: ${a.accounts.join(", ")}` : "") +
          (a.models.length ? `, modele: ${a.models.join(", ")}` : ""),
      );
      const presets = host.presets().map((p) => `${p.name}: ${p.agents.join(", ")}`);
      return { ok: true, text: [`Agenci:\n${agents.join("\n")}`, presets.length ? `Presety:\n${presets.join("\n")}` : "Brak presetów."].join("\n") };
    }

    case "read_pane": {
      const f = findPane(projects, str(args.id));
      if (!f) return noPane(str(args.id));
      const screen = host.read(f.pane.id, READ_LINES);
      if (screen === null) return { ok: false, text: `panel ${f.pane.id} nie ma terminala` };
      const text = screen.length > READ_LIMIT ? `…${screen.slice(-READ_LIMIT)}` : screen;
      return { ok: true, text: text.trim() ? text : "(ekran pusty)" };
    }

    case "show": {
      const tab = str(args.tab);
      if (tab && tab !== "code" && tab !== "chat" && tab !== "bot") return { ok: false, text: "`tab` to code, chat albo bot" };
      const paneQ = str(args.pane);
      const projQ = str(args.project);
      const f = paneQ ? findPane(projects, paneQ) : null;
      if (paneQ && !f) return noPane(paneQ);
      const pr = projQ ? findProject(projects, projQ) : null;
      if (projQ && !pr) return noProject(projQ);
      if (!f && !pr && !tab) return { ok: false, text: "podaj panel, projekt albo zakładkę" };
      // Panel albo projekt widać tylko w zakładce z terminalami.
      const to: AppTab | undefined = (tab || undefined) as AppTab | undefined;
      host.show({
        ...(pr ? { project: pr.id } : {}),
        ...(f ? { pane: f.pane.id } : {}),
        ...(to ? { tab: to } : f || pr ? { tab: "code" } : {}),
        ...(args.maximize === true ? { maximize: true } : {}),
      });
      const what = [f && `panel ${f.pane.agent} „${f.pane.title || f.pane.id}”`, pr && `projekt „${pr.name}”`, to && `zakładka ${to}`].filter(Boolean);
      return { ok: true, text: `pokazano: ${what.join(", ")}` };
    }

    case "open_panes": {
      const pr = findProject(projects, str(args.project));
      if (!pr) return noProject(str(args.project));
      const raw = Array.isArray(args.tasks) ? (args.tasks as Record<string, unknown>[]) : [];
      if (raw.length === 0) return { ok: false, text: "`tasks` musi być niepustą listą zadań" };
      const free = host.free(pr.id);
      if (raw.length > free) return { ok: false, text: `za dużo zadań: w „${pr.name}” można dodać jeszcze ${free} panel(i)` };
      const agents = host.agents();
      const tasks: DeployTask[] = [];
      for (const [i, t] of raw.entries()) {
        const where = `zadanie ${i + 1}`;
        const agentQ = str(t?.agent);
        const agent = agents.find((a) => norm(a.id) === norm(agentQ)) ?? agents.find((a) => norm(a.name) === norm(agentQ));
        const title = str(t?.title);
        const prompt = str(t?.prompt);
        if (!agent) return { ok: false, text: `${where}: nieznany agent „${agentQ}” (dostępni: ${agents.map((a) => a.id).join(", ")})` };
        if (!title || !prompt) return { ok: false, text: `${where}: brak tytułu albo polecenia` };
        if (prompt.length > PROMPT_LIMIT) return { ok: false, text: `${where}: polecenie dłuższe niż ${PROMPT_LIMIT} znaków` };
        const task: DeployTask = { agent: agent.id, title, prompt };
        const accQ = str(t?.account);
        if (accQ) {
          const account = pick(agent.accounts, accQ);
          if (!account) return { ok: false, text: `${where}: ${agent.name} nie ma konta „${accQ}” (są: ${agent.accounts.join(", ") || "tylko domyślne"})` };
          task.account = account;
        }
        const modelQ = str(t?.model);
        // Lista modeli to podpowiedź z „Nowego panelu”; agent przyjmie też inny `--model`.
        if (modelQ) task.model = pick(agent.models, modelQ) ?? modelQ;
        tasks.push(task);
      }
      const n = tasks.length;
      const d = await host.confirm({ head: `Otworzyć ${n === 1 ? "panel" : `${n} panele`} w „${pr.name}”?`, action: "Uruchom", tasks }, signal);
      if (d.kind !== "run") return refused(d);
      return { ok: true, text: await host.open(pr.id, tasks) };
    }

    case "send_to_pane": {
      const f = findPane(projects, str(args.id));
      const text = str(args.text);
      if (!f) return noPane(str(args.id));
      if (!text) return { ok: false, text: "pusta wiadomość" };
      const d = await host.confirm({ head: "Wysłać do panelu?", action: "Wyślij", tasks: [row(f.pane, text)] }, signal);
      if (d.kind !== "run") return refused(d);
      const err = host.send(f.pane.id, text);
      return err ? { ok: false, text: err } : { ok: true, text: `wysłano do ${f.pane.id} (${f.pane.agent})` };
    }

    case "pane_control": {
      const f = findPane(projects, str(args.id));
      if (!f) return noPane(str(args.id));
      const action = str(args.action) as PaneControl;
      const c = CONTROL[action];
      if (!c) return { ok: false, text: "`action` to stop, restart, new_conversation albo close" };
      const d = await host.confirm({ ...c, tasks: [row(f.pane)] }, signal);
      if (d.kind !== "run") return refused(d);
      const err = host.control(f.pane.id, action);
      return err ? { ok: false, text: err } : { ok: true, text: `${c.action}: ${f.pane.agent} „${f.pane.title || f.pane.id}” – zrobione` };
    }

    case "continue_elsewhere": {
      const f = findPane(projects, str(args.id));
      if (!f) return noPane(str(args.id));
      const targets = host.continueTargets(f.pane.id);
      if (targets.length === 0) return { ok: false, text: "ten panel nie ma rozmowy do przeniesienia" };
      const q = str(args.target);
      if (!q) return { ok: true, text: `Cele: ${targets.join("; ")}` };
      const target = pick(targets, q);
      if (!target) return { ok: false, text: `nie ma celu „${q}” (są: ${targets.join("; ")})` };
      const d = await host.confirm(
        { head: "Kontynuować rozmowę gdzie indziej?", action: "Kontynuuj", tasks: [row(f.pane, `→ ${target} (streszczenie rozmowy, bez Entera)`)] },
        signal,
      );
      if (d.kind !== "run") return refused(d);
      const err = host.continueTo(f.pane.id, target);
      return err ? { ok: false, text: err } : { ok: true, text: `uruchamiam ${target}; streszczenie wklei się samo, bez Entera` };
    }

    case "apply_preset": {
      const pr = findProject(projects, str(args.project));
      if (!pr) return noProject(str(args.project));
      const presets = host.presets();
      const name = pick(
        presets.map((p) => p.name),
        str(args.name),
      );
      if (!name) return { ok: false, text: `nie ma presetu „${str(args.name)}” (są: ${presets.map((p) => p.name).join(", ") || "żadne"})` };
      const preset = presets.find((p) => p.name === name)!;
      const d = await host.confirm(
        { head: `Dodać preset „${name}” do „${pr.name}”?`, action: "Dodaj", tasks: preset.agents.map((a) => ({ agent: a, title: name, prompt: "" })) },
        signal,
      );
      if (d.kind !== "run") return refused(d);
      const err = host.applyPreset(pr.id, name);
      return err ? { ok: false, text: err } : { ok: true, text: `dodano preset „${name}” (${preset.agents.length} panel(e))` };
    }

    case "ask_bot": {
      const bots = await host.bots();
      const q = str(args.bot);
      if (!q) return { ok: true, text: bots.length ? bots.map((b) => `${b.name} (${b.id}): ${b.about}`).join("\n") : "Nie ma botów." };
      const bot =
        bots.find((b) => norm(b.id) === norm(q)) ?? bots.find((b) => norm(b.name) === norm(q)) ?? bots.find((b) => norm(b.name).startsWith(norm(q)));
      if (!bot) return { ok: false, text: `nie ma bota „${q}” (są: ${bots.map((b) => b.name).join(", ") || "żadne"})` };
      const question = str(args.question);
      if (!question) return { ok: false, text: "brak pytania do bota" };
      try {
        return { ok: true, text: `${bot.name} odpowiada:\n${await host.askBot(bot.id, question, signal)}` };
      } catch (e) {
        return { ok: false, text: `${bot.name}: ${e instanceof Error ? e.message : String(e)}` };
      }
    }
  }
  return { ok: false, text: `nieznane narzędzie „${name}”` };
}

/** Jedna linia do zapisu rozmowy: co rozmówca zrobił. */
export function voiceToolLabel(name: string, args: Record<string, unknown>): string {
  switch (name) {
    case "overview":
      return "sprawdza projekty i panele";
    case "list_agents":
      return "sprawdza agentów i presety";
    case "read_pane":
      return `czyta panel ${str(args.id)}`;
    case "show":
      return `pokazuje ${[str(args.pane) && `panel ${str(args.pane)}`, str(args.project), str(args.tab)].filter(Boolean).join(", ")}`;
    case "open_panes":
      return `otwiera ${Array.isArray(args.tasks) ? args.tasks.length : 0} panel(e)`;
    case "send_to_pane":
      return `pisze do panelu ${str(args.id)}`;
    case "pane_control":
      return `${str(args.action)} panelu ${str(args.id)}`;
    case "continue_elsewhere":
      return `kontynuacja panelu ${str(args.id)}${str(args.target) ? ` → ${str(args.target)}` : ""}`;
    case "apply_preset":
      return `preset ${str(args.name)}`;
    case "ask_bot":
      return str(args.bot) ? `pyta bota ${str(args.bot)}` : "sprawdza boty";
  }
  return name;
}

/** Komunikat do powiedzenia, gdy agent skończy pracę w trakcie rozmowy. */
export function finishedNote(p: { agent: string; title: string; project: string }): string {
  return `${p.agent}${p.title ? ` od „${p.title}”` : ""} w projekcie ${p.project} skończył pracę.`;
}

const YES =
  /^(tak|ok|okej|okay|dobra|dobrze|jasne|zgoda|uruchom|uruchamiaj|odpal|odpalaj|dawaj|start|startuj|deploy|potwierdzam|wysyłaj|wyślij|leć|lecimy|jedziemy|zaczynaj|zamknij|przerwij|dodaj|kontynuuj|rób)$/;
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
    if (NO.test(words[0])) return { kind: "cancel" };
    if (FIX.test(words[0])) return words.length === 1 ? { kind: "fix" } : { kind: "fix", note: text.trim() };
    if (words.every((w) => YES.test(w) || w === "to" || w === "no" || w === "go" || w === "puść")) return { kind: "run" };
  }
  return { kind: "fix", note: text.trim() };
}
