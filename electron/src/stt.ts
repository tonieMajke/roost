//! Transkrypcja głosu w procesie głównym: `stt.json` w `configDir()` i jedno zapytanie
//! `POST {baseUrl}/audio/transcriptions` (multipart). Klucz nigdy nie wraca do strony.

import { t } from "./i18n";
import fs from "node:fs";
import path from "node:path";
import { audioExt, type SttProvider } from "../../src/stt";
import { writeAtomic } from "./config";
import { httpError, isAbort, networkError } from "./chat/http";

const FILE = "stt.json";
/** API przyjmują zwykle do 25 MB; większe nagranie odrzucamy, zanim ruszy w sieć. */
export const MAX_AUDIO_BYTES = 25 * 1024 * 1024;
const TIMEOUT_MS = 60_000;

/** Surowy `stt.json`; `null` = jeszcze nie ustawiono. Zepsutego pliku nie nadpisujemy. */
export function sttConfigLoad(dir: string): string | null {
  try {
    return fs.readFileSync(path.join(dir, FILE), "utf8");
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw new Error(`${path.join(dir, FILE)}: ${String(e)}`);
  }
}

export function sttConfigSave(dir: string, json: string): void {
  JSON.parse(json); // zapis nie ma zostawić pliku, którego sami potem nie przeczytamy
  fs.mkdirSync(dir, { recursive: true });
  writeAtomic(path.join(dir, FILE), json);
}

/** Wynik `{ text }` z silnika. `language` = `auto` pomija pole i zostawia wykrywanie modelowi. */
export async function transcribe(
  p: SttProvider,
  key: string | null,
  audio: Uint8Array,
  mime: string,
  language: string,
  signal?: AbortSignal,
): Promise<string> {
  if (audio.byteLength === 0) throw new Error("puste nagranie");
  if (audio.byteLength > MAX_AUDIO_BYTES) throw new Error(t("stt.tooBig"));
  if (p.key && !key) throw new Error(t("stt.noKey", { name: p.name }));
  // Nagłówek HTTP przyjmuje tylko ASCII; klucz wklejony z dopiskiem dałby niezrozumiały błąd `ByteString`.
  if (key && !/^[\x21-\x7e]+$/.test(key)) throw new Error("klucz API zawiera spacje albo niedozwolone znaki (wklejony z dopiskiem?)");
  const form = new FormData();
  form.set("file", new Blob([audio], { type: mime || "audio/webm" }), `nagranie.${audioExt(mime)}`);
  form.set("model", p.model);
  form.set("response_format", "json");
  if (language !== "auto") form.set("language", language);
  const url = `${p.baseUrl}/audio/transcriptions`;
  const timeout = AbortSignal.timeout(TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: key ? { authorization: `Bearer ${key}` } : {},
      body: form,
      signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
    });
  } catch (e) {
    if (isAbort(e) && !signal?.aborted) throw new Error(t("stt.timeout", { s: TIMEOUT_MS / 1000 }));
    if (signal?.aborted) throw e;
    throw networkError(e, url);
  }
  if (!res.ok) throw await httpError(res);
  let body: { text?: unknown };
  try {
    body = (await res.json()) as { text?: unknown };
  } catch {
    throw new Error(t("stt.notJson"));
  }
  if (typeof body.text !== "string") throw new Error(t("stt.noText"));
  return body.text;
}
