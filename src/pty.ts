import { Channel, invoke } from "@tauri-apps/api/core";

export type ExitInfo = { code: number; signal: string | null };

export type SpawnSpec = { command: string; args?: string[]; cwd?: string; cols: number; rows: number };

export type PtyHandle = {
  id: number;
  write(data: string): void;
  resize(cols: number, rows: number): void;
  kill(): void;
};

/** Start a process in a pseudo-terminal; output arrives as raw bytes. */
export async function spawnPty(
  spec: SpawnSpec,
  onData: (bytes: Uint8Array) => void,
  onExit: (info: ExitInfo) => void,
): Promise<PtyHandle> {
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
}
