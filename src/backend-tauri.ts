import { Channel, invoke } from "@tauri-apps/api/core";
import { DEFAULT_AGENTS, parseAgents } from "./agents";
import type { Backend, ExitInfo } from "./backend";

/** Start a process in a pseudo-terminal; output arrives as raw bytes. */
export const tauriBackend: Backend = {
  async spawnPty(spec, onData, onExit) {
    const data = new Channel<ArrayBuffer | number[]>();
    data.onmessage = (chunk) => onData(chunk instanceof ArrayBuffer ? new Uint8Array(chunk) : Uint8Array.from(chunk));
    const exit = new Channel<ExitInfo>();
    exit.onmessage = onExit;
    const id = await invoke<number>("pty_spawn", { spec, onData: data, onExit: exit });
    const report = (e: unknown) => console.warn(`[pty ${id}]`, e);
    return {
      id,
      write: (text) => void invoke("pty_write", { id, data: text }).catch(report),
      resize: (cols, rows) => void invoke("pty_resize", { id, cols, rows }).catch(report),
      kill: () => void invoke("pty_kill", { id }).catch(report),
    };
  },

  async loadAgents() {
    // Rust returns the raw file text; a file we cannot even parse must not brick the UI.
    let raw: string;
    try {
      raw = await invoke<string>("agents_load");
      return parseAgents(JSON.parse(raw));
    } catch (e) {
      return { agents: DEFAULT_AGENTS, errors: [`agents.json: ${String(e)}`] };
    }
  },

  claudeSessionExists: (id) => invoke<boolean>("claude_session_exists", { id }),
  dirExists: (path) => invoke<boolean>("dir_exists", { path }),
};
