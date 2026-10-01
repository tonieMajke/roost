//! Most między stroną a procesem głównym: tylko nazwane wywołania, bez dostępu do Node w stronie.

import { contextBridge, ipcRenderer, webUtils } from "electron";

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

const chatSinks = new Map<string, (e: { type: string }) => void>();
ipcRenderer.on("chat_event", (_e, reqId: string, ev: { type: string }) => {
  const sink = chatSinks.get(reqId);
  if (!sink) return;
  if (ev.type === "done" || ev.type === "error") chatSinks.delete(reqId);
  sink(ev);
});

const botSinks = new Map<string, (e: { type: string }) => void>();
ipcRenderer.on("bot_event", (_e, reqId: string, ev: { type: string }) => {
  const sink = botSinks.get(reqId);
  if (!sink) return;
  if (ev.type === "done" || ev.type === "error") botSinks.delete(reqId);
  sink(ev);
});
const approvalListeners = new Set<(e: unknown) => void>();
ipcRenderer.on("bot_approval", (_e, ev: unknown) => approvalListeners.forEach((cb) => cb(ev)));
const runListeners = new Set<(e: unknown) => void>();
ipcRenderer.on("bot_run", (_e, ev: unknown) => runListeners.forEach((cb) => cb(ev)));
const openRunListeners = new Set<(e: unknown) => void>();
ipcRenderer.on("bot_open_run", (_e, ev: unknown) => openRunListeners.forEach((cb) => cb(ev)));

const resizedListeners = new Set<() => void>();
ipcRenderer.on("win_resized", () => resizedListeners.forEach((cb) => cb()));

contextBridge.exposeInMainWorld("agentsElectron", {
  onResized(cb: () => void) {
    resizedListeners.add(cb);
    return () => void resizedListeners.delete(cb);
  },
  /** Ścieżka na dysku upuszczonego pliku (`File.path` już nie istnieje). */
  pathForFile: (file: File) => webUtils.getPathForFile(file),
  invoke: (name: string, ...args: unknown[]) => ipcRenderer.invoke(name, ...args),
  send: (name: string, ...args: unknown[]) => ipcRenderer.send(name, ...args),
  edges: process.argv.includes("--aw-wayland") ? WAYLAND_EDGES : ALL_EDGES,
  chatSend(reqId: string, req: unknown, onEvent: (e: { type: string }) => void) {
    chatSinks.set(reqId, onEvent);
    void ipcRenderer.invoke("chat_send", reqId, req).catch((err: unknown) => {
      chatSinks.delete(reqId);
      onEvent({ type: "error", message: String(err) } as { type: string });
    });
  },
  botSend(reqId: string, chatJson: string, req: unknown, onEvent: (e: { type: string }) => void) {
    botSinks.set(reqId, onEvent);
    void ipcRenderer.invoke("bot_send", reqId, chatJson, req).catch((err: unknown) => {
      botSinks.delete(reqId);
      onEvent({ type: "error", message: String(err) } as { type: string });
    });
  },
  onBotApproval(cb: (e: unknown) => void) {
    approvalListeners.add(cb);
    return () => void approvalListeners.delete(cb);
  },
  onBotRun(cb: (e: unknown) => void) {
    runListeners.add(cb);
    return () => void runListeners.delete(cb);
  },
  onBotOpenRun(cb: (e: unknown) => void) {
    openRunListeners.add(cb);
    return () => void openRunListeners.delete(cb);
  },
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
