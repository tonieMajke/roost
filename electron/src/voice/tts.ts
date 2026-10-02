//! Mowa rozmówcy (eksperyment, `docs/plan-glos.md`): `tts.json` i `voice.json` w `configDir()`
//! oraz synteza jednego zdania. Do strony wracają bajty pliku audio (WAV albo to, co poda API);
//! strona dekoduje je przez `decodeAudioData`. Klucz nigdy nie wraca do strony.

import { t as tr } from "../i18n";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { activeTts, parseTtsConfig, parseVoiceConfig, ttsKeyId, type TtsProvider } from "../../../src/voice/voice";
import { writeAtomic } from "../config";
import { httpError, isAbort, networkError } from "../chat/http";
import { childEnv } from "../env";
import { isWindows, killChild, pathValue, spawnPlan } from "../platform";

const TIMEOUT_MS = 30_000;
/** Zdanie dłuższe niż to jest błędem cięcia, nie mową. */
export const MAX_TEXT = 4000;

function load(dir: string, file: string): string | null {
  try {
    return fs.readFileSync(path.join(dir, file), "utf8");
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw new Error(`${path.join(dir, file)}: ${String(e)}`);
  }
}

function save(dir: string, file: string, json: string): void {
  JSON.parse(json); // zapis nie ma zostawić pliku, którego sami potem nie przeczytamy
  fs.mkdirSync(dir, { recursive: true });
  writeAtomic(path.join(dir, file), json);
}

export const ttsConfigLoad = (dir: string) => load(dir, "tts.json");
export const ttsConfigSave = (dir: string, json: string) => save(dir, "tts.json", json);
export const voiceConfigLoad = (dir: string) => load(dir, "voice.json");
export const voiceConfigSave = (dir: string, json: string) => save(dir, "voice.json", json);

const oneLine = (text: string) => text.replace(/\s+/g, " ").trim();
const expandHome = (p: string) => (p === "~" || p.startsWith("~/") ? path.join(os.homedir(), p.slice(1)) : p);

/** Program Pipera, gdy ustawienia go nie podają: Arch/AUR instaluje `piper-tts`, pip – `piper` (na Windows `piper.exe`). */
export function defaultPiperCommand(pathEnv = pathValue(process.env), exists: (f: string) => boolean = isExecutable): string {
  const dirs = pathEnv.split(path.delimiter).filter(Boolean);
  const files = (d: string, name: string) => (isWindows ? [path.join(d, `${name}.exe`)] : [path.join(d, name)]);
  for (const name of ["piper-tts", "piper"]) if (dirs.some((d) => files(d, name).some(exists))) return name;
  return "piper";
}

function isExecutable(f: string): boolean {
  try {
    fs.accessSync(f, fs.constants.X_OK);
    return fs.statSync(f).isFile();
  } catch {
    return false;
  }
}

function checkText(text: string): string {
  const t = oneLine(text);
  if (!t) throw new Error(tr("tts.emptyText"));
  if (t.length > MAX_TEXT) throw new Error(tr("tts.tooLong", { max: MAX_TEXT }));
  return t;
}

/** `POST {baseUrl}/audio/speech` jak OpenAI; prosi o WAV, bo dekoduje się bez opóźnienia ramek MP3. */
export async function speakHttp(p: TtsProvider, key: string | null, text: string, voice: string, signal?: AbortSignal): Promise<Uint8Array> {
  const input = checkText(text);
  if (p.key && !key) throw new Error(`brak klucza API dla „${p.name}” (Ustawienia rozmowy → Klucz)`);
  if (key && !/^[\x21-\x7e]+$/.test(key)) throw new Error("klucz API zawiera spacje albo niedozwolone znaki (wklejony z dopiskiem?)");
  const url = `${p.baseUrl}/audio/speech`;
  const v = voice || p.voice;
  const timeout = AbortSignal.timeout(TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json", ...(key ? { authorization: `Bearer ${key}` } : {}) },
      body: JSON.stringify({ model: p.model, input, ...(v ? { voice: v } : {}), response_format: "wav" }),
      signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
    });
  } catch (e) {
    if (isAbort(e) && !signal?.aborted) throw new Error(tr("tts.timeout", { s: TIMEOUT_MS / 1000 }));
    if (signal?.aborted) throw e;
    throw networkError(e, url);
  }
  if (!res.ok) throw await httpError(res);
  if (/json|text\//i.test(res.headers.get("content-type") ?? "")) throw new Error(tr("tts.notAudio"));
  const audio = new Uint8Array(await res.arrayBuffer());
  if (audio.byteLength === 0) throw new Error(tr("tts.emptyAudio"));
  return audio;
}

type PiperJob = { resolve: (a: Uint8Array) => void; reject: (e: Error) => void; signal?: AbortSignal };

/**
 * Jeden proces `piper --output_dir` na rozmowę: start modelu kosztuje, zdanie już nie (~0,1 s).
 * Piper czyta linie ze stdin i dla każdej wypisuje na stdout ścieżkę gotowego WAV-a, w kolejności,
 * więc odpowiedź n-ta należy do n-tego zdania. Przerwanego zdania nie da się zatrzymać w Piperze:
 * jego wynik czekamy i wyrzucamy.
 */
export class Piper {
  private child: ChildProcessWithoutNullStreams;
  private queue: PiperJob[] = [];
  private out = "";
  private err = "";
  private dead: Error | null = null;
  readonly dir: string;

  constructor(
    readonly command: string,
    readonly model: string,
    readonly speaker: string,
  ) {
    this.dir = fs.mkdtempSync(path.join(os.tmpdir(), "aw-piper-"));
    const args = ["--model", expandHome(model), "--output_dir", this.dir, "--quiet"];
    if (/^\d+$/.test(speaker)) args.push("--speaker", speaker);
    const env = childEnv({}, process.env);
    const plan = spawnPlan(expandHome(command), args, { env });
    this.child = spawn(plan.command, plan.args, { env, stdio: ["pipe", "pipe", "pipe"], windowsHide: true, windowsVerbatimArguments: plan.verbatim });
    this.child.stdout.setEncoding("utf8");
    this.child.stderr.setEncoding("utf8");
    this.child.stdout.on("data", (d: string) => this.onOut(d));
    this.child.stderr.on("data", (d: string) => (this.err = (this.err + d).slice(-2000)));
    this.child.on("error", (e) => this.fail(new Error(this.explain(e))));
    this.child.on("exit", (code, sig) => this.fail(new Error(tr("tts.exit", { how: sig ?? code ?? "", tail: this.err ? `: ${this.err.trim().split("\n").pop()}` : "" }))));
    this.child.stdin.on("error", () => undefined); // EPIPE po śmierci procesu: błąd idzie przez `exit`
  }

  get alive() {
    return !this.dead;
  }

  private explain(e: NodeJS.ErrnoException): string {
    return e.code === "ENOENT" ? tr("tts.noPiper", { command: this.command }) : `Piper: ${e.message}`;
  }

  private onOut(d: string) {
    this.out += d;
    let nl: number;
    while ((nl = this.out.indexOf("\n")) >= 0) {
      const file = this.out.slice(0, nl).trim();
      this.out = this.out.slice(nl + 1);
      if (!file) continue;
      const job = this.queue.shift();
      let audio: Uint8Array | null = null;
      let error: Error | null = null;
      try {
        audio = new Uint8Array(fs.readFileSync(file));
      } catch (e) {
        error = new Error(tr("tts.unreadable", { file, msg: String(e) }));
      }
      fs.rm(file, { force: true }, () => undefined);
      if (!job || job.signal?.aborted) continue;
      if (error) job.reject(error);
      else job.resolve(audio!);
    }
  }

  private fail(e: Error) {
    if (this.dead) return;
    this.dead = e;
    for (const job of this.queue.splice(0)) job.reject(e);
    fs.rm(this.dir, { recursive: true, force: true }, () => undefined);
  }

  speak(text: string, signal?: AbortSignal): Promise<Uint8Array> {
    if (this.dead) return Promise.reject(this.dead);
    let line: string;
    try {
      line = checkText(text);
    } catch (e) {
      return Promise.reject(e as Error);
    }
    return new Promise((resolve, reject) => {
      const job: PiperJob = { resolve, reject, signal };
      // Abort odpowiada od razu; miejsce w kolejce zostaje, bo Piper i tak odda ten plik.
      signal?.addEventListener("abort", () => reject(new DOMException("przerwane", "AbortError")), { once: true });
      this.queue.push(job);
      this.child.stdin.write(`${line}\n`);
    });
  }

  close() {
    this.fail(new Error(tr("tts.closed")));
    this.child.stdin.end();
    if (this.child.exitCode !== null || this.child.signalCode !== null) return;
    // Windows: bez SIGTERM; całe drzewo, bo `.cmd` uruchamia Pipera przez cmd.exe
    if (isWindows) killChild(this.child);
    else this.child.kill("SIGTERM");
  }
}

/** Synteza dla IPC: silnik i głos z plików przy każdym zdaniu (zmiana w ustawieniach działa od razu),
 *  Piper żyje między zdaniami, dopóki nie zmieni się jego model/program/głos. */
export class TtsService {
  private piper: Piper | null = null;
  private jobs = new Map<string, AbortController>();

  constructor(
    private dir: () => string,
    private key: (id: string, env?: string) => string | null,
  ) {}

  async speak(reqId: string, text: string): Promise<Uint8Array> {
    const { config: voice } = parseVoiceConfig(voiceConfigLoad(this.dir()));
    const p = activeTts(parseTtsConfig(ttsConfigLoad(this.dir())).config, voice);
    if (!p) throw new Error("nie wybrano silnika mowy (Ustawienia rozmowy)");
    const ac = new AbortController();
    this.jobs.get(reqId)?.abort();
    this.jobs.set(reqId, ac);
    try {
      if (p.kind === "speech") return await speakHttp(p, this.key(ttsKeyId(p.id), p.keyEnv), text, voice.voice, ac.signal);
      return await this.piperFor(p, voice.voice || p.voice).speak(text, ac.signal);
    } finally {
      if (this.jobs.get(reqId) === ac) this.jobs.delete(reqId);
    }
  }

  private piperFor(p: TtsProvider, speaker: string): Piper {
    const command = p.command ?? defaultPiperCommand();
    const cur = this.piper;
    if (cur?.alive && cur.command === command && cur.model === p.model && cur.speaker === speaker) return cur;
    cur?.close();
    return (this.piper = new Piper(command, p.model, speaker));
  }

  cancel(reqId: string) {
    this.jobs.get(reqId)?.abort();
    this.jobs.delete(reqId);
  }

  /** Koniec rozmowy, przeładowanie strony, wyjście z aplikacji. */
  end() {
    for (const ac of this.jobs.values()) ac.abort();
    this.jobs.clear();
    this.piper?.close();
    this.piper = null;
  }
}
