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
  onExit?: (info: ExitInfo) => void;
};

/** One agent process rendered by xterm.js. The process lives as long as the component. */
export function Terminal({ command, args, cwd, onExit }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const exitRef = useRef(onExit);
  exitRef.current = onExit;

  useEffect(() => {
    const el = host.current!;
    const term = new XTerm({
      fontFamily: FONT,
      fontSize: 13,
      cursorBlink: true,
      allowProposedApi: true,
      scrollback: 5000,
      theme: { background: "#1a1918", foreground: "#e8e6e3" },
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.loadAddon(new Unicode11Addon());
    term.unicode.activeVersion = "11";

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
      term.open(el);
      fit.fit();
      term.onResize(({ cols, rows }) => pty?.resize(cols, rows));
      term.onData((d) => pty?.write(d));
      observer.observe(el);
      try {
        const handle = await backend.spawnPty(
          { command, args, cwd, cols: term.cols, rows: term.rows },
          (bytes) => term.write(bytes),
          (info) => {
            term.write(`\r\n\x1b[2m[proces zakończony: ${info.signal ?? `kod ${info.code}`}]\x1b[0m\r\n`);
            exitRef.current?.(info);
          },
        );
        if (disposed) handle.kill();
        else pty = handle;
      } catch (e) {
        term.write(`\x1b[31mNie udało się uruchomić: ${String(e)}\x1b[0m\r\n`);
      }
      term.focus();
    })();

    return () => {
      disposed = true;
      observer.disconnect();
      pty?.kill();
      term.dispose();
    };
  }, [command, cwd, JSON.stringify(args)]);

  return <div className="terminal" ref={host} />;
}
