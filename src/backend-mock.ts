import { DEFAULT_AGENTS } from "./agents";
import type { Backend, ExitInfo, PtyHandle, SpawnSpec } from "./backend";

const PROMPT = "$ ";
const WORKSPACE_KEY = "aw-workspace";
let nextId = 1;
// Preview copy of the clipboard: Chromium blocks readText() without focus, so copy/paste
// inside the preview must still round-trip.
let previewClipboard = "";
const mockReads = new Map<string, number>();
const MOCK_TITLES = ["Naprawa czarnego paska pod xtermem", "Tytuły sesji w pulpicie", "Refaktor kolejki zapisu do terminala", "Przegląd etapu 10"];

const enc = (text: string) => new TextEncoder().encode(text);

/** Pomiar płynności w podglądzie: `localStorage["aw-bench"] = "1"` i przeładowanie. */
function benchMode(): boolean {
  try {
    return localStorage.getItem("aw-bench") === "1";
  } catch {
    return false;
  }
}

/** Agent „pracuje” bez końca: spinner jak claude 10×/s, co 2 s nowa linia (panel jest st-working). */
function benchSpinner(onData: (b: Uint8Array) => void): ReturnType<typeof setInterval> {
  const frames = "·✢✳✶✻✽";
  let n = 0;
  // Historia do przewijania: kolorowe linie jak odpowiedź agenta z kodem.
  let dump = "";
  for (let i = 0; i < 1500; i++) {
    dump += `\x1b[38;5;${(i % 6) + 70}m${String(i).padStart(4)}\x1b[0m  const wynik = await backend.sessionContext(kind, id); \x1b[2m// linia ${i}\x1b[0m\r\n`;
  }
  onData(enc(dump));
  return setInterval(() => {
    n++;
    if (n % 20 === 0) onData(enc(`\r\x1b[2K● Linia wyjścia numer ${n / 20}: czytam plik src/App.tsx i coś w nim zmieniam\r\n`));
    onData(enc(`\r\x1b[2K\x1b[38;5;208m${frames[n % frames.length]}\x1b[0m Myślę… (${Math.floor(n / 10)}s)`));
  }, 100);
}

/**
 * Fake terminal for the browser preview: no invoke, no processes. Enough behaviour to
 * look at the UI: a banner, echoed keystrokes, `exit`/`fail` for the exit code paths.
 */
export const mockBackend: Backend = {
  async spawnPty(spec: SpawnSpec, onData: (b: Uint8Array) => void, onExit: (i: ExitInfo) => void): Promise<PtyHandle> {
    const id = nextId++;
    let line = "";
    let closed = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    let stop = (info: ExitInfo) => {
      if (closed) return;
      closed = true;
      if (timer !== undefined) clearTimeout(timer);
      onExit(info);
    };
    const submit = () => {
      const cmd = line.trim();
      line = "";
      onData(enc("\r\n"));
      if (cmd === "exit") return stop({ code: 0, signal: null });
      if (cmd === "fail") return stop({ code: 1, signal: null });
      onData(enc(PROMPT));
    };

    const args = spec.args?.length ? ` ${spec.args.join(" ")}` : "";
    // Agenci włączają bracketed paste jak prawdziwe claude/pi; udawana powłoka nie (wklejenie kontekstu odmówi).
    const bracketed = spec.command === "claude" || spec.command === "pi" ? "\x1b[?2004h" : "";
    onData(enc(`${bracketed}\x1b[33m[podgląd]\x1b[0m ${spec.command}${args} w ${spec.cwd ?? "~"}\r\n${PROMPT}`));
    if (bracketed && benchMode()) {
      const spin = benchSpinner(onData);
      const prevStop = stop;
      stop = (info) => {
        clearInterval(spin);
        prevStop(info);
      };
    }

    return {
      id,
      write(data) {
        if (closed) return;
        const paste = /^\x1b\[200~([\s\S]*)\x1b\[201~$/.exec(data);
        if (paste) {
          // Wklejony blok: nowe linie to nie Enter.
          line += paste[1];
          onData(enc(paste[1].replace(/\r\n?|\n/g, "\r\n")));
          return;
        }
        for (const ch of data) {
          if (ch === "\r" || ch === "\n") submit();
          else if (ch === "\x7f") {
            if (!line) continue;
            line = line.slice(0, -1);
            onData(enc("\b \b"));
          } else if (ch === "\x03") {
            line = "";
            onData(enc("^C\r\n" + PROMPT));
          } else if (ch >= " ") {
            line += ch;
            onData(enc(ch));
          }
        }
      },
      resize() {
        // nothing to reflow, the mock has no screen
      },
      kill() {
        timer = setTimeout(() => stop({ code: 0, signal: null }), 100);
      },
    };
  },

  // Preview mode: defaults only; sessions never exist here, every path is "it exists".
  loadAgents: async () => ({ agents: DEFAULT_AGENTS, errors: [] }),
  claudeSessionExists: async () => false,
  // Podgląd: kontekst rośnie z każdym odczytem, żeby było widać miernik i próg 80 %.
  async sessionContext(kind, sessionId) {
    const reads = (mockReads.get(sessionId) ?? 0) + 1;
    mockReads.set(sessionId, reads);
    const seed = [...sessionId].reduce((sum, ch) => sum + ch.charCodeAt(0), 0);
    const tokens = 20_000 + ((seed * 997) % 140_000) + reads * 1500;
    // „Na żywo”: co drugi odczyt nowe wywołanie narzędzia (ścieżka jak z prawdziwego pliku).
    const calls = Math.floor(reads / 2);
    const tools = Array.from({ length: Math.min(calls, 3) }, (_, i) => {
      const n = calls - Math.min(calls, 3) + i + 1;
      const id = `${sessionId}:${n}`;
      if (n % 3 === 0) return { id, name: kind === "claude" ? "Bash" : "bash", file: null, command: "pnpm test" };
      const file = `/home/podglad/projekt/src/plik-${n}.ts`;
      return { id, name: kind === "claude" ? "Read" : "edit", file, command: null };
    });
    // Tytuł pojawia się po pierwszym odczycie, jak aiTitle claude po pierwszej odpowiedzi.
    const title = reads < 2 ? null : MOCK_TITLES[seed % MOCK_TITLES.length];
    return kind === "claude"
      ? { tokens: tokens * 5, model: "claude-sonnet-5-5", window: null, tools, title }
      : { tokens, model: "Flash-Next-NVFP4", window: 262_144, tools, title };
  },
  // Podgląd: stały wyciąg, żeby było widać wklejenie w panelu docelowym.
  async sessionHandoff(kind) {
    return {
      prompts: ["napraw testy w src/feed.ts", "a teraz dodaj test na pusty katalog"],
      replies: [`Poprawione (${kind}): relativeTime liczył minuty od złej chwili.`],
      files: ["/home/podglad/demo/src/feed.ts", "/home/podglad/demo/src/feed.test.ts"],
      commands: ["pnpm test"],
    };
  },
  // Podgląd: udawane 1,5 s pracy Haiku; wejście z „fail” w wyciągu = błąd (ścieżka zapasowa).
  async claudeSummary(_command, _system, input) {
    await new Promise((r) => setTimeout(r, 1500));
    if (input.includes("fail")) throw new Error("kod 1: podgląd");
    return "- naprawiono relativeTime w src/feed.ts (liczył minuty od złej chwili)\n- dodano test w src/feed.test.ts, pnpm test przechodzi\n- otwarte: test na pusty katalog";
  },
  // Podgląd: bez linii statusu (procesy są udawane), limity zmyślone względem teraz.
  claudeSettingsArg: async () => null,
  async claudeLimits() {
    const now = Math.floor(Date.now() / 1000);
    return {
      fiveHour: { pct: 42, resetsAt: now + 100 * 60 },
      sevenDay: { pct: 83, resetsAt: now + 4 * 86_400 },
      at: now - 120,
    };
  },
  dirExists: async () => true,

  // The browser has no folder picker, so the preview asks for a path in a prompt box.
  async pickDir() {
    const ask = typeof globalThis.prompt === "function" ? globalThis.prompt("Katalog projektu", "/home/podglad/projekt") : null;
    const path = ask?.trim();
    return path ? path : null;
  },
  homeDir: async () => "/home/podglad",

  // Preview: the workspace lives in localStorage (private mode can throw -> treat as empty).
  async loadWorkspace() {
    try {
      return globalThis.localStorage?.getItem(WORKSPACE_KEY) ?? null;
    } catch {
      return null;
    }
  },
  async saveWorkspace(json) {
    try {
      globalThis.localStorage?.setItem(WORKSPACE_KEY, json);
    } catch {
      // private mode: the preview simply does not persist
    }
  },
  async backupWorkspace(date) {
    try {
      const key = `${WORKSPACE_KEY}.${date}`;
      const current = globalThis.localStorage?.getItem(WORKSPACE_KEY);
      if (current !== null && current !== undefined && globalThis.localStorage?.getItem(key) === null) {
        globalThis.localStorage.setItem(key, current);
      }
    } catch {
      // j.w.
    }
  },

  // Preview clipboard: the browser one when it answers, our own string as the fallback.
  async copyText(text) {
    previewClipboard = text;
    try {
      await globalThis.navigator?.clipboard?.writeText(text);
    } catch {
      // brak dostępu do schowka w przeglądarce: zostaje previewClipboard
    }
  },
  async pasteText() {
    try {
      const text = await globalThis.navigator?.clipboard?.readText();
      if (text) return text;
    } catch {
      // odczyt schowka wymaga fokusu karty: używamy previewClipboard
    }
    return previewClipboard === "" ? null : previewClipboard;
  },

  // Podgląd nie ma powiadomień pulpitu — zostaje log w konsoli dewelopera.
  async notify(title, body) {
    console.info(`[powiadomienie] ${title}: ${body}`);
  },
};
