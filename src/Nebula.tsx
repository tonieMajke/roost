import { useEffect, useRef } from "react";
import { rateFor, step, type Emitter, type Particle } from "./nebula";

/** Kolory agentów (`--ag`, #rrggbb) jako "r,g,b" do rgba(); nierozpoznane = akcent mgławicy. */
function rgb(hex: string): string {
  const m = /^#([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return "179,155,255";
  const n = Number.parseInt(m[1]!, 16);
  return `${(n >> 16) & 255},${(n >> 8) & 255},${n & 255}`;
}

/** Emitery z widocznych paneli: środek komórki, kolor agenta, tempo ze stanu `st-*`. */
function readEmitters(root: HTMLElement): Emitter[] {
  const box = root.getBoundingClientRect();
  const out: Emitter[] = [];
  for (const cell of root.querySelectorAll<HTMLElement>(".pane-cell[data-pane]")) {
    if (cell.offsetParent === null) continue; // siatka nieaktywnego projektu
    const pane = cell.querySelector<HTMLElement>(".pane");
    if (!pane) continue;
    const r = cell.getBoundingClientRect();
    const { rate, ring } = rateFor(pane.className);
    out.push({
      x: r.left - box.left + r.width / 2, y: r.top - box.top + r.height / 2,
      color: rgb(getComputedStyle(pane).getPropertyValue("--ag")), rate, ring,
    });
  }
  return out;
}

/** Tło motywu „Mgławica”: wyjście paneli płynie do rdzenia. `still` = jeden statyczny kadr (tryb Oszczędny). */
export function Nebula({ still }: { still: boolean }) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const cv = ref.current;
    const root = cv?.parentElement;
    const ctx = cv?.getContext("2d");
    if (!cv || !root || !ctx) return;
    let particles: Particle[] = [];
    let emitters: Emitter[] = [];
    let tick = 0;
    let raf = 0;
    let w = 0;
    let h = 0;
    let resizing = false;

    const resize = () => {
      const dpr = window.devicePixelRatio || 1;
      w = root.clientWidth;
      h = root.clientHeight;
      cv.width = Math.max(1, Math.round(w * dpr));
      cv.height = Math.max(1, Math.round(h * dpr));
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.fillStyle = "#05060a";
      ctx.fillRect(0, 0, w, h);
    };
    const core = () => ({ x: w / 2, y: h / 2 });

    const draw = () => {
      ctx.globalCompositeOperation = "source-over";
      ctx.fillStyle = "rgba(5,6,10,0.16)";
      ctx.fillRect(0, 0, w, h);
      ctx.globalCompositeOperation = "lighter";
      for (const p of particles) {
        ctx.fillStyle = `rgba(${p.color},0.75)`;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
        ctx.fill();
      }
      const c = core();
      const pulse = 1 + Math.sin(tick / 30) * 0.08;
      const g = ctx.createRadialGradient(c.x, c.y, 0, c.x, c.y, 90 * pulse);
      g.addColorStop(0, "rgba(255,255,255,0.9)");
      g.addColorStop(0.18, "rgba(200,190,255,0.5)");
      g.addColorStop(1, "rgba(80,60,160,0)");
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(c.x, c.y, 90 * pulse, 0, Math.PI * 2);
      ctx.fill();
      // Fale po skończonej pracy.
      for (const e of emitters) {
        if (!e.ring) continue;
        for (let k = 0; k < 3; k++) {
          const r = (tick * 0.9 + k * 40) % 120;
          ctx.strokeStyle = `rgba(${e.color},${(1 - r / 120).toFixed(2)})`;
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.arc(e.x, e.y, r, 0, Math.PI * 2);
          ctx.stroke();
        }
      }
    };

    const frame = () => {
      tick++;
      if (tick % 20 === 1) emitters = readEmitters(root); // układ i stany zmieniają się rzadko
      step(particles, emitters, core(), Math.random);
      draw();
    };

    resize();
    emitters = readEmitters(root);
    // Przeciąganie krawędzi okna: realokacja canvasu (dpr!) i odczyt układu co klatkę zatykały
    // wątek. W trakcie serii canvas rozciąga się w CSS, a przeliczenie idzie raz, po ciszy.
    let settle: ReturnType<typeof setTimeout> | undefined;
    const ro = new ResizeObserver(() => {
      resizing = true;
      clearTimeout(settle);
      settle = setTimeout(() => {
        resizing = false;
        resize();
        emitters = readEmitters(root);
        if (still) for (let i = 0; i < 6; i++) draw();
      }, 150);
    });
    ro.observe(root);

    if (still) {
      for (let i = 0; i < 260; i++) step(particles, emitters, core(), Math.random);
      for (let i = 0; i < 8; i++) draw();
    } else {
      // Nie rysujemy, gdy okno jest ukryte; cząstki po powrocie ruszają od zera, nie od zalegającej kupy.
      const loop = () => {
        if (document.hidden) particles = [];
        else if (!resizing) frame();
        raf = requestAnimationFrame(loop);
      };
      raf = requestAnimationFrame(loop);
    }
    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(settle);
      ro.disconnect();
    };
  }, [still]);

  return <canvas ref={ref} className="nebula" aria-hidden />;
}
