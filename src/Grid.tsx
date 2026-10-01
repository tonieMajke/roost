import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type DragEvent } from "react";
import { pathForFile } from "./backend-electron";
import { droppedPaths, hasFiles } from "./drop";
import { gridShape, type Project } from "./workspace";
import { Plus } from "lucide-react";
import { BUILT_IN_PRESETS } from "./presets";
import type { AgentDef } from "./agents";
import { accountById, type Accounts } from "./accounts";
import type { PaneState } from "./activity";
import { limitHit, type ClaudeLimits } from "./limits";
import { contextKind, paneMeter, type SessionContext } from "./context";
import type { PaneActions, ProjectActions } from "./handlers";
import { Pane } from "./Pane";
import type { TermLook } from "./Terminal";
import { usePaneDrag } from "./usePaneDrag";
import {
  ENTER_WINDOW_MS,
  FLIP_EASE,
  FLIP_MS,
  enterClass,
  enterDelayMs,
  flipTransform,
  maxOrigin,
  motionAllowed,
  mountOrder,
  type Box,
} from "./motion";

type Props = {
  projects: Project[];
  activeId: string | null;
  agents: AgentDef[];
  accounts: Accounts;
  /** Limity Claude według id konta (`""` = domyślne): pasek „limit wyczerpany” w panelu. */
  limits: Record<string, ClaudeLimits>;
  /** Kolory i font xtermu (motyw + akcent) — zmiana bez restartu procesu. */
  look: TermLook;
  /** Rozmiar czcionki terminali (px, `ui.fontSize`). */
  fontSize: number;
  /** Ustawienie „Ruch” (`ui.motion`): `lite` wyłącza FLIP, wzrost i wjazd. */
  motion: "full" | "lite";
  state: Record<string, PaneState>; // stan ulotny (exit + aktywność), patrz src/activity.ts
  /** Ostatni odczyt kontekstu według `sessionId` (miernik `.ctx`). */
  contexts: Record<string, SessionContext>;
  /** Tytuł rozmowy według id panelu (`paneTitles`). */
  titles: Record<string, string>;
  /** Panel, dla którego skrót z klawiatury uzbroił „Na pewno?” (etap 8). */
  armedPane: string | null;
  /** Panele w trakcie animacji zamknięcia (`is-closing`). */
  closing: ReadonlySet<string>;
  /** Panele, do których Haiku streszcza przekazywany kontekst (plakietka „streszczam…”). */
  summarizing: readonly string[];
  paneActions: PaneActions;
  projectActions: ProjectActions;
};

const NO_STATE: PaneState = {};

const agentById = (agents: AgentDef[], id: string) => agents.find((a) => a.id === id);

const reducedMotion = () => window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;

/** Layout boxes of the visible cells; offset* ignores transforms, so a running FLIP does not skew them. */
function measure(grid: HTMLElement): Map<string, Box> {
  const boxes = new Map<string, Box>();
  for (const cell of grid.querySelectorAll<HTMLElement>(":scope > .pane-cell")) {
    const id = cell.dataset.pane;
    if (!id || cell.offsetWidth === 0) continue; // hidden behind a maximized pane
    boxes.set(id, { x: cell.offsetLeft, y: cell.offsetTop, w: cell.offsetWidth, h: cell.offsetHeight });
  }
  return boxes;
}

/**
 * One grid per project, all of them mounted: switching projects hides a grid with
 * `display: none`, it never unmounts (unmounting would kill the processes).
 */
export function Grid({
  projects,
  activeId,
  agents,
  accounts,
  limits,
  look,
  fontSize,
  motion,
  state,
  contexts,
  titles,
  armedPane,
  closing,
  summarizing,
  paneActions,
  projectActions,
}: Props) {
  // Wjazd siatki po przełączeniu projektu (wzór D: slideNext/slidePrev + panele kolejno).
  const [shown, setShown] = useState(activeId);
  const [enter, setEnter] = useState<{ id: string; cls: string | null; at: number } | null>(null);
  if (activeId !== shown) {
    // React's "state from the previous render" pattern: no extra frame without the class.
    setShown(activeId);
    const cls = enterClass(projects.map((p) => p.id), shown, activeId);
    setEnter(activeId === null || cls === null ? null : { id: activeId, cls, at: Date.now() });
  }
  useEffect(() => {
    if (enter === null) return;
    // Po wjeździe zdejmujemy opóźnienia: panel dodany później nie może czekać.
    const t = setTimeout(() => setEnter(null), ENTER_WINDOW_MS);
    return () => clearTimeout(t);
  }, [enter]);

  // FLIP: pudełka komórek sprzed zmiany układu, per projekt.
  const gridEls = useRef(new Map<string, HTMLDivElement>());
  const boxes = useRef(new Map<string, Map<string, Box>>());
  const lastActive = useRef<string | null>(null);
  const active = projects.find((p) => p.id === activeId);
  const projectIds = projects.map((p) => p.id).join(",");
  const layoutKey = active ? `${active.panes.map((p) => p.id).join(",")}|${active.maximized ?? ""}` : "";

  useLayoutEffect(() => {
    const el = activeId === null ? undefined : gridEls.current.get(activeId);
    if (!el || activeId === null) return;
    const prev = boxes.current.get(activeId);
    const next = measure(el);
    boxes.current.set(activeId, next);
    const sameProject = lastActive.current === activeId;
    lastActive.current = activeId;
    // Maksymalizacja ma własny wzrost (`is-maxed`); przełączenie projektu – wjazd.
    if (!prev || !sameProject || active?.maximized || !motionAllowed(motion, reducedMotion())) return;
    for (const cell of el.querySelectorAll<HTMLElement>(":scope > .pane-cell")) {
      const id = cell.dataset.pane;
      const a = id ? prev.get(id) : undefined;
      const b = id ? next.get(id) : undefined;
      const from = a && b ? flipTransform(a, b) : null;
      if (!from) continue;
      cell.animate(
        [
          { transformOrigin: "0 0", transform: from },
          { transformOrigin: "0 0", transform: "none" },
        ],
        { duration: FLIP_MS, easing: FLIP_EASE },
      );
    }
    // Only structural changes animate; the rest of the renders (activity, focus) do not measure.
  }, [activeId, layoutKey]);

  // Okno, szyna albo pulpit zmieniły rozmiar siatki: następny FLIP musi startować z aktualnych pudełek.
  useEffect(() => {
    const observer = new ResizeObserver((entries) => {
      for (const e of entries) {
        const el = e.target as HTMLDivElement;
        const id = el.dataset.project;
        if (id && el.offsetWidth > 0) boxes.current.set(id, measure(el));
      }
    });
    for (const el of gridEls.current.values()) observer.observe(el);
    return () => observer.disconnect();
  }, [projectIds]);

  const drag = usePaneDrag({
    enabled: !!active && active.panes.length > 1 && active.maximized === null,
    animate: motionAllowed(motion, reducedMotion()),
    onDrop: (from, to) => paneActions.swap(from, to),
    canSend: (id) => {
      const pane = active?.panes.find((p) => p.id === id);
      return !!pane?.sessionId && contextKind(agentById(agents, pane.agentId)) !== null;
    },
    canReceive: (id) => !state[id]?.exited && paneActions.acceptsPaste(id),
    onHandoff: (from, to) => paneActions.handoff(from, to),
  });

  // Pliki z menedżera plików (natywne HTML5 drag&drop; przeciąganie nagłówków to zdarzenia
  // pointer, więc się nie mieszają). Podświetlenie: `data-drop` na komórce, bez renderu Reacta.
  const clearDrop = () => {
    for (const el of document.querySelectorAll("[data-drop]")) el.removeAttribute("data-drop");
  };
  const onFileOver = (e: DragEvent<HTMLDivElement>) => {
    if (!hasFiles(e.dataTransfer.types)) return;
    e.preventDefault(); // bez tego upuszczenie nie wystartuje
    const found = (e.target as HTMLElement).closest<HTMLElement>(".pane-cell");
    // Panel z zakończonym procesem nie ma komu odebrać ścieżki.
    const cell = found && !state[found.dataset.pane ?? ""]?.exited ? found : null;
    e.dataTransfer.dropEffect = cell ? "copy" : "none";
    if (cell?.dataset.drop) return;
    clearDrop();
    cell?.setAttribute("data-drop", "file");
  };
  const onFileLeave = (e: DragEvent<HTMLDivElement>) => {
    const to = e.relatedTarget as Node | null;
    if (!to || !e.currentTarget.contains(to)) clearDrop();
  };
  const onFileDrop = (e: DragEvent<HTMLDivElement>) => {
    if (!hasFiles(e.dataTransfer.types)) return;
    e.preventDefault();
    clearDrop();
    const id = (e.target as HTMLElement).closest<HTMLElement>(".pane-cell")?.dataset.pane;
    if (!id || state[id]?.exited) return;
    const paths = droppedPaths(e.dataTransfer.files, pathForFile);
    if (paths.length) paneActions.dropFiles(id, paths);
  };
  // Plik upuszczony obok paneli (pasek, szyna) nie może nawigować okna do `file://`.
  useEffect(() => {
    const stop = (e: globalThis.DragEvent) => {
      if (hasFiles(e.dataTransfer?.types)) e.preventDefault();
    };
    const end = () => clearDrop();
    window.addEventListener("dragover", stop);
    window.addEventListener("drop", stop);
    window.addEventListener("drop", end);
    window.addEventListener("dragend", end);
    return () => {
      window.removeEventListener("dragover", stop);
      window.removeEventListener("drop", stop);
      window.removeEventListener("drop", end);
      window.removeEventListener("dragend", end);
    };
  }, []);

  // Węzły komórek w kolejności utworzenia: zamiana paneli zmienia tylko `order` (patrz mountOrder).
  const mounted = useRef(new Map<string, readonly string[]>());
  const domOrder = (project: Project) => {
    const order = mountOrder(mounted.current.get(project.id) ?? [], project.panes.map((p) => p.id));
    mounted.current.set(project.id, order);
    const byId = new Map(project.panes.map((p) => [p.id, p]));
    return order.map((id) => byId.get(id)!);
  };

  const now = Date.now();
  return (
    <>
      {projects.map((project) => {
        const isActive = project.id === activeId;
        const n = project.panes.length;
        const { cols, rows } = gridShape(n);
        const maximized = isActive && project.maximized !== null;
        const entering = enter !== null && enter.id === project.id ? enter : null;
        return (
          <div
            key={project.id}
            ref={(el) => {
              if (el) gridEls.current.set(project.id, el);
              else gridEls.current.delete(project.id);
            }}
            data-project={project.id}
            onPointerDown={isActive ? drag.onPointerDown : undefined}
            onDragOver={onFileOver}
            onDragLeave={onFileLeave}
            onDrop={onFileDrop}
            className={`grid${entering?.cls ? ` ${entering.cls}` : ""}`}
            style={{
              display: isActive ? "grid" : "none",
              gridTemplateColumns: `repeat(${maximized ? 1 : cols}, minmax(0, 1fr))`,
              gridTemplateRows: `repeat(${maximized ? 1 : rows}, minmax(0, 1fr))`,
            }}
          >
            {n === 0 ? (
              <div className="empty">
                <p>Brak paneli w tym projekcie</p>
                <div className="empty-actions">
                  <button type="button" className="btn primary" onClick={projectActions.openPaneDialog}>
                    <Plus strokeWidth={1.75} aria-hidden /> Panel
                  </button>
                  {BUILT_IN_PRESETS.map((preset) => (
                    <button key={preset.name} type="button" onClick={() => projectActions.applyPreset(preset)}>
                      {preset.name}
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              domOrder(project).map((pane) => {
                const i = project.panes.indexOf(pane); // miejsce w siatce (CSS `order`)
                const isMax = project.maximized === pane.id;
                const delay = enterDelayMs(i, entering ? now - entering.at : null);
                return (
                  <div
                    key={pane.id}
                    data-pane={pane.id}
                    data-busy={summarizing.includes(pane.id) ? "summary" : undefined}
                    className={`pane-cell${isMax ? " is-maxed" : ""}`}
                    style={
                      {
                        display: project.maximized && !isMax ? "none" : "flex",
                        order: i,
                        // Wzrost zmaksymalizowanego panelu zaczyna się z jego miejsca w siatce.
                        transformOrigin: isMax ? maxOrigin(i, n) : undefined,
                        "--enter-delay": delay > 0 ? `${delay}ms` : undefined,
                      } as CSSProperties
                    }
                  >
                    <Pane
                      pane={pane}
                      path={project.path}
                      agent={agentById(agents, pane.agentId)}
                      account={accountById(accounts, pane.account)}
                      showAccount={accounts.accounts.length > 0}
                      limitHit={agentById(agents, pane.agentId)?.command.split("/").pop() === "claude" ? limitHit(limits[pane.account ?? ""], Date.now()) : null}
                      canContinue={Boolean(pane.sessionId) && contextKind(agentById(agents, pane.agentId)) !== null}
                      look={look}
                      fontSize={fontSize}
                      focused={isActive && pane.id === project.focused}
                      maximized={isMax}
                      state={state[pane.id] ?? NO_STATE}
                      meter={paneMeter(pane, agentById(agents, pane.agentId), contexts)}
                      title={titles[pane.id]}
                      closing={closing.has(pane.id)}
                      armed={pane.id === armedPane}
                      actions={paneActions}
                    />
                  </div>
                );
              })
            )}
          </div>
        );
      })}
    </>
  );
}
