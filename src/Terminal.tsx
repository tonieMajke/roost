import { useEffect, useImperativeHandle, useRef, type Ref } from "react";
import { Terminal as XTerm } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { Unicode11Addon } from "@xterm/addon-unicode11";
import "@xterm/xterm/css/xterm.css";
import { backend, type ExitInfo, type PtyHandle } from "./backend";
import { commandFor } from "./keys";

const FONT = '"JetBrains Mono Variable", monospace';

type Props = {
  command: string;
  args?: string[];
  cwd?: string;
  focused?: boolean;
  onExit?: (info: ExitInfo) => void;
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
};

/**
 * One agent process rendered by xterm.js. The process lives exactly as long as the
 * component: the effect has no dependencies, so it restarts only under a new React key.
 */
export function Terminal({ command, args, cwd, focused, onExit, onFocus, onOutput, onRedraw, apiRef }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const term = useRef<XTerm | undefined>(undefined);
  // Read once at mount; later prop changes must never restart the process.
  const spec = useRef({ command, args, cwd });
  spec.current = { command, args, cwd };
  const exitRef = useRef(onExit);
  exitRef.current = onExit;
  const focusRef = useRef(onFocus);
  focusRef.current = onFocus;
  const focusedRef = useRef(focused);
  focusedRef.current = focused;
  const outputRef = useRef(onOutput);
  outputRef.current = onOutput;
  const redrawRef = useRef(onRedraw);
  redrawRef.current = onRedraw;

  useImperativeHandle(
    apiRef,
    () => ({
      copySelection: () => term.current?.getSelection() ?? "",
      paste: (text: string) => term.current?.paste(text),
    }),
    [],
  );

  useEffect(() => {
    const el = host.current!;
    const spec0 = spec.current;
    const x = new XTerm({
      fontFamily: FONT,
      fontSize: 13,
      cursorBlink: true,
      allowProposedApi: true,
      scrollback: 5000,
      theme: { background: "#1a1918", foreground: "#e8e6e3" },
    });
    term.current = x;
    const fit = new FitAddon();
    x.loadAddon(fit);
    x.loadAddon(new Unicode11Addon());
    x.unicode.activeVersion = "11";
    // Nasze skróty obsługuje App na oknie; xterm nie może ich połknąć (ani wysłać do procesu).
    x.attachCustomKeyEventHandler((e) => commandFor(e) === null);

    let pty: PtyHandle | undefined;
    let disposed = false;
    const observer = new ResizeObserver(() => {
      if (el.clientWidth === 0) return; // hidden pane
      fit.fit();
    });

    (async () => {
      // xterm measures the cell once; the font has to be there first.
      await document.fonts.load(`13px ${FONT}`).catch(() => undefined);
      if (disposed) return;
      x.open(el);
      fit.fit();
      // the webfont can land after the first measure, which changes the cell size
      document.fonts.ready.then(() => { if (!disposed) fit.fit(); }).catch(() => undefined);
      x.onResize(({ cols, rows }) => {
        pty?.resize(cols, rows);
        redrawRef.current?.();
      });
      x.onData((d) => pty?.write(d));
      observer.observe(el);
      x.textarea?.addEventListener("focus", () => focusRef.current?.());
      try {
        const handle = await backend.spawnPty(
          { ...spec0, cols: x.cols, rows: x.rows },
          (bytes) => {
            if (disposed) return;
            x.write(bytes);
            outputRef.current?.();
          },
          (info) => {
            // A killed old run (restart/close) must not mark the pane's next run as exited.
            if (disposed) return;
            x.write(`\r\n\x1b[2m[proces zakończony: ${info.signal ?? `kod ${info.code}`}]\x1b[0m\r\n`);
            exitRef.current?.(info);
          },
        );
        if (disposed) handle.kill();
        else pty = handle;
      } catch (e) {
        x.write(`\x1b[31mNie udało się uruchomić: ${String(e)}\x1b[0m\r\n`);
      }
      // Only the focused pane takes the keyboard; otherwise the last pane to start would
      // steal focus (and via onFocus move the workspace focus, even switch projects).
      if (focusedRef.current && !disposed) x.focus();
    })();

    return () => {
      disposed = true;
      observer.disconnect();
      pty?.kill();
      x.dispose();
      term.current = undefined;
    };
    // The process depends on the React key only, that is the whole design.
  }, []);

  // The pane owns clicks; when it becomes the focused one its terminal takes the keyboard.
  useEffect(() => {
    if (focused) term.current?.focus();
  }, [focused]);

  return <div className="terminal" ref={host} />;
}
