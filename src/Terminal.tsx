import { useEffect, useImperativeHandle, useRef, useState, type Ref } from "react";
import { Terminal as XTerm, type ITheme } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { SearchAddon } from "@xterm/addon-search";
import { Unicode11Addon } from "@xterm/addon-unicode11";
import { backend, type ExitInfo, type PtyHandle } from "./backend";
import { commandFor } from "./keys";
import { searchAction } from "./term-search";
import { ResizeThrottle } from "./resize-throttle";
import { WriteQueue, peakQueueBytes } from "./write-queue";
import { DEFAULT_TERM_FONT } from "./themes";
import { findPathRefs } from "./term-links";

// Ręczny pomiar w oknie (test 16 × 20 MB): w konsoli devtools `awPeakQueueMB()`.
(globalThis as { awPeakQueueMB?: () => number }).awPeakQueueMB = () =>
  Math.round((peakQueueBytes() / 1048576) * 10) / 10;

/** Wygląd xtermu z motywu (src/themes.ts): xterm bierze wartości, nie klasy CSS. */
export type TermLook = { theme: ITheme; font: string };

const DEFAULT_LOOK: TermLook = { theme: { background: "#0d0e11", foreground: "#c6ced8" }, font: DEFAULT_TERM_FONT };

type Props = {
  command: string;
  args?: string[];
  cwd?: string;
  /** Dodatkowe zmienne procesu (konto agenta); czytane raz, przy starcie. */
  env?: [string, string][];
  /** Kolory i font (motyw + akcent); zmiana nie restartuje procesu. */
  look?: TermLook;
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
  /** Program ustawił tytuł terminala (OSC 0/2) — claude pisze tam krótki temat rozmowy. */
  onTitle?: (title: string) => void;
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
  /** Surowe wejście jak z klawiatury (np. `"\r"` = Enter, którego `paste` nie wyśle). */
  type(data: string): void;
  /** Ostatnie `lines` niepustych od końca linii bufora (ekran + przewinięte), bez pustego ogona. */
  tail(lines: number): string;
};

/**
 * One agent process rendered by xterm.js. The process lives exactly as long as the
 * component: the effect has no dependencies, so it restarts only under a new React key.
 */
export function Terminal({ command, args, cwd, env, look = DEFAULT_LOOK, fontSize = 13, focused, onExit, onStart, onFocus, onOutput, onRedraw, onTitle, apiRef }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const term = useRef<XTerm | undefined>(undefined);
  // Read once at mount; later prop changes must never restart the process.
  const spec = useRef({ command, args, cwd, env });
  spec.current = { command, args, cwd, env };
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
  const titleRef = useRef(onTitle);
  titleRef.current = onTitle;
  const fitRef = useRef<FitAddon | undefined>(undefined);
  // Przewinięty w górę: pokazuje przycisk „na dół” (scrollback do 3000 wierszy to długa droga).
  const [scrolledUp, setScrolledUp] = useState(false);
  // Pole szukania (Ctrl+F). Ref obok stanu: handler klawiszy xtermu żyje w efekcie z pustymi zależnościami.
  const [searchOpen, setSearchOpen] = useState(false);
  const [noMatch, setNoMatch] = useState(false);
  const searchOpenRef = useRef(false);
  searchOpenRef.current = searchOpen;
  const searchRef = useRef<SearchAddon | undefined>(undefined);
  const searchInput = useRef<HTMLInputElement>(null);
  const query = useRef("");

  useImperativeHandle(
    apiRef,
    () => ({
      copySelection: () => term.current?.getSelection() ?? "",
      paste: (text: string) => term.current?.paste(text),
      bracketedPaste: () => term.current?.modes.bracketedPasteMode ?? false,
      type: (data: string) => term.current?.input(data, true),
      tail: (lines: number) => {
        const b = term.current?.buffer.active;
        if (!b) return "";
        const out: string[] = [];
        for (let y = b.length - 1; y >= 0 && out.length < lines; y--) {
          const text = b.getLine(y)?.translateToString(true) ?? "";
          if (out.length === 0 && !text.trim()) continue; // pusty dół ekranu pod kursorem
          out.push(text);
        }
        return out.reverse().join("\n");
      },
    }),
    [],
  );

  useEffect(() => {
    const el = host.current!;
    const spec0 = spec.current;
    const x = new XTerm({
      fontFamily: look.font,
      fontSize,
      cursorBlink: true,
      allowProposedApi: true,
      scrollback: 3000, // limit pamięci przy 16 panelach (plan M1, ryzyko „xterm wolny”)
      theme: look.theme,
    });
    term.current = x;
    const fit = new FitAddon();
    fitRef.current = fit;
    x.loadAddon(fit);
    x.loadAddon(new Unicode11Addon());
    x.unicode.activeVersion = "11";
    // Nasze skróty obsługuje App na oknie; xterm nie może ich połknąć (ani wysłać do procesu).
    const search = new SearchAddon();
    searchRef.current = search;
    x.loadAddon(search);
    // Ctrl+F nie może trafić do PTY; samo pole jest poza xtermem, więc reszta skrótów działa w nim.
    x.attachCustomKeyEventHandler((e) => {
      if (commandFor(e) !== null) return false;
      const act = searchAction(e, searchOpenRef.current);
      // Enter/Esc zostają dla programu, nawet gdy pole jest otwarte, a fokus wrócił do terminala.
      if (act === null || act === "close" || (act !== "open" && e.key.toLowerCase() !== "g")) return true;
      if (e.type === "keydown") {
        if (act === "open") openSearch();
        else runSearch(act);
      }
      return false;
    });

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
    // Przeciąganie krawędzi okna: fit co klatkę we wszystkich panelach dławił UI (ResizeThrottle).
    const refit = new ResizeThrottle(() => {
      if (el.clientWidth > 0 && !disposed) fit.fit();
    });
    const observer = new ResizeObserver(() => {
      if (el.clientWidth === 0) return; // hidden pane
      refit.request();
    });

    (async () => {
      // xterm measures the cell once; the font has to be there first.
      await document.fonts.load(`${fontSize}px ${look.font}`).catch(() => undefined);
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
      // Ctrl-klik na `src/foo.ts:41`: tylko pliki, które istnieją (sprawdza proces główny, wynik w pamięci
      // podręcznej: provider pyta o każdą widoczną linię przy każdym ruchu myszy).
      const known = new Map<string, Promise<string | null>>();
      const resolveAll = (paths: string[]) => {
        const missing = [...new Set(paths)].filter((p) => !known.has(p));
        if (missing.length > 0) {
          const batch = backend.resolveFiles(spec0.cwd ?? "", missing).catch(() => missing.map(() => null));
          missing.forEach((p, i) => known.set(p, batch.then((r) => r[i] ?? null)));
          if (known.size > 500) known.clear();
        }
        return Promise.all(paths.map((p) => known.get(p) ?? Promise.resolve(null)));
      };
      x.registerLinkProvider({
        provideLinks(y, callback) {
          const text = x.buffer.active.getLine(y - 1)?.translateToString(true) ?? "";
          const refs = findPathRefs(text);
          if (refs.length === 0) return callback(undefined);
          void resolveAll(refs.map((r) => r.path)).then((files) => {
            const links = refs.flatMap((r, i) => {
              const file = files[i];
              if (!file) return [];
              return [
                {
                  range: { start: { x: r.start + 1, y }, end: { x: r.end, y } },
                  text: text.slice(r.start, r.end),
                  decorations: { underline: true, pointerCursor: false },
                  activate(e: MouseEvent) {
                    if (!(e.ctrlKey || e.metaKey)) return;
                    void backend.openFile(file, r.line, r.col).catch((err) => console.warn("[terminal] open_file:", err));
                  },
                },
              ];
            });
            callback(links.length > 0 ? links : undefined);
          });
        },
      });
      const syncScrolled = () => {
        const b = x.buffer.active;
        setScrolledUp(b.viewportY < b.baseY);
      };
      x.onTitleChange((t) => titleRef.current?.(t));
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
      refit.dispose();
      pty?.kill();
      x.dispose();
      term.current = undefined;
      fitRef.current = undefined;
      searchRef.current = undefined;
    };
    // The process depends on the React key only, that is the whole design.
  }, []);

  // Zmiana motywu albo akcentu (okno „Wygląd”) podmienia kolory xtermu bez restartu procesu.
  useEffect(() => {
    const x = term.current;
    if (x) x.options.theme = look.theme;
  }, [look.theme]);

  // Inny font motywu = inna komórka: najpierw doczytać font, potem zmierzyć i dopasować siatkę.
  useEffect(() => {
    const x = term.current;
    if (!x || x.options.fontFamily === look.font) return;
    let stale = false;
    document.fonts
      .load(`${x.options.fontSize ?? fontSize}px ${look.font}`)
      .catch(() => undefined)
      .then(() => {
        if (stale || term.current !== x) return;
        x.options.fontFamily = look.font;
        if (x.element && host.current && host.current.clientWidth > 0) fitRef.current?.fit();
      });
    return () => {
      stale = true;
    };
  }, [look.font]);

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

  function openSearch() {
    setSearchOpen(true);
    // przy pierwszym otwarciu pole powstaje po renderze (autoFocus); przy kolejnych tylko zaznaczamy tekst
    searchInput.current?.focus();
    searchInput.current?.select();
  }

  function runSearch(dir: "next" | "prev", incremental = false) {
    const q = query.current;
    const s = searchRef.current;
    if (!s) return;
    if (!q) {
      s.clearDecorations();
      setNoMatch(false);
      return;
    }
    const ok = dir === "next" ? s.findNext(q, { incremental }) : s.findPrevious(q);
    setNoMatch(!ok);
  }

  function closeSearch() {
    searchRef.current?.clearDecorations();
    setSearchOpen(false);
    setNoMatch(false);
    term.current?.focus();
  }

  return (
    <div className="terminal-wrap">
      {searchOpen && (
        <div className={`term-search${noMatch ? " no-match" : ""}`} role="search">
          <input
            ref={searchInput}
            autoFocus
            type="text"
            defaultValue={query.current}
            spellCheck={false}
            placeholder="Szukaj w terminalu"
            aria-label="Szukaj w terminalu"
            aria-invalid={noMatch}
            onChange={(e) => {
              query.current = e.target.value;
              runSearch("next", true);
            }}
            onKeyDown={(e) => {
              const act = searchAction(e.nativeEvent, true);
              if (act === null) return;
              e.preventDefault();
              e.stopPropagation();
              if (act === "close") closeSearch();
              else if (act === "open") searchInput.current?.select();
              else runSearch(act);
            }}
          />
          <span className="term-search-state" aria-live="polite">{noMatch ? "Brak trafień" : ""}</span>
          <button type="button" title="Poprzednie (Ctrl+Shift+G)" aria-label="Poprzednie trafienie" onClick={() => runSearch("prev")}>↑</button>
          <button type="button" title="Następne (Ctrl+G)" aria-label="Następne trafienie" onClick={() => runSearch("next")}>↓</button>
          <button type="button" title="Zamknij (Esc)" aria-label="Zamknij szukanie" onClick={closeSearch}>✕</button>
        </div>
      )}
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
