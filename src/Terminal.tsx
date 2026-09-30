import { useEffect, useImperativeHandle, useRef, useState, type Ref } from "react";
import { Terminal as XTerm } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { Unicode11Addon } from "@xterm/addon-unicode11";
import { backend, type ExitInfo, type PtyHandle } from "./backend";
import { commandFor } from "./keys";
import { WriteQueue, peakQueueBytes } from "./write-queue";

// Ręczny pomiar w oknie (test 16 × 20 MB): w konsoli devtools `awPeakQueueMB()`.
(globalThis as { awPeakQueueMB?: () => number }).awPeakQueueMB = () =>
  Math.round((peakQueueBytes() / 1048576) * 10) / 10;

const FONT = '"JetBrains Mono Variable", monospace';

/** Motyw ze wzoru D: tło/tekst stałe, kursor i chwycony suwak w kolorze akcentu.
 *  Suwak = tokeny `--line-strong` / `--faint` ze styles.css (xterm bierze wartości, nie klasy). */
const termTheme = (accent: string) => ({
  background: "#0d0e11",
  foreground: "#c6ced8",
  cursor: accent,
  scrollbarSliderBackground: "rgba(255, 255, 255, 0.15)",
  scrollbarSliderHoverBackground: "#6f7883",
  scrollbarSliderActiveBackground: accent,
});

type Props = {
  command: string;
  args?: string[];
  cwd?: string;
  /** Kolor akcentu (#rrggbb): kursor xtermu; zmiana nie restartuje procesu. */
  accent?: string;
  /** Rozmiar czcionki (px); zmiana przelicza siatkę bez restartu procesu. */
  fontSize?: number;
  focused?: boolean;
  onExit?: (info: ExitInfo) => void;
  /** Proces wystartował (pulpit „Na żywo”). */
  onStart?: () => void;
  onFocus?: () => void;
  /** Bajty od procesu (aktywność panelu). */
  onOutput?: () => void;
  /** xterm zmienił rozmiar (panel widoczny, maksymalizacja, resize okna). */
  onRedraw?: () => void;
  /** Uchwyt dla rodzica (App): kopiowanie zaznaczenia i wklejenie tekstu. */
  apiRef?: Ref<TerminalHandle>;
};

export type TerminalHandle = {
  /** Zaznaczony tekst ("" = brak zaznaczenia). */
  copySelection(): string;
  /** Tekst do terminala tak, jakby wklejony (obsługuje bracketed paste). */
  paste(text: string): void;
  /**
   * Program w terminalu włączył bracketed paste (claude, pi, nowe powłoki). Bez tego
   * `paste` wysyła nowe linie jako Enter, więc wieloliniowy tekst wykonałby się linia po linii.
   */
  bracketedPaste(): boolean;
};

/**
 * One agent process rendered by xterm.js. The process lives exactly as long as the
 * component: the effect has no dependencies, so it restarts only under a new React key.
 */
export function Terminal({ command, args, cwd, accent = "#ff8a4c", fontSize = 13, focused, onExit, onStart, onFocus, onOutput, onRedraw, apiRef }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const term = useRef<XTerm | undefined>(undefined);
  // Read once at mount; later prop changes must never restart the process.
  const spec = useRef({ command, args, cwd });
  spec.current = { command, args, cwd };
  const exitRef = useRef(onExit);
  exitRef.current = onExit;
  const startRef = useRef(onStart);
  startRef.current = onStart;
  const focusRef = useRef(onFocus);
  focusRef.current = onFocus;
  const focusedRef = useRef(focused);
  focusedRef.current = focused;
  const outputRef = useRef(onOutput);
  outputRef.current = onOutput;
  const redrawRef = useRef(onRedraw);
  redrawRef.current = onRedraw;
  const fitRef = useRef<FitAddon | undefined>(undefined);
  // Przewinięty w górę: pokazuje przycisk „na dół” (scrollback do 3000 wierszy to długa droga).
  const [scrolledUp, setScrolledUp] = useState(false);

  useImperativeHandle(
    apiRef,
    () => ({
      copySelection: () => term.current?.getSelection() ?? "",
      paste: (text: string) => term.current?.paste(text),
      bracketedPaste: () => term.current?.modes.bracketedPasteMode ?? false,
    }),
    [],
  );

  useEffect(() => {
    const el = host.current!;
    const spec0 = spec.current;
    const x = new XTerm({
      fontFamily: FONT,
      fontSize,
      cursorBlink: true,
      allowProposedApi: true,
      scrollback: 3000, // limit pamięci przy 16 panelach (plan M1, ryzyko „xterm wolny”)
      theme: termTheme(accent),
    });
    term.current = x;
    const fit = new FitAddon();
    fitRef.current = fit;
    x.loadAddon(fit);
    x.loadAddon(new Unicode11Addon());
    x.unicode.activeVersion = "11";
    // Nasze skróty obsługuje App na oknie; xterm nie może ich połknąć (ani wysłać do procesu).
    x.attachCustomKeyEventHandler((e) => commandFor(e) === null);

    let pty: PtyHandle | undefined;
    let disposed = false;
    // Wyjście PTY trafia do xterm paczkami (etap 7 M2): 16 paneli naraz nie zatyka UI.
    const queue = new WriteQueue(
      (data, done) => x.write(data, done),
      () => el.clientWidth === 0, // schowana siatka albo panel za zmaksymalizowanym
      (bytes) => console.warn(`[terminal] kolejka zapisu ${Math.round(bytes / 1048576)} MB – PTY szybszy niż xterm`),
    );
    // Ukryty panel (display:none, maximalizacja, schowana siatka) ma wymiar 0 — fit() na nim
    // nic nie robi, a ResizeObserver i tak strzeli, gdy panel wróci (stąd ten warunek).
    const observer = new ResizeObserver(() => {
      if (el.clientWidth === 0) return; // hidden pane
      fit.fit();
    });

    (async () => {
      // xterm measures the cell once; the font has to be there first.
      await document.fonts.load(`${fontSize}px ${FONT}`).catch(() => undefined);
      if (disposed) return;
      x.open(el);
      fit.fit();
      // the webfont can land after the first measure, which changes the cell size
      document.fonts.ready.then(() => { if (!disposed) fit.fit(); }).catch(() => undefined);
      x.onResize(({ cols, rows }) => {
        pty?.resize(cols, rows);
        redrawRef.current?.();
      });
      // Focus reports (DECSET 1004) stay here: with many panes all but one are "unfocused",
      // and agent TUIs keep redrawing then, which the activity dot reads as work.
      x.onData((d) => {
        if (d === "\x1b[I" || d === "\x1b[O") return;
        pty?.write(d);
      });
      const syncScrolled = () => {
        const b = x.buffer.active;
        setScrolledUp(b.viewportY < b.baseY);
      };
      x.onScroll(syncScrolled);
      x.onWriteParsed(syncScrolled); // nowe wyjście przy przewiniętym widoku: baseY rośnie, viewportY stoi
      observer.observe(el);
      x.textarea?.addEventListener("focus", () => focusRef.current?.());
      try {
        const handle = await backend.spawnPty(
          { ...spec0, cols: x.cols, rows: x.rows },
          (bytes) => {
            if (disposed) return;
            // Aktywność liczy wyjście w chwili przyjścia z PTY, nie zapisu do xterm.
            outputRef.current?.();
            queue.push(bytes);
          },
          (info) => {
            // A killed old run (restart/close) must not mark the pane's next run as exited.
            if (disposed) return;
            exitRef.current?.(info); // Pane shows the „Proces zakończony” bar
          },
        );
        if (disposed) handle.kill();
        else {
          pty = handle;
          startRef.current?.();
        }
      } catch (e) {
        x.write(`\x1b[31mNie udało się uruchomić: ${String(e)}\x1b[0m\r\n`);
      }
      // Only the focused pane takes the keyboard; otherwise the last pane to start would
      // steal focus (and via onFocus move the workspace focus, even switch projects).
      if (focusedRef.current && !disposed) x.focus();
    })();

    return () => {
      disposed = true;
      queue.dispose();
      observer.disconnect();
      pty?.kill();
      x.dispose();
      term.current = undefined;
      fitRef.current = undefined;
    };
    // The process depends on the React key only, that is the whole design.
  }, []);

  // Zmiana akcentu (okno „Wygląd”) podmienia motyw xtermu bez restartu procesu.
  useEffect(() => {
    const x = term.current;
    if (x) x.options.theme = termTheme(accent);
  }, [accent]);

  // Ctrl+Alt+= / - / 0: nowa komórka = nowe cols/rows, fit() wysyła je do PTY (onResize).
  useEffect(() => {
    const x = term.current;
    if (!x || x.options.fontSize === fontSize) return;
    x.options.fontSize = fontSize;
    if (x.element && host.current && host.current.clientWidth > 0) fitRef.current?.fit();
  }, [fontSize]);

  // The pane owns clicks; when it becomes the focused one its terminal takes the keyboard.
  useEffect(() => {
    if (focused) term.current?.focus();
  }, [focused]);

  return (
    <div className="terminal-wrap">
      <div className="terminal" ref={host} />
      {scrolledUp && (
        <button
          type="button"
          className="to-bottom"
          title="Przewiń na dół"
          aria-label="Przewiń na dół"
          onClick={() => {
            term.current?.scrollToBottom();
            term.current?.focus();
          }}
        >
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M3 5l4 4 4-4M3 10.5h8" />
          </svg>
        </button>
      )}
    </div>
  );
}
