import { useEffect, useRef } from "react";
import { Terminal as XTerm } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { Unicode11Addon } from "@xterm/addon-unicode11";
import "@xterm/xterm/css/xterm.css";
import { backend, type ExitInfo, type PtyHandle } from "./backend";

const FONT = '"JetBrains Mono Variable", monospace';

type Props = {
  command: string;
  args?: string[];
  cwd?: string;
  focused?: boolean;
  onExit?: (info: ExitInfo) => void;
  onFocus?: () => void;
};

/**
 * One agent process rendered by xterm.js. The process lives exactly as long as the
 * component: the effect has no dependencies, so it restarts only under a new React key.
 */
export function Terminal({ command, args, cwd, focused, onExit, onFocus }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const term = useRef<XTerm | undefined>(undefined);
  // Read once at mount; later prop changes must never restart the process.
  const spec = useRef({ command, args, cwd });
  spec.current = { command, args, cwd };
  const exitRef = useRef(onExit);
  exitRef.current = onExit;
  const focusRef = useRef(onFocus);
  focusRef.current = onFocus;

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
      x.onResize(({ cols, rows }) => pty?.resize(cols, rows));
      x.onData((d) => pty?.write(d));
      observer.observe(el);
      x.textarea?.addEventListener("focus", () => focusRef.current?.());
      try {
        const handle = await backend.spawnPty(
          { ...spec0, cols: x.cols, rows: x.rows },
          (bytes) => x.write(bytes),
          (info) => {
            x.write(`\r\n\x1b[2m[proces zakończony: ${info.signal ?? `kod ${info.code}`}]\x1b[0m\r\n`);
            exitRef.current?.(info);
          },
        );
        if (disposed) handle.kill();
        else pty = handle;
      } catch (e) {
        x.write(`\x1b[31mNie udało się uruchomić: ${String(e)}\x1b[0m\r\n`);
      }
      x.focus();
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
