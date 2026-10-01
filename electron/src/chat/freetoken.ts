//! FreeToken (127.0.0.1:1919) startuje na żądanie: przed zapytaniem czat sprawdza, czy serwer
//! podaje wybrany model, a jeśli nie — zwalnia GPU z routera llama.cpp, odpala jednostkę
//! `freetoken@<instancja>` i czeka, aż odpowie. Ta sama logika co `freetoken-autostart.ts` w pi
//! (jeden silnik na dwóch RTX 5090 naraz), bez dzierżaw sesji i bez wyłączania po bezczynności.

import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

/** id modelu (= `--served-model-name`) → instancja systemd `freetoken@<instancja>` */
export const FT_INSTANCES: Record<string, string> = {
  "Flash-Next-NVFP4": "flash-next",
  "Swift-Flash-Next-NVFP4": "swift-flash-next",
};
const FT_HOST = "127.0.0.1:1919";
const ROUTER_HOST = "127.0.0.1:8080";
const ROUTER_URL = `http://${ROUTER_HOST}`;
const READY_TIMEOUT_MS = 6 * 60_000;
/** VRAM zajęty na karcie przed startem (pulpit trzyma ~2,5 GB na GPU0) */
const VRAM_BUSY_MIB = 6_000;
/** inna sesja pi z innym silnikiem liczy się jako zajmująca GPU tak długo po ostatnim żądaniu */
const IDLE_GRACE_MS = 60_000;
const BUSY_MAX_MS = 60 * 60_000;

const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => (clearTimeout(t), reject(Object.assign(new Error("abort"), { name: "AbortError" }))), { once: true });
  });

/** Czy to serwer FreeToken, który umiemy uruchomić (adres + znany model). */
export function freetokenInstance(baseUrl: string | undefined, model: string): string | null {
  if (!baseUrl) return null;
  try {
    if (new URL(baseUrl).host !== FT_HOST) return null;
  } catch {
    return null;
  }
  return FT_INSTANCES[model] ?? null;
}

/** Czy to router llama.cpp, który ładuje modele sam, ale tylko przy wolnych kartach. */
export function isRouter(baseUrl: string | undefined): boolean {
  if (!baseUrl) return false;
  try {
    return new URL(baseUrl).host === ROUTER_HOST;
  } catch {
    return false;
  }
}

export interface Env {
  /** model, który serwer podaje teraz (`/v1/models`), albo undefined, gdy nie odpowiada */
  served(): Promise<string | undefined>;
  /** 1-tokenowe uzupełnienie: `/v1/models` odpowiada, zanim wagi są załadowane */
  answers(model: string): Promise<boolean>;
  unitActive(instance: string): Promise<boolean>;
  systemctl(...args: string[]): Promise<number>;
  /** modele trzymane przez router llama.cpp; zwolnienie ich; pusta lista = wolne */
  freeRouter(): Promise<string[]>;
  vram(): Promise<number[]>;
  /** inna sesja pi, która właśnie używa GPU innym silnikiem */
  blocker(want: string): string | null;
}

const run = (cmd: string, args: string[], timeout = 60_000) =>
  new Promise<{ code: number; out: string }>((resolve) =>
    execFile(cmd, args, { timeout }, (err, stdout) =>
      resolve({ code: err ? (((err as { code?: number }).code as number) ?? 1) : 0, out: String(stdout).trim() }),
    ),
  );

async function routerLoaded(): Promise<string[]> {
  try {
    const res = await fetch(`${ROUTER_URL}/models`, { signal: AbortSignal.timeout(3_000) });
    const body = (await res.json()) as { data?: { id: string; status?: { value?: string } }[] };
    return (body.data ?? []).filter((m) => m.status?.value !== "unloaded").map((m) => m.id);
  } catch {
    return []; // router nie działa = nic nie trzyma
  }
}

export const realEnv: Env = {
  async served() {
    try {
      const res = await fetch(`http://${FT_HOST}/v1/models`, { signal: AbortSignal.timeout(3_000) });
      return ((await res.json()) as { data?: { id?: string }[] }).data?.[0]?.id;
    } catch {
      return undefined;
    }
  },
  async answers(model) {
    if ((await this.served()) !== model) return false;
    try {
      const res = await fetch(`http://${FT_HOST}/v1/chat/completions`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ model, messages: [{ role: "user", content: "hi" }], max_tokens: 1 }),
        signal: AbortSignal.timeout(15_000),
      });
      return res.ok;
    } catch {
      return false;
    }
  },
  async unitActive(instance) {
    const { out } = await run("systemctl", ["--user", "is-active", `freetoken@${instance}.service`], 10_000);
    return out === "active" || out === "activating";
  },
  async systemctl(...args) {
    return (await run("systemctl", ["--user", ...args])).code;
  },
  async freeRouter() {
    for (const id of await routerLoaded()) {
      await fetch(`${ROUTER_URL}/models/unload`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ model: id }),
        signal: AbortSignal.timeout(10_000),
      }).catch(() => {});
    }
    let left = await routerLoaded();
    for (let i = 0; i < 60 && left.length > 0; i++) {
      await new Promise((r) => setTimeout(r, 500));
      left = await routerLoaded();
    }
    return left;
  },
  async vram() {
    const { code, out } = await run("nvidia-smi", ["--query-gpu=memory.used", "--format=csv,noheader,nounits"], 10_000);
    return code === 0 ? out.split("\n").map((l) => Number(l.trim())).filter((n) => !Number.isNaN(n)) : [];
  },
  blocker(want) {
    const dir = path.join(process.env.XDG_RUNTIME_DIR || `/tmp/pi-gpu-${process.getuid?.() ?? "u"}`, "pi-gpu");
    let names: string[] = [];
    try {
      names = fs.readdirSync(dir).filter((n) => n.endsWith(".lease.json"));
    } catch {
      return null;
    }
    const now = Date.now();
    for (const n of names) {
      try {
        const l = JSON.parse(fs.readFileSync(path.join(dir, n), "utf8")) as { pid: number; engine: string; model: string; busy: boolean; ts: number };
        process.kill(l.pid, 0);
        if (l.engine !== "none" && l.engine !== want && ((l.busy && now - l.ts < BUSY_MAX_MS) || now - l.ts < IDLE_GRACE_MS))
          return `sesja pi (pid ${l.pid}, model ${l.model})`;
      } catch {
        // martwy proces albo pół-zapisany plik
      }
    }
    return null;
  },
};

/** Jedno uruchamianie naraz: kolejne żądania tego samego modelu czekają na tę samą obietnicę. */
const inflight = new Map<string, Promise<void>>();

/**
 * Doprowadza FreeToken do stanu „odpowiada wybranym modelem”. `status` dostaje komunikaty
 * o postępie (ładowanie trwa ok. minuty). Rzuca po polsku, gdy się nie da.
 */
export function ensureFreeToken(
  model: string,
  instance: string,
  signal: AbortSignal,
  status: (msg: string) => void,
  env: Env = realEnv,
  timeoutMs = READY_TIMEOUT_MS,
): Promise<void> {
  const pending = inflight.get(model);
  if (pending) return pending;
  const p = (async () => {
    if (await env.answers(model)) return;
    const b = env.blocker(`ft:${instance}`);
    if (b) throw new Error(`GPU używa ${b}: poczekaj, aż skończy, albo przełącz ją na ten sam model`);
    status("Uruchamiam serwer FreeToken…");
    // inna instancja FreeToken trzyma karty (ten sam port): zatrzymać
    for (const other of new Set(Object.values(FT_INSTANCES))) {
      if (other !== instance && (await env.unitActive(other))) await env.systemctl("stop", `freetoken@${other}.service`);
    }
    if (!(await env.unitActive(instance))) {
      const left = await env.freeRouter();
      if (left.length > 0) throw new Error(`router llama.cpp nie zwolnił GPU (trzyma: ${left.join(", ")})`);
      const used = await env.vram();
      const full = used.findIndex((m) => m > VRAM_BUSY_MIB);
      if (full >= 0) throw new Error(`GPU${full} ma zajęte ${used[full]} MiB — coś innego trzyma kartę (nvidia-smi)`);
      if ((await env.systemctl("start", `freetoken@${instance}.service`)) !== 0)
        throw new Error(`nie udało się uruchomić freetoken@${instance}.service`);
    }
    status("Ładuję model do GPU (ok. minuty)…");
    const deadline = Date.now() + timeoutMs;
    while (!(await env.answers(model))) {
      signal.throwIfAborted();
      if (!(await env.unitActive(instance))) throw new Error(`FreeToken padł przy starcie — journalctl --user -u freetoken@${instance}`);
      if (Date.now() > deadline) throw new Error("FreeToken nie wstał w 6 minut");
      await sleep(2_000, signal);
    }
  })().finally(() => inflight.delete(model));
  inflight.set(model, p);
  return p;
}

/**
 * Przed zapytaniem do routera llama.cpp: działający FreeToken trzyma obie karty, więc router nie
 * załaduje modelu. Zatrzymuje FreeToken (jak pi), chyba że używa go teraz sesja pi.
 */
export async function freeGpuForRouter(signal: AbortSignal, status: (msg: string) => void, env: Env = realEnv): Promise<void> {
  const active: string[] = [];
  for (const inst of new Set(Object.values(FT_INSTANCES))) if (await env.unitActive(inst)) active.push(inst);
  if (active.length === 0) return;
  // FreeToken właśnie wstaje dla innego zapytania z aplikacji: nie zabijać go w połowie
  if (inflight.size > 0) throw new Error("FreeToken właśnie się uruchamia dla innej rozmowy: poczekaj, aż skończy, albo wybierz jego model");
  const b = env.blocker("llama");
  if (b) throw new Error(`GPU używa ${b}: poczekaj, aż skończy, albo przełącz ją na model z routera`);
  signal.throwIfAborted();
  status("Zatrzymuję FreeToken, zwalniam GPU dla routera…");
  for (const inst of active) {
    if ((await env.systemctl("stop", `freetoken@${inst}.service`)) !== 0) throw new Error(`nie udało się zatrzymać freetoken@${inst}.service`);
  }
}
