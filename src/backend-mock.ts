import { DEFAULT_AGENTS } from "./agents";
import type { Backend, ExitInfo, PtyHandle, SpawnSpec } from "./backend";

const PROMPT = "$ ";
let nextId = 1;

const enc = (text: string) => new TextEncoder().encode(text);

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

    const stop = (info: ExitInfo) => {
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
    onData(enc(`\x1b[33m[podgląd]\x1b[0m ${spec.command}${args} w ${spec.cwd ?? "~"}\r\n${PROMPT}`));

    return {
      id,
      write(data) {
        if (closed) return;
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
  dirExists: async () => true,

  // The browser has no folder picker, so the preview asks for a path in a prompt box.
  async pickDir() {
    const ask = typeof globalThis.prompt === "function" ? globalThis.prompt("Katalog projektu", "/home/podglad/projekt") : null;
    const path = ask?.trim();
    return path ? path : null;
  },
  homeDir: async () => "/home/podglad",
};
