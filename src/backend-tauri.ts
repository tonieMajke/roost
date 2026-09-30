import { Channel, invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { readText, writeText } from "@tauri-apps/plugin-clipboard-manager";
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

  // `directory: true` answers with one path (or null when cancelled); multi-select is off.
  async pickDir() {
    const picked = await open({ directory: true, title: "Katalog projektu" });
    return typeof picked === "string" ? picked : null;
  },
  homeDir: () => invoke<string>("home_dir"),

  loadWorkspace: () => invoke<string | null>("workspace_load"),
  saveWorkspace: (json) => invoke<void>("workspace_save", { json }),
  backupWorkspace: (date) => invoke<void>("workspace_backup", { date }),

  copyText: (text) => writeText(text),
  // Pusty schowek zwracamy jako `null`, żeby wołający nic nie wklejał.
  async pasteText() {
    const text = await readText();
    return text === "" ? null : text;
  },

  notify: (title, body) => invoke<void>("notify", { title, body }),
};
