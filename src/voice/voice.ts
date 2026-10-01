// Rozmowa głosowa (eksperyment, `docs/plan-glos.md`): konfiguracja, cięcie odpowiedzi na zdania
// dla TTS, tekst do czytania i stan rozmowy. Czyste funkcje — mikrofon, VAD i IPC są w hooku.

import { findModel, firstModel, type ChatModel, type ChatRequest, type ModelRef, type ProviderDef, type WireMessage } from "../chat";
import type { DeployCard } from "./tools";
import { getLang, t } from "../i18n";

// ── konfiguracja ────────────────────────────────────────────────────────────

/** `speech` = `POST {baseUrl}/audio/speech` jak OpenAI (też speaches, Kokoro-FastAPI);
 *  `piper` = lokalny proces, `model` to ścieżka do `.onnx`. */
export type TtsKind = "speech" | "piper";

export type TtsProvider = {
  id: string;
  name: string;
  kind: TtsKind;
  /** Tylko `speech`; bez końcowego `/`. */
  baseUrl?: string;
  model: string;
  /** Tylko `piper`: program (ścieżka albo nazwa z PATH); domyślnie `piper`. */
  command?: string;
  /** Głos, gdy w `voice.json` nie wybrano innego (`alloy`; Piper: pusty). */
  voice: string;
  keyEnv?: string;
  key: boolean;
};

export type TtsConfig = { providers: TtsProvider[] };

export type VoiceConfig = {
  /** Model z Czatu; `null` = nie wybrano (kuleczka otwiera ustawienia). */
  brain: ModelRef | null;
  /** Id silnika z `tts.json`. */
  tts: string | null;
  /** Pusty = głos domyślny silnika. */
  voice: string;
  /** Słuchawki: bez ochrony przed własnym echem, więc szybsze przerywanie. */
  headphones: boolean;
};

export const TTS_PRESETS: TtsProvider[] = [
  { id: "openai", name: "OpenAI", kind: "speech", baseUrl: "https://api.openai.com/v1", model: "gpt-4o-mini-tts", voice: "alloy", keyEnv: "OPENAI_API_KEY", key: true },
  { id: "local", name: "Lokalny serwer", kind: "speech", baseUrl: "http://127.0.0.1:8000/v1", model: "kokoro", voice: "", key: false },
  // Piper mówi głosem modelu, więc jest po jednym szablonie na język; id „piper” zostaje polskie (stare tts.json).
  { id: "piper", name: "Piper (polski)", kind: "piper", model: "~/.local/share/piper/pl_PL-bass-high.onnx", voice: "", key: false },
  { id: "piper-en", name: "Piper (English)", kind: "piper", model: "~/.local/share/piper/en_US-lessac-medium.onnx", voice: "", key: false },
];

export const DEFAULT_TTS: TtsConfig = { providers: [] };
export const DEFAULT_VOICE: VoiceConfig = { brain: null, tts: null, voice: "", headphones: false };

const ID_RE = /^[a-z0-9][a-z0-9._-]*$/i;

/** Klucze w tym samym sejfie co czat i dyktowanie; prefiks rozdziela przestrzenie id. */
export const ttsKeyId = (providerId: string) => `tts-${providerId}`;

function parseJson(text: string, file: string): { raw: Record<string, unknown> | null; error?: string } {
  try {
    const raw = JSON.parse(text) as unknown;
    if (raw && typeof raw === "object" && !Array.isArray(raw)) return { raw: raw as Record<string, unknown> };
    return { raw: null, error: t("voice.cfg.notObjectFile", { file }) };
  } catch {
    return { raw: null, error: t("voice.cfg.notJson", { file }) };
  }
}

/** `tts.json`; brak albo zepsuty plik = brak silników, a powód w `errors`. */
export function parseTtsConfig(text: string | null): { config: TtsConfig; errors: string[] } {
  if (text === null) return { config: DEFAULT_TTS, errors: [] };
  const { raw, error } = parseJson(text, "tts.json");
  if (!raw) return { config: DEFAULT_TTS, errors: [error!] };
  const errors: string[] = [];
  const providers: TtsProvider[] = [];
  const seen = new Set<string>();
  const list = Array.isArray(raw.providers) ? (raw.providers as Record<string, unknown>[]) : [];
  list.forEach((p, i) => {
    const where = t("voice.cfg.engine", { file: "tts.json", n: i + 1 });
    if (!p || typeof p !== "object") return void errors.push(t("voice.cfg.notObject", { where }));
    const { id, name, kind, baseUrl, model, command, voice, keyEnv, key } = p;
    if (typeof id !== "string" || !ID_RE.test(id)) return void errors.push(t("voice.cfg.badId", { where }));
    if (seen.has(id)) return void errors.push(t("voice.cfg.dupId", { where, id }));
    if (kind !== "speech" && kind !== "piper") return void errors.push(t("voice.cfg.badKind", { where }));
    if (kind === "speech" && (typeof baseUrl !== "string" || !/^https?:\/\//i.test(baseUrl)))
      return void errors.push(t("voice.cfg.badUrl", { where }));
    if (typeof model !== "string" || model.trim() === "") return void errors.push(t("voice.cfg.noModel", { where }));
    seen.add(id);
    providers.push({
      id,
      name: typeof name === "string" && name.trim() ? name : id,
      kind,
      ...(kind === "speech" ? { baseUrl: (baseUrl as string).trim().replace(/\/+$/, "") } : {}),
      model: model.trim(),
      ...(kind === "piper" && typeof command === "string" && command.trim() ? { command: command.trim() } : {}),
      voice: typeof voice === "string" ? voice.trim() : "",
      ...(typeof keyEnv === "string" && keyEnv ? { keyEnv } : {}),
      // Piper jest procesem lokalnym: klucz nie ma sensu, nawet gdy ktoś go wpisał.
      key: kind === "speech" && key !== false,
    });
  });
  return { config: { providers }, errors };
}

/** `voice.json`; złe pola = wartości domyślne. Istnienia modelu i silnika nie sprawdzamy tu,
 *  bo listy żyją w innych plikach (`chat.json`, `tts.json`). */
export function parseVoiceConfig(text: string | null): { config: VoiceConfig; errors: string[] } {
  if (text === null) return { config: DEFAULT_VOICE, errors: [] };
  const { raw, error } = parseJson(text, "voice.json");
  if (!raw) return { config: DEFAULT_VOICE, errors: [error!] };
  const errors: string[] = [];
  const b = raw.brain as Record<string, unknown> | null | undefined;
  let brain: ModelRef | null = null;
  if (b && typeof b === "object" && typeof b.provider === "string" && typeof b.model === "string" && b.provider && b.model)
    brain = { provider: b.provider, model: b.model };
  else if (b != null) errors.push(t("voice.cfg.badBrain"));
  const tts = typeof raw.tts === "string" && ID_RE.test(raw.tts) ? raw.tts : null;
  if (raw.tts != null && tts === null) errors.push(t("voice.cfg.badTts"));
  return {
    config: {
      brain,
      tts,
      voice: typeof raw.voice === "string" ? raw.voice.trim() : "",
      headphones: raw.headphones === true,
    },
    errors,
  };
}

export const ttsConfigJson = (c: TtsConfig) => JSON.stringify(c, null, 2);
export const voiceConfigJson = (c: VoiceConfig) => JSON.stringify(c, null, 2);

/** Wybrany silnik TTS albo `null`. */
export const activeTts = (tts: TtsConfig, voice: VoiceConfig): TtsProvider | null =>
  tts.providers.find((p) => p.id === voice.tts) ?? null;

// ── zdania dla TTS ──────────────────────────────────────────────────────────

/** Skróty, po których kropka nie kończy zdania (małe litery, bez kropki). „itd.”, „itp.” często
 *  kończą zdanie, więc ich tu nie ma: rozstrzyga wielkość następnej litery. */
const ABBREV = new Set([
  "np", "tzn", "tzw", "tj", "m.in", "dr", "mgr", "inż", "prof", "ok", "ul", "nr", "wg", "zob", "por", "godz", "ds", "pt", "e.g", "i.e", "vs",
]);
/** Dłuższe zdanie tniemy na przecinku, żeby TTS ruszył szybciej. */
export const MAX_SENTENCE = 200;

/** Czy kropka/znak na pozycji `i` (ostatni znak serii `.?!…`) kończy zdanie. */
function endsSentence(text: string, start: number, i: number): boolean {
  const mark = text.slice(start, i + 1);
  if (mark === ".") {
    const word = /([\p{L}.]+)$/u.exec(text.slice(0, start))?.[1]?.toLowerCase() ?? "";
    if (ABBREV.has(word) || ABBREV.has(word.replace(/^.*\./, ""))) return false;
    // Inicjał („J. Kowalski”) i liczebnik porządkowy („3. punkt”).
    if (/(^|[^\p{L}])\p{Lu}$/u.test(text.slice(0, start)) || /\d$/.test(text.slice(0, start))) {
      const next = /\S/u.exec(text.slice(i + 1));
      if (!next || /\p{L}/u.test(next[0])) return false;
    }
  }
  // Po granicy następne zdanie zaczyna się małą literą = to nie była granica („…, tj. tak”).
  const next = /\S/u.exec(text.slice(i + 1))?.[0];
  return !(next && mark === "." && /\p{Ll}/u.test(next));
}

/**
 * Tnie strumień odpowiedzi na gotowe zdania. `rest` czeka na kolejne kawałki; `final` = koniec
 * odpowiedzi, więc reszta też jest zdaniem. Granica musi mieć po sobie biały znak (inaczej
 * „3.5” albo „…” w połowie strumienia), a w otwartym bloku kodu nie tniemy wcale.
 */
export function splitSentences(buffer: string, final = false): { ready: string[]; rest: string } {
  const ready: string[] = [];
  let from = 0;
  let fence = false;
  for (let i = 0; i < buffer.length; i++) {
    if (buffer.startsWith("```", i)) {
      fence = !fence;
      i += 2;
      continue;
    }
    if (fence) continue;
    const c = buffer[i];
    if (c === "\n" && buffer[i + 1] === "\n") {
      push(i);
      continue;
    }
    if (!".?!…".includes(c)) continue;
    let end = i;
    while (end + 1 < buffer.length && ".?!…".includes(buffer[end + 1])) end++;
    const after = buffer[end + 1];
    if (after !== undefined && /\s/.test(after) && endsSentence(buffer, i, end)) push(end + 1);
    i = end;
  }
  function push(to: number) {
    const s = buffer.slice(from, to).trim();
    if (s) ready.push(s);
    from = to;
  }
  let rest = buffer.slice(from);
  // Za długie bez granicy: tniemy na ostatnim przecinku (albo spacji) przed limitem.
  while (!fence && rest.trim().length > MAX_SENTENCE) {
    const head = rest.trimStart().slice(0, MAX_SENTENCE);
    const cut = Math.max(head.lastIndexOf(", "), head.lastIndexOf("; "), head.lastIndexOf(": "));
    const at = cut > 40 ? cut + 1 : head.lastIndexOf(" ");
    if (at <= 0) break;
    ready.push(head.slice(0, at).trim());
    rest = rest.trimStart().slice(at);
  }
  if (final) {
    if (rest.trim()) ready.push(rest.trim());
    rest = "";
  }
  return { ready, rest };
}

/** Markdown → tekst do przeczytania na głos. Kod nie jest czytany, linki zostawiają opis. */
export function speakable(md: string): string {
  return md
    .replace(/```[\s\S]*?(```|$)/g, t("voice.speak.code"))
    .replace(/`([^`]*)`/g, "$1")
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/https?:\/\/\S+/g, "link")
    .replace(/^\s{0,3}(#{1,6}|>|[-*+]|\d+[.)])\s+/gm, "")
    .replace(/(?<![\p{L}\d])(\*\*|__|\*|_|~~)(?=\S)([^*_~]*?\S)\1(?![\p{L}\d])/gu, "$2")
    .replace(/\|/g, " ")
    .replace(/\p{Extended_Pictographic}️?/gu, "")
    .replace(/\s+/g, " ")
    .trim();
}

// ── stan rozmowy ────────────────────────────────────────────────────────────

export type VoicePhase = "idle" | "listening" | "transcribing" | "thinking" | "speaking";

/** Jedna wymiana: pytanie i odpowiedź. Znaczniki czasu (ms) pozwalają zmierzyć opóźnienie kroków. */
export type VoiceExchange = {
  user: string;
  /** Cały tekst od modelu (także ten, którego nie zdążył przeczytać). */
  reply: string;
  /** Zdania, które zaczęły grać — tyle użytkownik usłyszał. */
  spoken: string[];
  done: boolean;
  interrupted?: boolean;
  error?: string;
  /** Narzędzia użyte w tej odpowiedzi (etap 5), do zapisu rozmowy. */
  tools?: { label: string; ok: boolean }[];
  t: { heard?: number; text?: number; first?: number; audio?: number };
};

export type VoiceState = {
  phase: VoicePhase;
  /** Użytkownik właśnie mówi (VAD). */
  hearing: boolean;
  history: VoiceExchange[];
  /** Transkrypt, który przyszedł, gdy użytkownik zaczął mówić dalej: dokleja się do następnego. */
  carry: string;
  /** Koniec ostatniej wypowiedzi (VAD), czeka na transkrypt. */
  heardAt?: number;
  error?: string;
  /** Karta czeka na decyzję (narzędzia z potwierdzeniem). */
  card?: DeployCard;
  /** Komunikaty aplikacji („claude skończył pracę”); `after` = tyle wymian było przed nim. */
  notes?: { text: string; after: number }[];
};

/** `n` = numer wymiany, której dotyczy zdarzenie: spóźnione zdarzenia z przerwanej odpowiedzi
 *  nie mogą trafić do nowej. */
export type VoiceEvent =
  | { type: "start" }
  | { type: "stop" }
  | { type: "speech_start" }
  | { type: "speech_end"; at: number }
  | { type: "transcript"; text: string; at: number }
  | { type: "delta"; n: number; text: string; at: number }
  | { type: "audio_start"; n: number; text: string; at: number }
  | { type: "reply_done"; n: number }
  | { type: "audio_idle"; n: number }
  | { type: "interrupt" }
  | { type: "tool"; n: number; label: string; ok: boolean }
  | { type: "card"; card: DeployCard | null }
  | { type: "note"; text: string }
  | { type: "error"; message: string; n?: number };

export const VOICE_IDLE: VoiceState = { phase: "idle", hearing: false, history: [], carry: "" };

const replaceLast = (h: VoiceExchange[], f: (e: VoiceExchange) => VoiceExchange) =>
  h.length ? [...h.slice(0, -1), f(h[h.length - 1])] : h;

/** Przerywa trwającą odpowiedź: zostaje to, co już zagrało. */
function cut(s: VoiceState): VoiceState {
  const last = s.history[s.history.length - 1];
  if ((s.phase !== "thinking" && s.phase !== "speaking") || !last) return s;
  return { ...s, phase: "listening", history: replaceLast(s.history, (e) => ({ ...e, done: true, interrupted: true })) };
}

export function voiceReducer(s: VoiceState, ev: VoiceEvent): VoiceState {
  const n = s.history.length - 1;
  const current = (m: number) => m === n && !s.history[n]?.interrupted;
  switch (ev.type) {
    case "start":
      return s.phase === "idle" ? { ...VOICE_IDLE, phase: "listening" } : s;
    case "stop":
      return { ...cut(s), phase: "idle", hearing: false, carry: "", heardAt: undefined, card: undefined };
    case "speech_start":
      if (s.phase === "idle") return s;
      // Przy karcie mowa to odpowiedź na kartę („tak”, „popraw…”), nie przerwanie.
      if (s.card) return { ...s, hearing: true };
      // Zanim cokolwiek zagra, mowa nie przerywa: szum albo kaszel nie zabije wolnej odpowiedzi
      // (model lokalny ładuje się kilka sekund). Przerywa dopiero niepusty transkrypt.
      if (s.phase === "thinking") return { ...s, hearing: true, error: undefined };
      return { ...cut(s), hearing: true, error: undefined };
    case "speech_end":
      if (s.phase === "idle") return s;
      return { ...s, hearing: false, phase: s.phase === "listening" ? "transcribing" : s.phase, heardAt: ev.at };
    case "transcript": {
      if (s.phase === "idle") return s;
      const text = [s.carry, ev.text.trim()].filter(Boolean).join(" ");
      // Użytkownik mówi dalej albo już skończył następny kawałek: czekamy na resztę.
      if (s.hearing) return { ...s, carry: text };
      if (s.phase === "thinking") {
        if (!text) return { ...s, carry: "" };
        const ex: VoiceExchange = { user: text, reply: "", spoken: [], done: false, t: { heard: s.heardAt, text: ev.at } };
        return { ...s, carry: "", history: [...cut(s).history, ex] };
      }
      if (s.phase !== "transcribing") return { ...s, carry: text };
      if (!text) return { ...s, phase: "listening", carry: "" };
      const ex: VoiceExchange = { user: text, reply: "", spoken: [], done: false, t: { heard: s.heardAt, text: ev.at } };
      return { ...s, phase: "thinking", carry: "", history: [...s.history, ex] };
    }
    case "delta":
      if (!current(ev.n) || s.history[n].done) return s;
      return { ...s, history: replaceLast(s.history, (e) => ({ ...e, reply: e.reply + ev.text, t: { ...e.t, first: e.t.first ?? ev.at } })) };
    case "audio_start":
      if (!current(ev.n)) return s;
      return {
        ...s,
        phase: "speaking",
        history: replaceLast(s.history, (e) => ({ ...e, spoken: [...e.spoken, ev.text], t: { ...e.t, audio: e.t.audio ?? ev.at } })),
      };
    case "reply_done":
      if (!current(ev.n)) return s;
      return { ...s, history: replaceLast(s.history, (e) => ({ ...e, done: true })) };
    case "audio_idle":
      // Kolejka zagrała wszystko; gdy model skończył, wracamy do słuchania.
      if (!current(ev.n) || !s.history[n].done || (s.phase !== "speaking" && s.phase !== "thinking")) return s;
      return { ...s, phase: "listening" };
    case "interrupt":
      return cut(s);
    case "tool":
      if (!current(ev.n)) return s;
      return { ...s, history: replaceLast(s.history, (e) => ({ ...e, tools: [...(e.tools ?? []), { label: ev.label, ok: ev.ok }] })) };
    case "note":
      if (s.phase === "idle") return s;
      return { ...s, notes: [...(s.notes ?? []), { text: ev.text, after: s.history.length }] };
    case "card":
      if (!ev.card && !s.card) return s;
      return { ...s, card: ev.card ?? undefined };
    case "error": {
      if (s.phase === "idle") return s;
      if (ev.n !== undefined && !current(ev.n)) return s;
      const history = ev.n !== undefined ? replaceLast(s.history, (e) => ({ ...e, done: true, error: ev.message })) : s.history;
      return { ...s, phase: "listening", history, error: ev.message };
    }
  }
}

/** Czasy kroków wymiany (ms): transkrypcja, pierwsze słowo modelu, synteza pierwszego zdania,
 *  razem od końca mowy do pierwszego dźwięku. Brak znacznika = brak liczby. */
export function exchangeTimes(e: VoiceExchange): { stt?: number; model?: number; voice?: number; total?: number } {
  const d = (a?: number, b?: number) => (a !== undefined && b !== undefined ? Math.max(0, Math.round(b - a)) : undefined);
  return { stt: d(e.t.heard, e.t.text), model: d(e.t.text, e.t.first), voice: d(e.t.first, e.t.audio), total: d(e.t.heard, e.t.audio) };
}

/** „1,4 s” / „350 ms” */
export const fmtMs = (ms: number) => (ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(1).replace(".", getLang() === "pl" ? "," : ".")} s`);

/** Najwięcej wymian wysyłanych modelowi; starsze odpadają. */
export const MAX_EXCHANGES = 30;
export const INTERRUPTED = "[przerwano]";

/** Historia dla `ChatRequest.messages`. Przerwana odpowiedź = tylko to, co zdążył powiedzieć,
 *  bo reszty użytkownik nie słyszał. Kolejne pytania bez odpowiedzi (błąd) łączą się w jedno. */
export function voiceTurns(history: VoiceExchange[], max = MAX_EXCHANGES): WireMessage[] {
  const out: WireMessage[] = [];
  for (const e of history.slice(-max)) {
    const prev = out[out.length - 1];
    if (prev?.role === "user") prev.content += `\n${e.user}`;
    else out.push({ role: "user", content: e.user });
    const said = e.interrupted ? [e.spoken.join(" "), INTERRUPTED].filter(Boolean).join(" ") : e.reply.trim();
    if (said && (e.done || e.interrupted)) out.push({ role: "assistant", content: said });
  }
  return out;
}

/** Tekst dla mózgu na CLI (`claude -p`): cała rozmowa jednym promptem. */
export function voiceCliPrompt(history: VoiceExchange[]): string {
  const turns = voiceTurns(history);
  if (turns.length === 1) return turns[0].content;
  return turns.map((m) => `${m.role === "user" ? "Użytkownik" : "Asystent"}: ${m.content}`).join("\n\n");
}

/** Mózg rozmowy: wybrany w `voice.json` albo pierwszy model z Czatu. Model wykrywany przez
 *  `GET /models` (`discover`) nie musi być na liście z pliku. */
export function resolveBrain(providers: ProviderDef[], ref: ModelRef | null): { provider: ProviderDef; model: ChatModel } | null {
  const r = ref ?? firstModel(providers);
  if (!r) return null;
  const found = findModel(providers, r);
  if (found) return found;
  const provider = providers.find((p) => p.id === r.provider);
  return provider?.discover ? { provider, model: { id: r.model, name: r.model } } : null;
}

/** Żądanie do mózgu: dostawcy HTTP biorą `messages`, CLI `prompt` z całą rozmową (bez sesji:
 *  przerwana odpowiedź ma zostać w historii tylko w tej części, którą użytkownik usłyszał). */
export function voiceRequest(provider: ProviderDef, model: string, history: VoiceExchange[], system: string): ChatRequest {
  return { provider, model, system, messages: voiceTurns(history), prompt: voiceCliPrompt(history), search: false };
}

/** Prompt systemowy rozmówcy. Ten sam stan daje ten sam tekst (bez sekund w dacie). */
export function voicePrompt(now: Date, overview?: string): string {
  const date = new Intl.DateTimeFormat("pl-PL", {
    timeZone: "Europe/Warsaw", weekday: "long", year: "numeric", month: "long", day: "numeric", hour: "2-digit", minute: "2-digit",
  }).format(now);
  const lines = [
    "Rozmawiasz z użytkownikiem głosem. Twoje odpowiedzi są czytane na głos przez syntezator mowy.",
    "- Mów krótko i naturalnie: zwykle 1–3 zdania. Dłużej tylko, gdy użytkownik o to prosi.",
    "- Bez markdownu, list, tabel, emoji i kodu. Liczby i skróty zapisuj tak, jak się je wymawia.",
    "- Gdy coś jest niejasne, dopytaj jednym pytaniem zamiast zgadywać.",
    "- Odpowiadaj w języku, którym mówi użytkownik.",
    "- Transkrypcja mowy bywa niedokładna: domyśl się sensu przekręconych słów.",
    `Teraz jest ${date}.`,
  ];
  if (overview !== undefined) {
    lines.push(
      "",
      "Jesteś też asystentem aplikacji Agents: użytkownik ma w niej projekty, a w nich panele z agentami (claude, pi)",
      "pracującymi w terminalach. Masz narzędzia, żeby sprawdzać ich postępy i nimi sterować.",
      "- Pytany o postępy albo „co się dzieje”: overview, a po szczegóły read_pane; streść krótko, najpierw to, co wymaga uwagi.",
      "- Gdy użytkownik zatwierdzi plan („OK, deploy”, „zaczynajmy”): podziel go na niezależne zadania i wywołaj open_panes.",
      "  Każde zadanie opisz tak, żeby agent mógł je wykonać bez tej rozmowy.",
      "- „Pokaż”, „przełącz”, „otwórz zakładkę”: show – działa od razu.",
      "- Wysyłka, zatrzymanie, restart, zamknięcie, kontynuacja, preset: użytkownik zatwierdza kartą. Zanim wywołasz takie",
      "  narzędzie, powiedz jednym zdaniem, co proponujesz – karta pokaże szczegóły.",
      "- Boty z zakładki Bot pytasz przez ask_bot (bez nazwy dostaniesz listę).",
      "- Nie czytaj na głos id paneli ani poleceń dla agentów – mów o agencie, tytule i projekcie.",
      "",
      "Stan teraz (odśwież przez overview, gdy minęło trochę czasu):",
      overview,
    );
  }
  return lines.join("\n");
}
