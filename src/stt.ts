// Dyktowanie głosem (mikrofon w nagłówku panelu): konfiguracja silników transkrypcji i drobne
// funkcje czyste. Każdy silnik to serwer z `POST {baseUrl}/audio/transcriptions` (multipart, jak
// OpenAI): OpenRouter, cortecs.ai, OpenAI i lokalne serwery (whisper.cpp, speaches) mówią tak samo.

export type SttProvider = {
  id: string;
  name: string;
  /** Bez końcowego `/`; do niego dopisujemy `/audio/transcriptions`. */
  baseUrl: string;
  model: string;
  /** Zmienna środowiskowa z kluczem, gdy nie ma go w sejfie. */
  keyEnv?: string;
  /** false = serwer lokalny bez klucza. */
  key: boolean;
};

export type SttConfig = {
  /** Id wybranego silnika; `null` = nic nie ustawiono (mikrofon otwiera ustawienia). */
  active: string | null;
  /** Kod języka dla modelu (`pl`, `en`) albo `auto`. */
  language: string;
  /** `deviceId` mikrofonu z przeglądarki; pusty = domyślny mikrofon systemu. */
  mic: string;
  providers: SttProvider[];
};

export const STT_PRESETS: SttProvider[] = [
  { id: "openrouter", name: "OpenRouter", baseUrl: "https://openrouter.ai/api/v1", model: "openai/whisper-large-v3", keyEnv: "OPENROUTER_API_KEY", key: true },
  { id: "cortecs", name: "cortecs.ai", baseUrl: "https://api.cortecs.ai/v1", model: "whisper-large-v3", keyEnv: "CORTECS_API_KEY", key: true },
  { id: "openai", name: "OpenAI", baseUrl: "https://api.openai.com/v1", model: "whisper-1", keyEnv: "OPENAI_API_KEY", key: true },
  { id: "local", name: "Lokalny serwer", baseUrl: "http://127.0.0.1:8080/v1", model: "whisper", key: false },
];

export const DEFAULT_STT: SttConfig = { active: null, language: "auto", mic: "", providers: [] };

const ID_RE = /^[a-z0-9][a-z0-9._-]*$/i;

/** Klucze silników leżą w tym samym sejfie co klucze czatu; prefiks rozdziela przestrzenie id. */
export const sttKeyId = (providerId: string) => `stt-${providerId}`;

/** `stt.json`; brak albo zepsuty plik = domyślna konfiguracja, a powód w `errors`. */
export function parseSttConfig(text: string | null): { config: SttConfig; errors: string[] } {
  if (text === null) return { config: DEFAULT_STT, errors: [] };
  let raw: Record<string, unknown>;
  try {
    raw = JSON.parse(text) as Record<string, unknown>;
  } catch {
    return { config: DEFAULT_STT, errors: ["stt.json: to nie jest JSON"] };
  }
  const errors: string[] = [];
  const providers: SttProvider[] = [];
  const seen = new Set<string>();
  const list = Array.isArray(raw?.providers) ? (raw.providers as Record<string, unknown>[]) : [];
  list.forEach((p, i) => {
    const where = `stt.json: silnik ${i + 1}`;
    if (!p || typeof p !== "object") return void errors.push(`${where}: nie jest obiektem`);
    const { id, name, baseUrl, model, keyEnv, key } = p;
    if (typeof id !== "string" || !ID_RE.test(id)) return void errors.push(`${where}: złe \`id\``);
    if (seen.has(id)) return void errors.push(`${where}: powtórzone id \`${id}\``);
    if (typeof baseUrl !== "string" || !/^https?:\/\//i.test(baseUrl)) return void errors.push(`${where}: \`baseUrl\` musi zaczynać się od http(s)://`);
    if (typeof model !== "string" || model.trim() === "") return void errors.push(`${where}: brak \`model\``);
    seen.add(id);
    providers.push({
      id,
      name: typeof name === "string" && name.trim() ? name : id,
      baseUrl: baseUrl.trim().replace(/\/+$/, ""),
      model: model.trim(),
      ...(typeof keyEnv === "string" && keyEnv ? { keyEnv } : {}),
      key: key !== false,
    });
  });
  const active = typeof raw?.active === "string" && seen.has(raw.active) ? raw.active : null;
  const language = typeof raw?.language === "string" && /^(auto|[a-z]{2,3})$/i.test(raw.language) ? raw.language.toLowerCase() : "auto";
  const mic = typeof raw?.mic === "string" ? raw.mic : "";
  return { config: { active, language, mic, providers }, errors };
}

export const sttConfigJson = (c: SttConfig) => JSON.stringify(c, null, 2);

/** Id wolne na liście: `base`, a gdy zajęte `base-2`, `base-3`… */
export function sttFreeId(base: string, taken: string[]): string {
  if (!taken.includes(base)) return base;
  let n = 2;
  while (taken.includes(`${base}-${n}`)) n++;
  return `${base}-${n}`;
}

/** Wybrany silnik albo `null`. */
export const activeStt = (c: SttConfig): SttProvider | null => c.providers.find((p) => p.id === c.active) ?? null;

/** Tekst do wklejenia w terminal: jedna linia, bez znaków sterujących. Nowa linia w wklejce
 *  bez bracketed paste byłaby Enterem, czyli wysłaniem połowy zdania, a tego nie chcemy. */
export function cleanTranscript(text: string): string {
  // eslint-disable-next-line no-control-regex
  return text.replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim();
}

/** Rozszerzenie pliku dla `MediaRecorder` (`audio/webm;codecs=opus` → `webm`); serwery zgadują format po nim. */
export function audioExt(mime: string): string {
  const m = /^audio\/([a-z0-9]+)/i.exec(mime)?.[1]?.toLowerCase();
  return m === "mpeg" ? "mp3" : m === "x-wav" ? "wav" : (m ?? "webm");
}

/** Pierwszy format nagrywania, który ta przeglądarka umie; Chromium w Electronie zna webm/opus. */
export function pickRecorderMime(supports: (mime: string) => boolean): string | undefined {
  return ["audio/webm;codecs=opus", "audio/webm", "audio/ogg;codecs=opus", "audio/mp4"].find(supports);
}

/** Ograniczenia dla `getUserMedia`: wybrany mikrofon (`ideal`, więc odpięty nie blokuje dyktowania) albo domyślny. */
export const micConstraints = (deviceId: string): { deviceId: { ideal: string } } | true =>
  deviceId ? { deviceId: { ideal: deviceId } } : true;

/** Nagranie krótsze niż to jest przypadkowym kliknięciem: nie wysyłamy go do API. */
export const MIN_RECORDING_MS = 400;
/** Twardy limit jednego nagrania; dłuższe i tak kończy się odrzuceniem przez większość API. */
export const MAX_RECORDING_MS = 5 * 60_000;
