//! Most między stroną a procesem głównym: tylko nazwane wywołania, bez dostępu do Node w stronie.

import { contextBridge, ipcRenderer } from "electron";

type ExitInfo = { code: number; signal: string | null };
type Sinks = { data: (chunk: Uint8Array) => void; exit: (info: ExitInfo) => void };

/** Na Wayland okno nie zmienia położenia (setBounds tylko zmienia rozmiar): uchwyty tylko tam,
 *  gdzie lewy górny róg stoi w miejscu. Górę i lewo obsługuje sama ramka okna. */
const WAYLAND_EDGES = ["South", "East", "SouthEast"];
const ALL_EDGES = ["North", "South", "East", "West", "NorthWest", "NorthEast", "SouthWest", "SouthEast"];

const sinks = new Map<number, Sinks>();
// Dane i wyjście mogą przyjść, zanim strona dostanie id z `pty_spawn`: czekają tu.
const early = new Map<number, { data: Uint8Array[]; exit: ExitInfo | null }>();
const waiting = (id: number) => {
  let w = early.get(id);
  if (!w) early.set(id, (w = { data: [], exit: null }));
  return w;
};

ipcRenderer.on("pty_data", (_e, id: number, chunk: Uint8Array) => {
  const s = sinks.get(id);
  if (s) s.data(chunk);
  else waiting(id).data.push(chunk);
});
ipcRenderer.on("pty_exit", (_e, id: number, info: ExitInfo) => {
  const s = sinks.get(id);
  if (!s) return void (waiting(id).exit = info);
  sinks.delete(id);
  s.exit(info);
});

const resizedListeners = new Set<() => void>();
ipcRenderer.on("win_resized", () => resizedListeners.forEach((cb) => cb()));

contextBridge.exposeInMainWorld("agentsElectron", {
  onResized(cb: () => void) {
    resizedListeners.add(cb);
    return () => void resizedListeners.delete(cb);
  },
  invoke: (name: string, ...args: unknown[]) => ipcRenderer.invoke(name, ...args),
  send: (name: string, ...args: unknown[]) => ipcRenderer.send(name, ...args),
  edges: process.argv.includes("--aw-wayland") ? WAYLAND_EDGES : ALL_EDGES,
  async spawnPty(spec: unknown, onData: Sinks["data"], onExit: Sinks["exit"]) {
    const id: number = await ipcRenderer.invoke("pty_spawn", spec);
    const w = early.get(id);
    early.delete(id);
    for (const chunk of w?.data ?? []) onData(chunk);
    if (w?.exit) onExit(w.exit);
    else sinks.set(id, { data: onData, exit: onExit });
    return id;
  },
});
