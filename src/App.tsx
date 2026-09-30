import { useEffect, useMemo, useReducer, useRef, useState } from "react";
import { backend, inTauri } from "./backend";
import type { AgentDef } from "./agents";
import { ACCENT_HEX, uiClasses } from "./ui";
import { IconButton } from "./IconButton";
import { FolderPlus, Gauge, LayoutGrid, Plus, X } from "lucide-react";
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
import { Dock } from "./Dock";
import { CONTEXT_POLL_MS, contextKind, contextTargets, type SessionContext } from "./context";
import { handoffText } from "./handoff";
import { FINISHED_TEXT, STARTED_TEXT, exitedText, newTools, pushFeed, toolText, type FeedItem } from "./feed";
import { LIMITS_POLL_MS, type ClaudeLimits } from "./limits";
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
import type { PaneActions, ProjectActions } from "./handlers";

export function App() {
  const [ws, dispatch] = useReducer(reduce, emptyWorkspace);
  const [agents, setAgents] = useState<AgentDef[]>([]);
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
  const [limits, setLimits] = useState<ClaudeLimits | null>(null);
  // Ostatnie pokazane wywołanie narzędzia według sessionId; brak klucza = jeszcze nie czytano.
  const seenTools = useRef(new Map<string, string | null>());
  // Numer odczytu według sessionId: odpowiedź starsza od już obsłużonej nie dubluje zdarzeń.
  const readSeq = useRef(new Map<string, { sent: number; done: number }>());
  const [notice, setNotice] = useState<string | null>(null);
  const [dialog, setDialog] = useState(false);
  const [presetMenu, setPresetMenu] = useState(false);
  const [appearance, setAppearance] = useState(false);
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
  // xterm nie zna klas CSS — kolor akcentu jedzie do terminala jako wartość (etap 1 M2).
  const accentHex = ACCENT_HEX[ws.ui.accent];
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

  const paneActions: PaneActions = {
    focus: (paneId) => dispatch({ type: "focus", id: paneId }),
    restart: (paneId) => {
      forget([paneId]);
      dispatch({ type: "restart", id: paneId });
    },
    toggleMaximize: (paneId) => dispatch({ type: "toggleMaximize", id: paneId }),
    swap: (a, b) => dispatch({ type: "swap", a, b }),
    handoff: (from, to) => void sendContext(from, to),
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
    addPane: (agentId) => {
      const agent = agents.find((a) => a.id === agentId);
      if (!agent || paneCount >= MAX_PANES) return;
      setDialog(false);
      setLastAgentId(agent.id);
      const pane: Pane = { id: crypto.randomUUID(), agentId: agent.id, run: 1 };
      if (agent.session) pane.sessionId = crypto.randomUUID();
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

  // Tylko refy i settery: woła to też interwał sprzed wielu renderów.
  const addFeed = (paneId: string, texts: string[]) => {
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
    const h = await backend.sessionHandoff(kind, pane.sessionId).catch(() => null);
    if (!h) {
      setNotice(`Nie udało się odczytać rozmowy „${src.agent}”`);
      return;
    }
    term.paste(handoffText(h, { agent: src.agent, project: src.project, projectPath: src.path, home: home.current }));
    dispatch({ type: "focus", id: to });
    setNotice(`Wklejono kontekst z „${src.agent}” – dopisz polecenie i wciśnij Enter`);
    addFeed(from, [`przekazał kontekst → ${dst.agent}`]);
  };

  const activeRef = useRef(ws.active);
  activeRef.current = ws.active;

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
        .sessionContext(t.kind, t.sessionId)
        .then((c) => {
          if (mine > seq.done) {
            seq.done = mine;
            const seen = seenTools.current.get(t.sessionId);
            const fresh = c === null ? [] : newTools(seen, c.tools);
            const last = c?.tools.at(-1)?.id;
            if (last !== undefined) seenTools.current.set(t.sessionId, last);
            else if (seen === undefined) seenTools.current.set(t.sessionId, null);
            const path = paneInfoRef.current.get(t.paneId)?.path ?? "";
            addFeed(t.paneId, fresh.map((tool) => toolText(tool, path, home.current)));
          }
          if (c === null) return;
          setContexts((prev) => {
            const old = prev[t.sessionId];
            return old?.tokens === c.tokens && old.model === c.model ? prev : { ...prev, [t.sessionId]: c };
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

  // Limity czytane tylko przy otwartym pulpicie: od razu, co LIMITS_POLL_MS i na przycisk.
  const readLimits = () => {
    void backend
      .claudeLimits()
      .then((l) => {
        if (l !== null) setLimits((prev) => (prev?.at === l.at ? prev : l));
      })
      .catch(() => undefined); // brak pliku = zostaje ostatni odczyt
  };
  const dockOpen = loaded && ws.ui.dock;
  useEffect(() => {
    if (!dockOpen) return;
    readLimits();
    const timer = setInterval(readLimits, LIMITS_POLL_MS);
    return () => clearInterval(timer);
  }, [dockOpen]);

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
    e.preventDefault();
    runCommand(cmd);
  };
  useEffect(() => {
    const h = (e: KeyboardEvent) => onKey.current(e);
    window.addEventListener("keydown", h, true);
    return () => window.removeEventListener("keydown", h, true);
  }, []);

  return (
    <div className={`app ${uiClasses(ws.ui)}`}>
      <Rail
        ws={ws}
        agents={agents}
        state={ephemeral}
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
              <Grid
                projects={ws.projects}
                activeId={ws.active}
                agents={agents}
                accent={accentHex}
                motion={ws.ui.motion}
                state={ephemeral}
                contexts={contexts}
                armedPane={armedPane}
                closing={closing}
                paneActions={paneActions}
                projectActions={projectActions}
              />
            </div>
          </>
        )}
        {!inTauri && <div className="preview-badge">podgląd – bez prawdziwych procesów</div>}
      </main>
      {loaded && ws.ui.dock && ws.projects.length > 0 && (
        <Dock
          project={active}
          agents={agents}
          contexts={contexts}
          feed={feed}
          limits={limits}
          onRefreshLimits={readLimits}
          onPickFeed={(item) =>
            dispatch(
              paneInfo.has(item.paneId)
                ? { type: "focus", id: item.paneId } // przełącza też projekt
                : { type: "selectProject", id: item.projectId }, // panel już zamknięty
            )
          }
          onClose={() => dispatch({ type: "setUi", patch: { dock: false } })}
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
          startIndex={lastIndex}
          onPick={(i) => {
            const agent = agents[i];
            if (agent) projectActions.addPane(agent.id);
          }}
          onClose={() => setDialog(false)}
        />
      )}
    </div>
  );
}
