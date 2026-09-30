import { useEffect, useRef, type PointerEvent as ReactPointerEvent } from "react";
import {
  BUBBLE_PX,
  DROP_MS,
  MORPH_MS,
  boxCenter,
  dragMode,
  dropTarget,
  modeTarget,
  follow,
  pastThreshold,
  shrinkTo,
  stretch,
  type DragMode,
  type Point,
} from "./drag";

/** Czas „wsiąkania” kontekstu w panel docelowy (fala jak przy końcu pracy). */
const SOAK_MS = 700;

// Ikona `Send` z lucide (ducha tworzymy poza Reactem).
const SEND_SVG =
  '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14.536 21.686a.5.5 0 0 0 .937-.024l6.5-19a.496.496 0 0 0-.635-.635l-19 6.5a.5.5 0 0 0-.024.937l7.93 3.18a2 2 0 0 1 1.112 1.11z"/><path d="m21.854 2.147-10.94 10.939"/></svg>';
import type { Box } from "./motion";

type Options = {
  /** false: 1 panel, maksymalizacja albo brak aktywnego projektu. */
  enabled: boolean;
  /** Ruch dekoracyjny (motionAllowed): bez niego żeton bez zwijania, sprężyny i powrotu. */
  animate: boolean;
  onDrop(from: string, to: string): void;
  /** Panel ma rozmowę, z której da się zrobić wyciąg (claude/pi z `session`). */
  canSend(id: string): boolean;
  /** Panel może przyjąć wklejenie (proces działa). */
  canReceive(id: string): boolean;
  /** Upuszczenie z Shiftem: wyciąg rozmowy `from` wklejony do `to`. */
  onHandoff(from: string, to: string): void;
};

type Session = {
  id: string;
  pointerId: number;
  start: Point;
  pointer: Point;
  grid: HTMLElement;
  cell: HTMLElement;
  shift: boolean;
  mode: DragMode;
  // Od startu lotu:
  boxes?: Map<string, Box>;
  target?: string | null;
  ghost?: HTMLElement;
  blob?: HTMLElement;
  pos?: Point;
  vel?: Point;
  last?: number;
  raf?: number;
};

const rect = (el: Element): Box => {
  const r = el.getBoundingClientRect();
  return { x: r.left, y: r.top, w: r.width, h: r.height };
};

const translate = (p: Point) => `translate(${p.x - BUBBLE_PX / 2}px, ${p.y - BUBBLE_PX / 2}px)`;

const cellOf = (grid: HTMLElement, id: string) =>
  grid.querySelector<HTMLElement>(`:scope > .pane-cell[data-pane="${CSS.escape(id)}"]`);

/**
 * Przeciąganie panelu za nagłówek (M4 etap 2). Stan lotu żyje w refach i w DOM
 * (duch w `.app`, `data-drag` na komórkach), więc lot nie renderuje Reacta co klatkę.
 * Zwraca uchwyt `onPointerDown` dla elementu `.grid`.
 */
export function usePaneDrag(opts: Options) {
  const optsRef = useRef(opts);
  optsRef.current = opts;
  // Jedna instancja na komponent: nasłuchy okna muszą być tymi samymi funkcjami przy zdejmowaniu.
  const drag = useRef<ReturnType<typeof createDrag> | null>(null);
  drag.current ??= createDrag(optsRef);
  const { dispose } = drag.current;
  // Odmontowanie w trakcie lotu: sprzątamy bez animacji.
  useEffect(() => dispose, [dispose]);
  return { onPointerDown: drag.current.onPointerDown };
}

function createDrag(optsRef: { readonly current: Options }) {
  const session: { current: Session | null } = { current: null };

  function setMark(cell: Element | null | undefined, mark: string | null) {
    if (!cell) return;
    if (mark) cell.setAttribute("data-drag", mark);
    else cell.removeAttribute("data-drag");
  }

  function begin(s: Session) {
    const app = s.grid.closest(".app") ?? document.body;
    s.boxes = new Map();
    for (const cell of s.grid.querySelectorAll<HTMLElement>(":scope > .pane-cell")) {
      if (cell.dataset.pane && cell.offsetWidth > 0) s.boxes.set(cell.dataset.pane, rect(cell));
    }
    s.target = null;
    s.pos = { ...s.pointer };
    s.vel = { x: 0, y: 0 };
    s.last = performance.now();
    window.getSelection()?.removeAllRanges();
    app.classList.add("is-dragging");

    const pane = s.cell.querySelector<HTMLElement>(".pane");
    const color = pane ? getComputedStyle(pane).getPropertyValue("--ag").trim() : "";
    const letter = s.cell.querySelector(".ag-badge")?.textContent ?? "";

    const ghost = document.createElement("div");
    ghost.className = "drag-ghost";
    if (color) ghost.style.setProperty("--ag", color);
    ghost.style.transform = translate(s.pos);
    ghost.innerHTML =
      `<div class="drag-pop"><div class="drag-blob"></div><span class="drag-letter"></span>` +
      `<span class="drag-send">${SEND_SVG}</span></div><span class="drag-label"></span>`;
    ghost.querySelector(".drag-letter")!.textContent = letter;
    app.appendChild(ghost);
    s.ghost = ghost;
    s.blob = ghost.querySelector<HTMLElement>(".drag-blob")!;
    setMark(s.cell, "lifted");
    update(s);

    if (optsRef.current.animate) {
      morph(app, rect(s.cell), s.pointer, color, false);
      s.raf = requestAnimationFrame((t) => frame(t));
    } else {
      ghost.classList.add("is-still");
    }
  }

  /** Obrys panelu zwija się w kulkę (albo rozwija z niej przy powrocie). Tylko transform/opacity + promień. */
  function morph(app: Element, box: Box, p: Point, color: string, reverse: boolean) {
    const shell = document.createElement("div");
    shell.className = "drag-shell";
    if (color) shell.style.setProperty("--ag", color);
    Object.assign(shell.style, { left: `${box.x}px`, top: `${box.y}px`, width: `${box.w}px`, height: `${box.h}px` });
    app.appendChild(shell);
    // Obrys widać przez większość drogi, znika dopiero przy kulce.
    const open = { transform: "none", borderRadius: "var(--r-pane)", opacity: 1 };
    const near = { opacity: 0.8, offset: 0.7 };
    const shut = { transform: shrinkTo(box, p), borderRadius: "50%", opacity: 0 };
    const frames = reverse ? [shut, { ...near, offset: 0.3 }, open] : [open, near, shut];
    const anim = shell.animate(frames, {
      duration: MORPH_MS,
      easing: "cubic-bezier(.2,.8,.2,1)",
      fill: "forwards",
    });
    anim.onfinish = anim.oncancel = () => shell.remove();
  }

  function frame(now: number) {
    const s = session.current;
    if (!s?.ghost || !s.pos || !s.vel || s.last === undefined) return;
    const dt = Math.min(64, now - s.last); // po schowaniu okna nie skaczemy
    s.last = now;
    const next = follow(s.pos, s.pointer, dt);
    if (dt > 0) s.vel = { x: (next.x - s.pos.x) / dt, y: (next.y - s.pos.y) / dt };
    s.pos = next;
    s.ghost.style.transform = translate(next);
    const { angle, scale } = stretch(s.vel);
    s.blob!.style.transform = `rotate(${angle}deg) scale(${scale}, ${1 / scale})`;
    s.raf = requestAnimationFrame(frame);
  }

  function move(e: PointerEvent) {
    const s = session.current;
    if (!s || e.pointerId !== s.pointerId) return;
    s.pointer = { x: e.clientX, y: e.clientY };
    if (!s.ghost) {
      if (pastThreshold(s.start, s.pointer)) begin(s);
      return;
    }
    if (!optsRef.current.animate) s.ghost.style.transform = translate(s.pointer);
    s.shift = e.shiftKey;
    update(s);
  }

  /** Tryb (Shift) i cel pod kursorem → klasy ducha i znacznik celu. */
  function update(s: Session) {
    const o = optsRef.current;
    const mode = dragMode(s.shift, o.canSend(s.id));
    const target = modeTarget(mode, dropTarget(s.boxes!, s.pointer, s.id), o.canReceive);
    if (mode !== s.mode || !s.ghost!.dataset.mode) {
      s.mode = mode;
      s.ghost!.dataset.mode = mode;
      s.ghost!.querySelector(".drag-label")!.textContent =
        mode === "handoff" ? "kontekst →" : mode === "blocked" ? "brak rozmowy" : "";
    }
    const mark = mode === "handoff" ? "handoff" : "target";
    const cell = target ? cellOf(s.grid, target) : null;
    if (target !== s.target || (cell && cell.dataset.drag !== mark)) {
      if (s.target && s.target !== target) setMark(cellOf(s.grid, s.target), null);
      setMark(cell, mark);
      s.target = target;
    }
  }

  function up(e: PointerEvent) {
    const s = session.current;
    if (!s || e.pointerId !== s.pointerId) return;
    finish(true);
  }

  function cancel() {
    finish(false);
  }

  function key(e: KeyboardEvent) {
    const s = session.current;
    if (!s?.ghost || (e.key !== "Escape" && e.key !== "Shift")) return;
    // W locie Esc i Shift należą do przeciągania, nie do terminala.
    e.preventDefault();
    e.stopPropagation();
    if (e.key === "Escape") {
      if (e.type === "keydown") finish(false);
      return;
    }
    s.shift = e.type === "keydown"; // Shift bez ruchu myszy też przełącza tryb
    update(s);
  }

  function listen(on: boolean) {
    const f = on ? window.addEventListener : window.removeEventListener;
    f("pointermove", move);
    f("pointerup", up);
    f("pointercancel", cancel);
    f("blur", cancel);
    f("keydown", key, true);
    f("keyup", key, true);
  }

  function finish(drop: boolean, instant = false) {
    const s = session.current;
    session.current = null;
    listen(false);
    if (!s) return;
    if (s.raf !== undefined) cancelAnimationFrame(s.raf);
    if (!s.ghost) return; // zwykły klik
    const app = s.grid.closest(".app") ?? document.body;
    app.classList.remove("is-dragging");
    if (s.target) setMark(cellOf(s.grid, s.target), null);
    const ghost = s.ghost;
    const animate = optsRef.current.animate && !instant;
    const target = drop ? s.target : null;
    const from = s.pos ?? s.pointer;

    if (target && s.mode === "handoff") {
      optsRef.current.onHandoff(s.id, target);
      setMark(s.cell, null);
      if (!animate) return ghost.remove();
      // Kulka wsiąka w cel, cel odpowiada falą.
      const cell = cellOf(s.grid, target);
      const to = boxCenter(s.boxes!.get(target)!);
      const anim = ghost.animate(
        [
          { transform: translate(from), opacity: 1 },
          { transform: `${translate(to)} scale(0)`, opacity: 0.6 },
        ],
        { duration: DROP_MS + 60, easing: "cubic-bezier(.5,0,.8,.4)", fill: "forwards" },
      );
      anim.onfinish = anim.oncancel = () => {
        ghost.remove();
        setMark(cell, "soak");
        setTimeout(() => cell?.dataset.drag === "soak" && setMark(cell, null), SOAK_MS);
      };
      return;
    }

    if (target) {
      optsRef.current.onDrop(s.id, target);
      setMark(s.cell, null);
      if (!animate) return ghost.remove();
      const to = boxCenter(s.boxes!.get(target)!);
      const anim = ghost.animate(
        [
          { transform: translate(from), opacity: 1 },
          { transform: `${translate(to)} scale(0.2)`, opacity: 0 },
        ],
        { duration: DROP_MS, easing: "ease-in", fill: "forwards" },
      );
      anim.onfinish = anim.oncancel = () => ghost.remove();
      return;
    }

    if (!animate) {
      setMark(s.cell, null);
      return ghost.remove();
    }
    // Powrót: kulka wraca na środek źródła i rozwija się w panel.
    const box = s.boxes!.get(s.id) ?? rect(s.cell);
    const home = boxCenter(box);
    const color = ghost.style.getPropertyValue("--ag");
    const back = ghost.animate([{ transform: translate(from) }, { transform: translate(home) }], {
      duration: DROP_MS,
      easing: "cubic-bezier(.2,.8,.2,1)",
      fill: "forwards",
    });
    back.onfinish = back.oncancel = () => {
      ghost.remove();
      morph(app, box, home, color, true);
      setMark(s.cell, null);
    };
  }

  const onPointerDown = (e: ReactPointerEvent<HTMLElement>) => {
    if (!optsRef.current.enabled || e.button !== 0 || session.current) return;
    const el = e.target as HTMLElement;
    if (!el.closest(".pane-head") || el.closest(".tools, button, input")) return;
    const cell = el.closest<HTMLElement>(".pane-cell");
    const id = cell?.dataset.pane;
    if (!cell || !id) return;
    session.current = {
      id,
      pointerId: e.pointerId,
      start: { x: e.clientX, y: e.clientY },
      pointer: { x: e.clientX, y: e.clientY },
      grid: e.currentTarget,
      cell,
      shift: e.shiftKey,
      mode: "swap",
    };
    listen(true);
  };

  return { onPointerDown, dispose: () => finish(false, true) };
}
