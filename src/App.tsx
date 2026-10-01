import { useEffect, useLayoutEffect, useMemo, useReducer, useRef, useState } from "react";
import { backend, inElectron } from "./backend";
import { agentModels, type AgentDef } from "./agents";
import { accentHex, nextMode, stepFontSize, uiClasses } from "./ui";
import { DEFAULT_TERM_FONT, THEMES, termTheme } from "./themes";
import type { TermLook } from "./Terminal";
import { IconButton } from "./IconButton";
import { FolderPlus, Gauge, LayoutGrid, Plus, UserRound, X } from "lucide-react";
import { tildify } from "./paths";
import {
  MAX_PANES,
  activeProject,
  emptyWorkspace,
  parseWorkspace,
  projectName,
  reduce,
  type Pane,
  type Project,
} from "./workspace";
import { Rail } from "./Rail";
import { Grid } from "./Grid";
import { NewPaneDialog } from "./NewPaneDialog";
import { PresetMenu } from "./PresetMenu";
import { AppearanceDialog } from "./AppearanceDialog";
import { AccountsDialog } from "./AccountsDialog";
import { ContinueDialog } from "./ContinueDialog";
import { continueTargets, type ContinueTarget } from "./continue";
import { NO_ACCOUNTS, accountById, accountKind, accountsFor, pickAccountId, type Accounts } from "./accounts";
import { VoiceDialog } from "./VoiceDialog";
import { VoiceOrb } from "./voice/VoiceOrb";
import type { VoiceTab } from "./voice/TalkSettings";
import { askBot } from "./voice/askBot";
import { finishedNote, shortId, type DeployTask, type PaneHost, type VoiceProject } from "./voice/tools";
import { activeStt, DEFAULT_STT, type SttConfig } from "./stt";
import { Dock } from "./Dock";
import { ResizeEdges, TitleBar } from "./TitleBar";
import { ChatView } from "./chat/ChatView";
import { BotView } from "./bot/BotView";
import type { Mode } from "./chat/ModeTabs";
import { CONTEXT_POLL_MS, cleanTermTitle, contextKind, contextTargets, paneMeter, paneTitles, sessionTitles, type SessionContext } from "./context";
import { FALLBACK_MAX_CHARS, SUMMARY_SYSTEM, digestText, handoffText, summaryText } from "./handoff";
import { FINISHED_TEXT, STARTED_TEXT, exitedText, newTools, pushFeed, toolText, type FeedItem } from "./feed";
import { LIMITS_POLL_MS, limitHit, type ClaudeLimits } from "./limits";
import { TOAST_MS, toastText } from "./toast";
import { PANE_OUT_MS } from "./Pane";
import { planPreset } from "./presets";
import {
  DONE_MS,
  PING_MS,
  TICK_MS,
  initialActivity,
  onOutput as activityOutput,
  onResize as activityResize,
  tick as activityTick,
  type Activity,
  type PaneState,
} from "./activity";
import { commandFor, type Command } from "./keys";
import { CONFIRM_MS, confirmClick, type Arm } from "./confirm";
import type { TerminalHandle } from "./Terminal";
import { Nebula } from "./Nebula";
import { motionAllowed } from "./motion";
import type { PaneActions, ProjectActions } from "./handlers";

/** Ile czekamy, aż agent w nowym panelu włączy wklejanie blokiem, zanim wyślemy streszczenie. */
const CONTINUE_WAIT_MS = 20_000;
/** Rozmowa głosowa: po włączeniu bracketed paste TUI jeszcze chwilę się rysuje; Enter osobno po wklejce. */
const PASTE_SETTLE_MS = 1500;
const SUBMIT_DELAY_MS = 150;

export function App() {
  const [ws, dispatch] = useReducer(reduce, emptyWorkspace);
  const [agents, setAgents] = useState<AgentDef[]>([]);
  const [accounts, setAccounts] = useState<Accounts>(NO_ACCOUNTS);
  const [accountsDialog, setAccountsDialog] = useState(false);
  const [continuePane, setContinuePane] = useState<string | null>(null);
  const [errors, setErrors] = useState<string[]>([]);
  // Ephemeral only: never written to disk (exit + aktywność z src/activity.ts).
  const [ephemeral, setEphemeral] = useState<Record<string, PaneState>>({});
  // Czasu wyjścia nie trzymamy w stanie: tysiące chunków na sekundę nie może restartować Reacta.
  const activity = useRef(new Map<string, Activity>());
  // Ostatni odczyt kontekstu według sessionId; ulotny, nowa rozmowa = nowy klucz.
  const [contexts, setContexts] = useState<Record<string, SessionContext>>({});
  // „Na żywo” (pulpit): ulotne, najnowsze pierwsze.
  const [feed, setFeed] = useState<FeedItem[]>([]);
  const feedSeq = useRef(0);
  // Limity subskrypcji claude (plik pisany przez linię statusu paneli claude).
  const [limits, setLimits] = useState<Record<string, ClaudeLimits>>({});
  // Ostatnie pokazane wywołanie narzędzia według sessionId; brak klucza = jeszcze nie czytano.
  const seenTools = useRef(new Map<string, string | null>());
  // Numer odczytu według sessionId: odpowiedź starsza od już obsłużonej nie dubluje zdarzeń.
  const readSeq = useRef(new Map<string, { sent: number; done: number }>());
  const [winMax, setWinMax] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  // Panele, do których Haiku właśnie streszcza kontekst (M4); ref = strażnik w async sendContext.
  const [summarizing, setSummarizing] = useState<string[]>([]);
  const summarizingRef = useRef(summarizing);
  summarizingRef.current = summarizing;
  const [dialog, setDialog] = useState(false);
  const [presetMenu, setPresetMenu] = useState(false);
  const [appearance, setAppearance] = useState(false);
  const [voice, setVoice] = useState(false);
  const [talk, setTalk] = useState(false);
  const [voiceTab, setVoiceTab] = useState<VoiceTab>("dictation");
  const [stt, setStt] = useState<SttConfig>(DEFAULT_STT);
  const sttRef = useRef(stt);
  sttRef.current = stt;
  const [lastAgentId, setLastAgentId] = useState<string | null>(null);
  // false do końca startu: zapis `ws` na dysk musi ruszyć dopiero po wczytaniu pliku.
  const [loaded, setLoaded] = useState(false);
  // Home is fetched once: paths are stored as `~/...` (Rust expands them at spawn).
  const home = useRef<string>("");
  // Terminal of each mounted pane, for Ctrl+Shift+C / Ctrl+Shift+V.
  const terms = useRef(new Map<string, TerminalHandle>());
  // Ctrl+Alt+W on a running pane asks twice, exactly like the ✕ button.
  const armRef = useRef<Arm>(null);
  const [armedPane, setArmedPane] = useState<string | null>(null);
  // Panele w animacji `paneOut`: reduktor dostaje `close` dopiero po PANE_OUT_MS.
  const [closing, setClosing] = useState<ReadonlySet<string>>(new Set());
  // Timery zdejmujące `done` (DONE_MS) i kończące zamykanie paneli (PANE_OUT_MS).
  const timers = useRef(new Set<number>());
  const later = (ms: number, fn: () => void) => {
    const t = window.setTimeout(() => {
      timers.current.delete(t);
      fn();
    }, ms);
    timers.current.add(t);
  };
  useEffect(() => {
    const all = timers.current;
    return () => all.forEach((t) => clearTimeout(t));
  }, []);

  // Start: agents first (parseWorkspace needs their ids), then the saved layout.
  useEffect(() => {
    let live = true;
    // Local date: toISOString() is UTC, so after 22:00 in Poland it would already name tomorrow.
    const d = new Date();
    const today = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    const backup = () => backend.backupWorkspace(today).catch(() => undefined);
    void (async () => {
      try {
        const r = await backend.loadAgents();
        if (!live) return;
        setAgents(r.agents);
        setErrors(r.errors);
        void backend.loadAccounts().then((acc) => {
          if (!live) return;
          setAccounts(acc.value);
          if (acc.errors.length > 0) setErrors((prev) => [...prev, ...acc.errors]);
        });
        const raw = await backend.loadWorkspace();
        if (!live || raw === null) return; // pierwszy start: zostaje emptyWorkspace
        let parsed: ReturnType<typeof parseWorkspace>;
        try {
          parsed = parseWorkspace(JSON.parse(raw) as unknown, r.agents.map((a) => a.id));
        } catch (e) {
          // Plik, który nie jest nawet JSON-em: zachowaj go, zanim nadpiszemy pusty stan.
          await backup();
          if (live) setErrors((prev) => [...prev, `workspace: ${String(e)}`]);
          return;
        }
        if (parsed.errors.length > 0) {
          await backup(); // zachowaj plik przed pierwszym zapisem, który go nadpisze
          if (live) setErrors((prev) => [...prev, ...parsed.errors]);
          if (!live) return;
        }
        dispatch({ type: "load", workspace: parsed.workspace });
      } catch (e) {
        // Unreadable file (e.g. not UTF-8): the empty state is about to overwrite it, so keep a copy.
        await backup();
        if (live) setErrors((prev) => [...prev, `workspace: ${String(e)}`]);
      } finally {
        if (live) setLoaded(true);
      }
    })();
    return () => {
      live = false;
    };
  }, []);

  // Zapis przy każdej zmianie, bez debounce (zmiany rzadkie). Przed wczytaniem nie wolno
  // pisać — pusty stan startowy nadpisałby plik.
  useEffect(() => {
    if (!loaded) return;
    void backend.saveWorkspace(JSON.stringify(ws, null, 2)).catch((e: unknown) =>
      setErrors((prev) => [...prev, `zapis: ${String(e)}`]),
    );
  }, [ws, loaded]);

  useEffect(() => {
    void backend
      .homeDir()
      .then((dir) => {
        home.current = dir;
      })
      .catch((e: unknown) => setErrors((prev) => [...prev, `home: ${String(e)}`]));
  }, []);

  const defaultAgent = useMemo(
    () => agents.find((a) => a.id === "claude") ?? agents[0],
    [agents],
  );
  const active = activeProject(ws);
  const paneCount = active?.panes.length ?? 0;
  const focusedId = active?.focused ?? null;
  // xterm nie zna klas CSS — kolory motywu i akcent jadą do terminala jako wartości (etap 1 M2).
  const theme = THEMES[ws.ui.theme];
  const accent = accentHex(ws.ui);
  const termLook = useMemo<TermLook>(
    () => ({ theme: termTheme(theme, accent), font: theme.termFont ?? DEFAULT_TERM_FONT }),
    [theme, accent],
  );
  // Motyw na <html>: tokeny themes.css obejmują też body, paski przewijania i pasek tytułu.
  // Tło terminala z themes.ts (jedno źródło dla xtermu i `.pane-body`), przed malowaniem.
  useLayoutEffect(() => {
    const root = document.documentElement;
    root.dataset.theme = theme.id;
    root.dataset.tone = theme.light ? "light" : "dark";
    root.style.setProperty("--term-bg", theme.term.background);
    root.style.setProperty("--term-text", theme.term.foreground);
  }, [theme]);
  // Handlerzy spoza renderu (interwał, callbacki terminala) pytają o fokus przez ref.
  const focusedRef = useRef<string | null>(focusedId);
  focusedRef.current = focusedId;
  const lastIndex = useMemo(() => {
    const last = agents.findIndex((a) => a.id === lastAgentId);
    return last >= 0 ? last : Math.max(0, agents.findIndex((a) => a.id === defaultAgent?.id));
  }, [agents, lastAgentId, defaultAgent]);

  const forget = (ids: string[]) => {
    for (const id of ids) {
      terms.current.delete(id);
      activity.current.delete(id);
    }
    setEphemeral((prev) => {
      if (!ids.some((id) => id in prev)) return prev;
      const next = { ...prev };
      for (const id of ids) delete next[id];
      return next;
    });
  };

  useEffect(() => {
    void backend
      .sttConfig()
      .then((r) => {
        setStt(r.config);
        if (r.errors.length > 0) setNotice(r.errors.join(" · "));
      })
      .catch(() => undefined);
  }, []);

  const paneActions: PaneActions = {
    voiceReady: () => activeStt(sttRef.current) !== null,
    openVoice: () => {
      setVoiceTab("dictation");
      setVoice(true);
    },
    voiceMic: () => sttRef.current.mic,
    dictated: (paneId, text) => {
      const term = terms.current.get(paneId);
      if (!term) return;
      term.paste(text);
      dispatch({ type: "focus", id: paneId });
    },
    voiceError: (message) => setNotice(`Dyktowanie: ${message}`),
    focus: (paneId) => dispatch({ type: "focus", id: paneId }),
    restart: (paneId) => {
      forget([paneId]);
      dispatch({ type: "restart", id: paneId });
    },
    toggleMaximize: (paneId) => dispatch({ type: "toggleMaximize", id: paneId }),
    swap: (a, b) => dispatch({ type: "swap", a, b }),
    handoff: (from, to) => void sendContext(from, to),
    continueFrom: (paneId) => setContinuePane(paneId),
    acceptsPaste: (paneId) => terms.current.get(paneId)?.bracketedPaste() ?? false,
    newConversation: (paneId) =>
      dispatch({ type: "newConversation", id: paneId, sessionId: crypto.randomUUID() }),
    close: (paneId) => {
      if (closing.has(paneId)) return; // drugi klik / skrót w trakcie animacji
      setClosing((prev) => new Set(prev).add(paneId));
      later(PANE_OUT_MS, () => {
        forget([paneId]);
        dispatch({ type: "close", id: paneId });
        setClosing((prev) => {
          const next = new Set(prev);
          next.delete(paneId);
          return next;
        });
      });
    },
    exit: (paneId, info) => {
      setEphemeral((prev) => ({ ...prev, [paneId]: { ...prev[paneId], exited: info } }));
      addFeed(paneId, [exitedText(info)]);
    },
    started: (paneId) => addFeed(paneId, [STARTED_TEXT]),
    registerTerminal: (paneId, handle) => {
      if (handle) terms.current.set(paneId, handle);
      else terms.current.delete(paneId);
    },
    output: (paneId) => {
      activity.current.set(paneId, activityOutput(activity.current.get(paneId) ?? initialActivity, Date.now()));
      if (paneId === focusedRef.current && document.hasFocus()) return; // użytkownik właśnie to czyta
      setEphemeral((prev) =>
        prev[paneId]?.unread ? prev : { ...prev, [paneId]: { ...prev[paneId], unread: true } },
      );
    },
    redraw: (paneId) => {
      activity.current.set(paneId, activityResize(activity.current.get(paneId) ?? initialActivity, Date.now()));
    },
    // Spinner claude zmienia tytuł kilka razy na sekundę; render tylko przy nowym temacie.
    title: (paneId, raw) => {
      const termTitle = cleanTermTitle(raw);
      setEphemeral((prev) =>
        (prev[paneId]?.termTitle ?? null) === termTitle ? prev : { ...prev, [paneId]: { ...prev[paneId], termTitle } },
      );
    },
  };

  const projectActions: ProjectActions = {
    select: (projectId) => dispatch({ type: "selectProject", id: projectId }),
    rename: (projectId, name) => dispatch({ type: "renameProject", id: projectId, name }),
    remove: (projectId) => {
      const project = ws.projects.find((p) => p.id === projectId);
      forget(project ? project.panes.map((p) => p.id) : []);
      dispatch({ type: "removeProject", id: projectId });
    },
    addProject: () => {
      void (async () => {
        let picked: string | null;
        try {
          picked = await backend.pickDir();
        } catch (e) {
          setNotice(`Wybór katalogu: ${String(e)}`);
          return;
        }
        if (picked === null) return; // anulowane
        // `home.current === ""` (brak HOME) zostawia pełną ścieżkę — Rust i tak ją rozumie.
        const path = tildify(picked, home.current);
        if (!(await backend.dirExists(path).catch(() => false))) {
          setNotice(`Katalog nie istnieje: ${path}`);
          return;
        }
        setNotice(null);
        const project: Project = {
          id: crypto.randomUUID(),
          name: projectName(path),
          path,
          panes: [],
          focused: null,
          maximized: null,
        };
        dispatch({ type: "addProject", project });
      })();
    },
    openPaneDialog: () => {
      if (active === null || paneCount >= MAX_PANES) return; // no project to add a pane to
      setDialog(true);
    },
    addPane: (agentId, model, account) => {
      const agent = agents.find((a) => a.id === agentId);
      if (!agent || paneCount >= MAX_PANES) return;
      setDialog(false);
      setLastAgentId(agent.id);
      const pane: Pane = { id: crypto.randomUUID(), agentId: agent.id, run: 1 };
      if (agent.session) pane.sessionId = crypto.randomUUID();
      if (model) pane.model = model;
      if (account) pane.account = account;
      dispatch({ type: "add", pane });
    },
    applyPreset: (preset) => {
      setPresetMenu(false);
      if (active === null) return;
      const plan = planPreset(preset, agents.map((a) => a.id), MAX_PANES - paneCount);
      const msgs: string[] = [];
      for (const agentId of plan.agents) {
        const agent = agents.find((a) => a.id === agentId);
        if (!agent) continue; // planPreset zostawia tylko znanych
        const pane: Pane = { id: crypto.randomUUID(), agentId, run: 1 };
        if (agent.session) pane.sessionId = crypto.randomUUID();
        const account = pickAccountId(accounts, accountKind(agent), null);
        if (account) pane.account = account;
        dispatch({ type: "add", pane });
        setLastAgentId(agentId);
      }
      if (plan.skipped.length > 0) msgs.push(`Brak agentów w konfiguracji: ${plan.skipped.join(", ")}`);
      if (plan.dropped > 0) {
        msgs.push(`Pominięto ${plan.dropped} z powodu limitu ${MAX_PANES} paneli na projekt`);
      }
      if (msgs.length > 0) setNotice(toastText(...msgs));
    },
  };

  // Kto jest kim w powiadomieniu, na szynie i w „Na żywo”: paneId → agent, projekt.
  const paneInfo = useMemo(() => {
    const map = new Map<string, { agent: string; agentId: string; project: string; projectId: string; path: string }>();
    for (const p of ws.projects) {
      for (const pane of p.panes) {
        map.set(pane.id, {
          agent: agents.find((a) => a.id === pane.agentId)?.name ?? pane.agentId,
          agentId: pane.agentId,
          project: p.name,
          projectId: p.id,
          path: p.path,
        });
      }
    }
    return map;
  }, [ws.projects, agents]);
  const paneInfoRef = useRef(paneInfo);
  paneInfoRef.current = paneInfo;
  // Tytuły rozmów do pulpitu: szybkie znalezienie panelu po tym, o czym jest rozmowa.
  // Żywy tytuł terminala wygrywa, plik sesji uzupełnia (wznowiona rozmowa, zanim claude go ustawi).
  const titles = useMemo(
    () => paneTitles(sessionTitles(ws.projects, contexts), ephemeral),
    [ws.projects, contexts, ephemeral],
  );
  // Okno (pasek zadań, przełącznik okien) nosi temat panelu w fokusie, jak zwykła konsola z claude.
  const titlesRef = useRef(titles);
  titlesRef.current = titles;
  const focusedTitle = focusedId ? titles[focusedId] : undefined;
  const [chatTitle, setChatTitle] = useState("");
  const [botTitle, setBotTitle] = useState("");
  // Czat i Bot montowane przy pierwszym wejściu i potem zostają (trwająca odpowiedź płynie w tle).
  const [chatMounted, setChatMounted] = useState(false);
  const [botMounted, setBotMounted] = useState(false);
  const mode = ws.ui.mode;
  useEffect(() => {
    if (mode === "chat") setChatMounted(true);
    if (mode === "bot") setBotMounted(true);
  }, [mode]);
  const setMode = (m: Mode) => dispatch({ type: "setUi", patch: { mode: m } });
  // Kliknięte powiadomienie o przebiegu bota: zakładka Bot z tym przebiegiem.
  const [openRun, setOpenRun] = useState<{ bot: string; chat: string; seq: number } | null>(null);
  useEffect(
    () =>
      backend.onBotOpenRun((r) => {
        setMode("bot");
        setOpenRun({ ...r, seq: Date.now() });
      }),
    [], // eslint-disable-line react-hooks/exhaustive-deps
  );
  const windowTitle =
    mode === "chat"
      ? `${chatTitle || "Czat"} — Agents`
      : mode === "bot"
        ? `${botTitle || "Boty"} — Agents`
        : focusedTitle
          ? `${focusedTitle} — Agents`
          : "Agents";
  useEffect(() => {
    document.title = windowTitle; // podgląd w przeglądarce; w oknie tytuł ustawia TitleBar
  }, [windowTitle]);

  // Tylko refy i settery: woła to też interwał sprzed wielu renderów.
  const addFeed = (paneId: string, texts: string[], kind: FeedItem["kind"] = "event") => {
    const info = paneInfoRef.current.get(paneId);
    if (!info || texts.length === 0) return;
    const at = Date.now();
    const items = texts.map((text) => ({
      id: ++feedSeq.current,
      paneId,
      projectId: info.projectId,
      agentId: info.agentId,
      project: info.project,
      text,
      at,
      kind,
    }));
    setFeed((prev) => pushFeed(prev, items));
  };
  // Shift + upuszczenie (M4): wyciąg rozmowy `from` wklejony do `to`. Bez Entera – polecenie dopisuje użytkownik.
  const sendContext = async (from: string, to: string) => {
    const src = paneInfoRef.current.get(from);
    const dst = paneInfoRef.current.get(to);
    const pane = ws.projects.flatMap((p) => p.panes).find((p) => p.id === from);
    const kind = contextKind(agents.find((a) => a.id === pane?.agentId));
    if (!src || !dst || !pane?.sessionId || kind === null) return;
    const term = terms.current.get(to);
    if (!term?.bracketedPaste()) {
      // Bez bracketed paste każda linia wyciągu poszłaby jako Enter, czyli jako polecenie.
      setNotice(`„${dst.agent}” nie przyjmuje wklejenia blokiem – kontekstu nie wysłano`);
      return;
    }
    if (summarizingRef.current.includes(to)) return; // jedno streszczenie naraz do danego panelu
    // Ref od razu (drugie upuszczenie przed renderem też ma go widzieć), stan dla plakietki w siatce.
    const busy = (on: boolean) => {
      const next = on ? [...summarizingRef.current, to] : summarizingRef.current.filter((id) => id !== to);
      summarizingRef.current = next;
      setSummarizing(next);
    };
    busy(true);
    let text: string;
    let failed: string | null = null;
    try {
      const h = await backend.sessionHandoff(kind, pane.sessionId, accountById(accounts, pane.account)?.dir).catch(() => null);
      if (!h) {
        setNotice(`Nie udało się odczytać rozmowy „${src.agent}”`);
        return;
      }
      const source = { agent: src.agent, project: src.project, projectPath: src.path, home: home.current };
      // Streszcza agent panelu docelowego: pi → lokalny model, w pozostałych razach Haiku przez claude
      // (programy z agents.json; źródłem może być każdy z nich).
      const dstAgent = agents.find((a) => a.id === ws.projects.flatMap((p) => p.panes).find((p) => p.id === to)?.agentId);
      const local = dstAgent !== undefined && dstAgent.command.split("/").pop() === "pi";
      const claude = agents.find((a) => a.command.split("/").pop() === "claude")?.command ?? "claude";
      setNotice(`Streszczam rozmowę „${src.agent}” (${local ? "lokalny model" : "Haiku"})…`);
      try {
        const input = digestText(h, source);
        const out = local
          ? await backend.piSummary(dstAgent.command, SUMMARY_SYSTEM, input)
          : await backend.claudeSummary(claude, SUMMARY_SYSTEM, input);
        text = summaryText(out, source);
      } catch (e) {
        failed = e instanceof Error ? e.message : String(e);
        text = handoffText(h, source, FALLBACK_MAX_CHARS);
      }
    } finally {
      busy(false);
    }
    // Po kilku sekundach cel mógł się zamknąć albo wyjść z trybu wklejania blokiem.
    const target = terms.current.get(to);
    if (!target?.bracketedPaste()) {
      setNotice(`„${dst.agent}” nie przyjmuje już wklejenia blokiem – kontekstu nie wysłano`);
      return;
    }
    target.paste(text);
    dispatch({ type: "focus", id: to });
    setNotice(
      failed === null
        ? `Wklejono streszczenie z „${src.agent}” – dopisz polecenie i wciśnij Enter`
        : `Streszczenie nie wyszło (${failed}) – wklejono skrócony wyciąg z „${src.agent}”`,
    );
    addFeed(from, [`przekazał kontekst → ${dst.agent}`]);
  };

  // Ref, bo `continueTo` czeka na nowy panel: domknięcie sprzed renderu nie widzi jeszcze jego ani `ws`.
  const sendContextRef = useRef(sendContext);
  sendContextRef.current = sendContext;

  // „Kontynuuj gdzie indziej”: nowy panel (inne konto / inny agent) i streszczenie rozmowy `from` w jego prompcie.
  const continueTo = async (from: string, target: ContinueTarget) => {
    const agent = agents.find((a) => a.id === target.agentId);
    if (!agent || paneCount >= MAX_PANES) return;
    setContinuePane(null);
    setLastAgentId(agent.id);
    const pane: Pane = { id: crypto.randomUUID(), agentId: agent.id, run: 1 };
    if (agent.session) pane.sessionId = crypto.randomUUID();
    if (target.account) pane.account = target.account;
    dispatch({ type: "add", pane });
    setNotice(`Uruchamiam ${target.label}…`);
    // Agent musi wstać i włączyć wklejanie blokiem (bracketed paste); inaczej wyciąg poszedłby jako Enter-y.
    for (let waited = 0; waited < CONTINUE_WAIT_MS; waited += 250) {
      await new Promise((r) => setTimeout(r, 250));
      if (terms.current.get(pane.id)?.bracketedPaste() && paneInfoRef.current.has(pane.id)) {
        await sendContextRef.current(from, pane.id);
        return;
      }
    }
    setNotice(`„${target.label}” nie wystartował na czas – przeciągnij rozmowę z Shiftem, żeby wkleić kontekst`);
  };

  const activeRef = useRef(ws.active);
  activeRef.current = ws.active;

  // Rozmowa głosowa (etapy 5 i 7 planu głosu): projekty i panele dla narzędzi rozmówcy.
  // Id dla modelu to 6 pierwszych znaków UUID (`shortId`).
  const allPanes = ws.projects.flatMap((p) => p.panes);
  const fullPaneId = (short: string) => allPanes.find((p) => shortId(p.id) === short)?.id ?? null;
  const projectByShort = (short: string) => ws.projects.find((p) => shortId(p.id) === short) ?? null;
  const voiceNote = useRef<((text: string) => void) | null>(null);
  const newPane = (agent: AgentDef, accountName?: string, model?: string): Pane => {
    const pane: Pane = { id: crypto.randomUUID(), agentId: agent.id, run: 1 };
    if (agent.session) pane.sessionId = crypto.randomUUID();
    const named = accountName ? accountsFor(accounts, accountKind(agent)).find((x) => x.name === accountName)?.id : undefined;
    const account = named ?? pickAccountId(accounts, accountKind(agent), null);
    if (account) pane.account = account;
    if (model) pane.model = model;
    return pane;
  };
  const voiceHost: PaneHost = {
    projects: () => {
      const now = Date.now();
      return ws.projects.map(
        (p): VoiceProject => ({
          id: shortId(p.id),
          name: p.name,
          active: p.id === ws.active,
          panes: p.panes.map((pane) => {
            const agent = agents.find((a) => a.id === pane.agentId);
            const eph = ephemeral[pane.id];
            const meter = paneMeter(pane, agent, contexts);
            const hit = agent?.command.split("/").pop() === "claude" ? limitHit(limits[pane.account ?? ""], now) : null;
            const last = activity.current.get(pane.id)?.lastOutput ?? 0;
            const account = accountById(accounts, pane.account)?.name;
            return {
              id: shortId(pane.id),
              agent: agent?.name ?? pane.agentId,
              ...(account ? { account } : {}),
              title: titles[pane.id] ?? "",
              working: eph?.working ?? false,
              unread: eph?.unread ?? false,
              ...(eph?.exited ? { exited: eph.exited.code } : {}),
              ...(hit ? { limit: hit.text } : {}),
              ...(meter?.known ? { ctx: meter.pct } : {}),
              ...(last > 0 ? { idleMs: now - last } : {}),
            };
          }),
        }),
      );
    },
    agents: () =>
      agents.map((a) => ({
        id: a.id,
        name: a.name,
        accounts: accountsFor(accounts, accountKind(a)).map((x) => x.name),
        models: agentModels(a).map((m) => m.id),
      })),
    presets: () => ws.presets,
    free: (short) => {
      const p = projectByShort(short);
      return p ? MAX_PANES - p.panes.length : 0;
    },
    open: (short, tasks) => openVoicePanes(short, tasks),
    send: (short, text) => {
      const id = fullPaneId(short);
      const term = id ? terms.current.get(id) : undefined;
      if (!id || !term) return `panel ${short} nie ma terminala`;
      // Bez bracketed paste każda linia poszłaby jako osobny Enter.
      if (text.includes("\n") && !term.bracketedPaste()) return `panel ${short} nie przyjmuje wklejenia blokiem – wyślij jedną linię`;
      term.paste(text);
      later(SUBMIT_DELAY_MS, () => terms.current.get(id)?.type("\r"));
      addFeed(id, ["dostał wiadomość z rozmowy głosowej"]);
      return null;
    },
    read: (short, lines) => {
      const id = fullPaneId(short);
      const term = id ? terms.current.get(id) : undefined;
      return term ? term.tail(lines) : null;
    },
    show: ({ project, pane, tab, maximize }) => {
      if (tab && tab !== mode) setMode(tab);
      const pr = project ? projectByShort(project) : null;
      if (pr) dispatch({ type: "selectProject", id: pr.id });
      const id = pane ? fullPaneId(pane) : null;
      if (!id) return;
      dispatch({ type: "focus", id }); // aktywuje też projekt panelu
      const owner = ws.projects.find((p) => p.panes.some((x) => x.id === id));
      if (maximize && owner?.maximized !== id) dispatch({ type: "toggleMaximize", id });
    },
    control: (short, action) => {
      const id = fullPaneId(short);
      if (!id) return `nie ma panelu ${short}`;
      const pane = allPanes.find((p) => p.id === id)!;
      switch (action) {
        case "stop": {
          const term = terms.current.get(id);
          if (!term) return `panel ${short} nie ma terminala`;
          term.type("\x1b"); // Esc przerywa turę w claude i pi
          return null;
        }
        case "restart":
          paneActions.restart(id);
          return null;
        case "new_conversation":
          if (!agents.find((a) => a.id === pane.agentId)?.session) return "ten agent nie ma rozmów do zaczęcia od nowa – użyj restart";
          paneActions.newConversation(id);
          return null;
        case "close":
          paneActions.close(id);
          return null;
      }
    },
    continueTargets: (short) => {
      const pane = allPanes.find((p) => p.id === fullPaneId(short));
      return pane?.sessionId ? continueTargets(pane, agents, accounts).map((t) => t.label) : [];
    },
    continueTo: (short, label) => {
      const id = fullPaneId(short);
      const pane = allPanes.find((p) => p.id === id);
      const target = pane ? continueTargets(pane, agents, accounts).find((t) => t.label === label) : undefined;
      if (!id || !target) return `nie ma celu „${label}”`;
      const owner = ws.projects.find((p) => p.panes.some((x) => x.id === id));
      if (owner && owner.panes.length >= MAX_PANES) return `projekt „${owner.name}” ma już ${MAX_PANES} paneli`;
      dispatch({ type: "focus", id }); // nowy panel trafia do projektu źródła
      void continueTo(id, target);
      return null;
    },
    applyPreset: (short, name) => {
      const pr = projectByShort(short);
      const preset = ws.presets.find((p) => p.name === name);
      if (!pr || !preset) return "nie ma takiego projektu albo presetu";
      if (pr.id !== ws.active) dispatch({ type: "selectProject", id: pr.id });
      const plan = planPreset(preset, agents.map((a) => a.id), MAX_PANES - pr.panes.length);
      for (const agentId of plan.agents) {
        const agent = agents.find((a) => a.id === agentId);
        if (agent) dispatch({ type: "add", pane: newPane(agent) });
      }
      const skipped = [...plan.skipped, ...(plan.dropped ? [`${plan.dropped} ponad limit`] : [])];
      return plan.agents.length === 0 ? `nic nie dodano (${skipped.join(", ") || "pusty preset"})` : null;
    },
    bots: async () =>
      (await backend.botList()).bots.map((b) => ({ id: b.id, name: b.name, about: b.persona.split("\n")[0].slice(0, 160) })),
    askBot: (id, question, signal) => askBot(backend, id, question, signal),
  };

  // „OK, deploy”: panele dla zadań, a gdy agent wstanie (bracketed paste), polecenie i Enter.
  const openVoicePanes = async (short: string, tasks: DeployTask[]): Promise<string> => {
    const pr = projectByShort(short);
    if (!pr) return "nie ma takiego projektu";
    // Akcja „add” działa na aktywnym projekcie: najpierw przełączamy (użytkownik widzi nowe panele).
    if (pr.id !== ws.active) dispatch({ type: "selectProject", id: pr.id });
    const panes: { pane: Pane; task: DeployTask }[] = [];
    for (const task of tasks.slice(0, Math.max(0, MAX_PANES - pr.panes.length))) {
      const agent = agents.find((a) => a.id === task.agent);
      if (!agent) continue;
      const pane = newPane(agent, task.account, task.model);
      dispatch({ type: "add", pane });
      panes.push({ pane, task });
    }
    if (mode !== "code") setMode("code");
    if (panes.length === 0) return "nie otwarto żadnego panelu (limit albo nieznany agent)";
    setNotice(`Rozmowa głosowa: uruchamiam ${panes.length} panel(e)…`);
    const results = await Promise.all(
      panes.map(async ({ pane, task }) => {
        for (let waited = 0; waited < CONTINUE_WAIT_MS; waited += 250) {
          await new Promise((r) => setTimeout(r, 250));
          const term = terms.current.get(pane.id);
          if (!term?.bracketedPaste()) continue;
          await new Promise((r) => setTimeout(r, PASTE_SETTLE_MS)); // TUI dorysowuje pole wpisywania
          term.paste(task.prompt);
          await new Promise((r) => setTimeout(r, SUBMIT_DELAY_MS));
          terms.current.get(pane.id)?.type("\r");
          return `${shortId(pane.id)} (${task.agent}, „${task.title}”): zadanie wysłane`;
        }
        return `${shortId(pane.id)} (${task.agent}, „${task.title}”): agent nie wystartował w ${CONTINUE_WAIT_MS / 1000} s, zadania nie wysłano`;
      }),
    );
    setNotice(null);
    return results.join("\n");
  };

  // Kontekst i wywołania narzędzi z plików sesji agentów (Rust czyta tylko koniec pliku).
  // `null` nie kasuje poprzedniego odczytu: plik mógł chwilowo mieć na końcu same wyniki narzędzi.
  // Zakres: "active" = aktywny projekt, "poll" = aktywny + pracujące w schowanych, "all" = wszystkie.
  const readContexts = useRef<(which: "active" | "poll" | "all" | string[]) => Promise<unknown>>(async () => {});
  readContexts.current = (which) => {
    const all = ws.projects.flatMap((p) => p.panes);
    const panes =
      which === "all"
        ? all
        : which === "active"
          ? (active?.panes ?? [])
          : which === "poll"
            ? all.filter((p) => active?.panes.includes(p) || ephemeral[p.id]?.working)
            : all.filter((p) => which.includes(p.id));
    const reads = contextTargets(panes, agents).map((t) => {
      const seq = readSeq.current.get(t.sessionId) ?? { sent: 0, done: 0 };
      const mine = ++seq.sent;
      readSeq.current.set(t.sessionId, seq);
      return backend
        .sessionContext(t.kind, t.sessionId, accountById(accounts, all.find((p) => p.id === t.paneId)?.account)?.dir)
        .then((c) => {
          if (mine > seq.done) {
            seq.done = mine;
            const seen = seenTools.current.get(t.sessionId);
            const fresh = c === null ? [] : newTools(seen, c.tools);
            const last = c?.tools.at(-1)?.id;
            if (last !== undefined) seenTools.current.set(t.sessionId, last);
            else if (seen === undefined) seenTools.current.set(t.sessionId, null);
            const path = paneInfoRef.current.get(t.paneId)?.path ?? "";
            addFeed(t.paneId, fresh.map((tool) => toolText(tool, path, home.current)), "tool");
          }
          if (c === null) return;
          setContexts((prev) => {
            const old = prev[t.sessionId];
            return old?.tokens === c.tokens && old.model === c.model && old.title === c.title
              ? prev
              : { ...prev, [t.sessionId]: c };
          });
        })
        .catch(() => undefined); // brak odczytu = miernik bez zmian
    });
    return Promise.all(reads);
  };
  // Mierniki aktywnego projektu od razu po przełączeniu projektu i po zmianie rozmów w nim.
  const contextKey = contextTargets(active?.panes ?? [], agents)
    .map((t) => t.sessionId)
    .join(",");
  useEffect(() => {
    if (contextKey !== "") void readContexts.current("active");
  }, [contextKey]);
  // Nowa rozmowa gdziekolwiek: odczyt bazowy (stare wywołania to nie zdarzenia), potem co
  // CONTEXT_POLL_MS aktywny projekt + panele pracujące w schowanych (narzędzia do „Na żywo”).
  const allContextKey = contextTargets(ws.projects.flatMap((p) => p.panes), agents)
    .map((t) => t.sessionId)
    .join(",");
  useEffect(() => {
    if (allContextKey === "") return;
    void readContexts.current("all");
    const timer = setInterval(() => void readContexts.current("poll"), CONTEXT_POLL_MS);
    return () => clearInterval(timer);
  }, [allContextKey]);

  // Limity czytane po starcie: od razu, co LIMITS_POLL_MS i na przycisk.
  const limitSources = [
    { id: "", name: accounts.accounts.some((x) => x.kind === "claude") ? "Domyślne konto" : "Claude" },
    ...accounts.accounts.filter((x) => x.kind === "claude").map((x) => ({ id: x.id, name: x.name })),
  ];
  const readLimits = () => {
    // Konto domyślne (`""`) i każde konto Claude użytkownika, każde ma własny plik limitów.
    for (const id of limitSources.map((s) => s.id)) {
      void backend
        .claudeLimits(id || undefined)
        .then((l) => {
          if (l !== null) setLimits((prev) => (prev[id]?.at === l.at ? prev : { ...prev, [id]: l }));
        })
        .catch(() => undefined); // brak pliku = zostaje ostatni odczyt
    }
  };
  // Czytamy też bez pulpitu (jeden mały plik na konto): pasek „limit wyczerpany” w panelu musi wiedzieć o limicie.
  const watchLimits = loaded;
  useEffect(() => {
    if (!watchLimits) return;
    readLimits();
    const timer = setInterval(readLimits, LIMITS_POLL_MS);
    return () => clearInterval(timer);
  }, [watchLimits, accounts]);

  // `ping` kropeczki projektu (wzór D): praca skończyła się w siatce, której teraz nie widać.
  const [pingId, setPingId] = useState<string | null>(null);
  const pingTimer = useRef<number | null>(null);
  const pingRef = useRef<(projectId: string) => void>(() => {});
  pingRef.current = (projectId) => {
    setPingId(projectId);
    if (pingTimer.current !== null) clearTimeout(pingTimer.current);
    pingTimer.current = window.setTimeout(() => setPingId(null), PING_MS);
  };
  useEffect(
    () => () => {
      if (pingTimer.current !== null) clearTimeout(pingTimer.current);
    },
    [],
  );

  // 1 Hz: kropka „pracuje”, a gdy panel skończył pracę i nikt na niego nie patrzy — powiadomienie.
  useEffect(() => {
    const timer = setInterval(() => {
      const now = Date.now();
      const windowFocused = document.hasFocus();
      const updates: { id: string; working: boolean; finished: boolean }[] = [];
      for (const [id, a] of activity.current) {
        const r = activityTick(a, now);
        if (r.activity !== a) activity.current.set(id, r.activity);
        updates.push({ id, working: r.working, finished: r.finished });
      }
      if (updates.length === 0) return;
      setEphemeral((prev) => {
        let next: Record<string, PaneState> | null = null;
        for (const u of updates) {
          const cur = prev[u.id];
          if (cur === undefined && !u.working) continue; // nic do pokazania: nie mnożymy wpisów
          if ((cur?.working ?? false) === u.working) continue;
          next = next ?? { ...prev };
          next[u.id] = { ...cur, working: u.working };
        }
        return next ?? prev;
      });
      // Skończona praca: `st-done` (fala) na DONE_MS, potem zostaje `st-unread` albo nic.
      const finished = updates.filter((u) => u.finished).map((u) => u.id);
      if (finished.length > 0) {
        const setDone = (done: boolean) =>
          setEphemeral((prev) => {
            const ids = finished.filter((id) => id in prev || done); // zamknięte już nie wracają
            if (ids.length === 0) return prev;
            const next = { ...prev };
            for (const id of ids) next[id] = { ...prev[id], done };
            return next;
          });
        setDone(true);
        later(DONE_MS, () => setDone(false));
        // Agent właśnie dopisał turę do pliku sesji: jego ostatnie narzędzia wjeżdżają przed końcem pracy.
        void readContexts.current(finished).then(() => {
          for (const id of finished) addFeed(id, [FINISHED_TEXT]);
        });
        // Rozmowa głosowa trwa: mówi, kto skończył (w chwili ciszy).
        for (const id of finished) {
          const info = paneInfoRef.current.get(id);
          if (info) voiceNote.current?.(finishedNote({ agent: info.agent, title: titlesRef.current[id] ?? "", project: info.project }));
        }
      }
      for (const u of updates) {
        if (!u.finished) continue;
        if (u.id === focusedRef.current && windowFocused) continue; // exactly what is on screen
        const info = paneInfoRef.current.get(u.id);
        if (!info) continue;
        // Schowany projekt: kropka na szynie dostaje jednorazowy `ping`.
        if (info.projectId !== activeRef.current) pingRef.current(info.projectId);
        void backend
          .notify(`Agents: ${info.agent}`, `skończył pracę w ${info.project}`)
          .catch((e: unknown) => setErrors((prev) => [...prev, `powiadomienie: ${String(e)}`]));
      }
    }, TICK_MS);
    return () => clearInterval(timer);
  }, []);

  // Fokus panelu kasuje „nieprzeczytane” (też przy przejściu na inny projekt strzałką).
  useEffect(() => {
    if (focusedId === null) return;
    setEphemeral((prev) =>
      prev[focusedId]?.unread ? { ...prev, [focusedId]: { ...prev[focusedId], unread: false } } : prev,
    );
  }, [focusedId]);

  // Output while the window was in the background marks even the focused pane as unread;
  // coming back to the window means the user sees it now, and focusedId does not change then.
  useEffect(() => {
    const seen = () => {
      const id = focusedRef.current;
      if (id === null) return;
      setEphemeral((prev) => (prev[id]?.unread ? { ...prev, [id]: { ...prev[id], unread: false } } : prev));
    };
    window.addEventListener("focus", seen);
    return () => window.removeEventListener("focus", seen);
  }, []);

  // "Na pewno?" po Ctrl+Alt+W wraca do ✕ po CONFIRM_MS (tak jak przy kliknięciu).
  useEffect(() => {
    if (armedPane === null) return;
    const t = setTimeout(() => setArmedPane(null), CONFIRM_MS);
    return () => clearTimeout(t);
  }, [armedPane]);

  // Komunikat to toast: sam znika po TOAST_MS (błędy konfiguracji zostają do ✕).
  useEffect(() => {
    if (notice === null) return;
    const t = setTimeout(() => setNotice(null), TOAST_MS);
    return () => clearTimeout(t);
  }, [notice]);

  const closeByShortcut = (paneId: string) => {
    // Panel bez żywego procesu zamyka się od razu; z procesem trzeba potwierdzić.
    if (ephemeral[paneId]?.exited) {
      armRef.current = null;
      paneActions.close(paneId);
      return;
    }
    const r = confirmClick(armRef.current, `x:${paneId}`, Date.now());
    armRef.current = r.arm;
    if (r.fire) {
      setArmedPane(null);
      paneActions.close(paneId);
      return;
    }
    setArmedPane(paneId);
  };

  const runCommand = (cmd: Command) => {
    switch (cmd.type) {
      case "move":
        dispatch({ type: "move", dir: cmd.dir });
        break;
      case "swap":
        dispatch({ type: "swapDir", dir: cmd.dir });
        break;
      case "toggleMaximize":
        dispatch({ type: "toggleMaximize" }); // bez id = panel z fokusem
        break;
      case "newPane":
        projectActions.openPaneDialog();
        break;
      case "newProject":
        projectActions.addProject();
        break;
      case "toggleRail":
        dispatch({ type: "setUi", patch: { rail: ws.ui.rail === "open" ? "closed" : "open" } });
        break;
      case "toggleDock":
        dispatch({ type: "setUi", patch: { dock: !ws.ui.dock } });
        break;
      case "toggleChat":
        setMode(nextMode(mode));
        break;
      case "fontSize": {
        const size = stepFontSize(ws.ui.fontSize, cmd.step);
        dispatch({ type: "setUi", patch: { fontSize: size } });
        setNotice(`Czcionka terminali: ${size} px`);
        break;
      }
      case "selectProject": {
        const project = ws.projects[cmd.index]; // poza listą = nic
        if (project) dispatch({ type: "selectProject", id: project.id });
        break;
      }
      case "restartPane":
        if (focusedId !== null) paneActions.restart(focusedId);
        break;
      case "closePane":
        if (focusedId !== null) closeByShortcut(focusedId);
        break;
      case "copy": {
        const text = focusedId === null ? "" : (terms.current.get(focusedId)?.copySelection() ?? "");
        if (text === "") break; // brak zaznaczenia: nie nadpisujemy schowka
        void backend.copyText(text).catch((e: unknown) => setErrors((prev) => [...prev, `schowek: ${String(e)}`]));
        break;
      }
      case "paste": {
        void (async () => {
          try {
            const text = await backend.pasteText();
            if (text !== null && focusedId !== null) terms.current.get(focusedId)?.paste(text);
          } catch (e) {
            setErrors((prev) => [...prev, `schowek: ${String(e)}`]);
          }
        })();
        break;
      }
    }
  };

  // One capture-phase listener on the window: it runs before xterm, so a recognised
  // shortcut never reaches the process. The handler lives in a ref -> current state.
  const onKey = useRef<(e: KeyboardEvent) => void>(() => {});
  onKey.current = (e: KeyboardEvent) => {
    const cmd = commandFor(e);
    if (cmd === null) return;
    // W Czacie i Botach skróty siatki nie działają: Ctrl+Shift+C/V zostają dla pola tekstowego.
    if (mode !== "code" && cmd.type !== "toggleChat" && cmd.type !== "toggleRail") return;
    e.preventDefault();
    runCommand(cmd);
  };
  useEffect(() => {
    const h = (e: KeyboardEvent) => onKey.current(e);
    window.addEventListener("keydown", h, true);
    return () => window.removeEventListener("keydown", h, true);
  }, []);

  return (
    <div className={`shell${winMax ? " is-max" : ""}`}>
    {backend.window && <TitleBar win={backend.window} title={windowTitle} onMaximized={setWinMax} />}
    {backend.window && !winMax && <ResizeEdges win={backend.window} />}
    <div className={`app ${uiClasses(ws.ui)} mode-${mode}`}>
      {chatMounted && (
        <ChatView
          mode={mode}
          onMode={setMode}
          onTitle={setChatTitle}
          railOpen={ws.ui.rail === "open"}
          onToggleRail={() => dispatch({ type: "setUi", patch: { rail: ws.ui.rail === "open" ? "closed" : "open" } })}
          onOpenAppearance={() => setAppearance(true)}
        />
      )}
      {botMounted && (
        <BotView
          mode={mode}
          onMode={setMode}
          active={mode === "bot"}
          openRun={openRun}
          onTitle={setBotTitle}
          railOpen={ws.ui.rail === "open"}
          onToggleRail={() => dispatch({ type: "setUi", patch: { rail: ws.ui.rail === "open" ? "closed" : "open" } })}
          onOpenAppearance={() => setAppearance(true)}
        />
      )}
      <Rail
        mode={mode}
        onMode={setMode}
        ws={ws}
        agents={agents}
        state={ephemeral}
        titles={titles}
        pingId={pingId}
        onSelect={(id) => dispatch({ type: "selectProject", id })}
        onFocusPane={(id) => dispatch({ type: "focus", id })}
        onAddProject={projectActions.addProject}
        onRename={projectActions.rename}
        onRemove={projectActions.remove}
        onToggleRail={() =>
          dispatch({ type: "setUi", patch: { rail: ws.ui.rail === "open" ? "closed" : "open" } })
        }
        onOpenAppearance={() => setAppearance(true)}
        onOpenVoice={() => {
          setVoiceTab("dictation");
          setVoice(true);
        }}
        talking={talk}
        onToggleTalk={() => setTalk((t) => !t)}
      />
      <main className="area">
        {errors.length > 0 && (
          <div className="config-errors">
            <span>{errors.join(" · ")}</span>
            <IconButton icon={X} label="Zamknij błędy konfiguracji" onClick={() => setErrors([])} />
          </div>
        )}
        {!loaded ? (
          <div className="empty">
            <p>Wczytywanie…</p>
          </div>
        ) : ws.projects.length === 0 ? (
          <div className="empty">
            <p>Dodaj folder projektu</p>
            <button type="button" className="btn primary" onClick={projectActions.addProject}>
              <FolderPlus strokeWidth={1.75} aria-hidden /> Projekt
            </button>
          </div>
        ) : (
          <>
            <header className="area-head">
              <div className="area-title">
                <span className="area-name">{active?.name}</span>
                <span className="area-path" title={active?.path}>
                  {active?.path}
                </span>
              </div>
              <span className="area-count">
                {paneCount}/{MAX_PANES}
              </span>
              <button
                type="button"
                className={`btn${ws.ui.dock ? " is-on" : ""}`}
                title="Pulpit (Ctrl+Alt+D)"
                aria-pressed={ws.ui.dock}
                onClick={() => dispatch({ type: "setUi", patch: { dock: !ws.ui.dock } })}
              >
                <Gauge strokeWidth={1.75} aria-hidden /> Pulpit
              </button>
              <button type="button" className="btn" title="Konta agentów" onClick={() => setAccountsDialog(true)}>
                <UserRound strokeWidth={1.75} aria-hidden /> Konta
              </button>
              <button type="button" className="btn" onClick={() => setPresetMenu(true)} disabled={active === null}>
                <LayoutGrid strokeWidth={1.75} aria-hidden /> Presety
              </button>
              <button
                type="button"
                className="btn primary"
                title="Nowy panel (Ctrl+Alt+N)"
                onClick={projectActions.openPaneDialog}
                disabled={active === null || paneCount >= MAX_PANES}
              >
                <Plus strokeWidth={1.75} aria-hidden /> Panel
              </button>
            </header>
            <div className="grids">
              {theme.id === "mglawica" && (
                <Nebula still={!motionAllowed(ws.ui.motion, window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false)} />
              )}
              <Grid
                projects={ws.projects}
                activeId={ws.active}
                agents={agents}
                accounts={accounts}
                limits={limits}
                look={termLook}
                fontSize={ws.ui.fontSize}
                motion={ws.ui.motion}
                state={ephemeral}
                contexts={contexts}
                titles={titles}
                armedPane={armedPane}
                closing={closing}
                summarizing={summarizing}
                paneActions={paneActions}
                projectActions={projectActions}
              />
            </div>
          </>
        )}
        {!inElectron && <div className="preview-badge">podgląd – bez prawdziwych procesów</div>}
      </main>
      {loaded && ws.ui.dock && ws.projects.length > 0 && (
        <Dock
          project={active}
          agents={agents}
          contexts={contexts}
          titles={titles}
          onPickPane={(id) => dispatch({ type: "focus", id })}
          feedScope={ws.ui.feed}
          onFeedScope={(feed) => dispatch({ type: "setUi", patch: { feed } })}
          feed={feed}
          limits={limits}
          limitSources={limitSources}
          onRefreshLimits={readLimits}
          onPickFeed={(item) =>
            dispatch(
              paneInfo.has(item.paneId)
                ? { type: "focus", id: item.paneId } // przełącza też projekt
                : { type: "selectProject", id: item.projectId }, // panel już zamknięty
            )
          }
          onClose={() => dispatch({ type: "setUi", patch: { dock: false } })}
          radar={
            theme.id === "wieza"
              ? {
                  state: ephemeral,
                  quietMs: (id) => {
                    const last = activity.current.get(id)?.lastOutput ?? 0;
                    return last === 0 ? null : Date.now() - last;
                  },
                }
              : undefined
          }
        />
      )}
      {notice && (
        <div className="toast" role="status">
          <span>{notice}</span>
        </div>
      )}
      {appearance && (
        <AppearanceDialog
          ui={ws.ui}
          onSet={(patch) => dispatch({ type: "setUi", patch })}
          onClose={() => setAppearance(false)}
        />
      )}
      {continuePane !== null && (() => {
        const src = ws.projects.flatMap((p) => p.panes).find((p) => p.id === continuePane);
        const info = paneInfo.get(continuePane);
        if (!src || !info) return null;
        return (
          <ContinueDialog
            source={`${info.agent} · ${info.project}`}
            targets={continueTargets(src, agents, accounts)}
            canAdd={paneCount < MAX_PANES}
            onPick={(t) => void continueTo(continuePane, t)}
            onClose={() => setContinuePane(null)}
          />
        );
      })()}
      {accountsDialog && (
        <AccountsDialog
          value={accounts}
          pickDir={() => backend.pickDir()}
          canLogin={active !== null && paneCount < MAX_PANES}
          onLogin={(account) => {
            const agent = agents.find((x) => accountKind(x) === account.kind);
            if (!agent) return;
            setAccountsDialog(false);
            projectActions.addPane(agent.id, undefined, account.id);
          }}
          onChange={(next) => {
            setAccounts(next);
            void backend.saveAccounts(next).catch((e) => setErrors((prev) => [...prev, `accounts.json: ${String(e)}`]));
          }}
          onClose={() => setAccountsDialog(false)}
        />
      )}
      {talk && (
        <VoiceOrb
          host={voiceHost}
          noteRef={voiceNote}
          onClose={() => setTalk(false)}
          onOpenSettings={(tab) => {
            setVoiceTab(tab);
            setVoice(true);
          }}
        />
      )}
      {voice && (
        <VoiceDialog
          tab={voiceTab}
          config={stt}
          onSave={async (next) => {
            await backend.sttSaveConfig(next);
            setStt(next);
          }}
          onClose={() => setVoice(false)}
        />
      )}
      {presetMenu && active && (
        <PresetMenu
          custom={ws.presets}
          agents={agents}
          canSave={paneCount > 0}
          onApply={projectActions.applyPreset}
          onDelete={(name) => dispatch({ type: "deletePreset", name })}
          onSave={(name) => dispatch({ type: "savePreset", name })}
          onClose={() => setPresetMenu(false)}
        />
      )}
      {dialog && active && (
        <NewPaneDialog
          projectName={active.name}
          agents={agents}
          accounts={accounts}
          startIndex={lastIndex}
          onPick={(i, model, account) => {
            const agent = agents[i];
            if (agent) projectActions.addPane(agent.id, model, account);
          }}
          onClose={() => setDialog(false)}
        />
      )}
    </div>
    </div>
  );
}
