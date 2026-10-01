/** Zakładka Czat (M3): model rozmów i dostawców. Czyste funkcje, bez Reacta i IPC.
 *  Typy żądania i zdarzeń (`ChatRequest`, `ChatEvent`) są wspólne ze `electron/src/chat/`. */

export type ProviderKind = "claude-cli" | "codex-cli" | "openai" | "anthropic";
/** Grupa w menu modeli: subskrypcja (program CLI), API z kluczem, serwer lokalny. */
export type ProviderGroup = "sub" | "api" | "local";

export type ChatModel = { id: string; name: string };

export type ProviderDef = {
  id: string;
  name: string;
  kind: ProviderKind;
  group: ProviderGroup;
  baseUrl?: string; // openai / anthropic
  command?: string; // claude-cli / codex-cli; domyślnie `claude` / `codex`
  key?: boolean; // wymaga klucza API (zapisany w procesie głównym, nie tutaj)
  models: ChatModel[];
  discover?: boolean; // modele dopisywane z `GET {baseUrl}/models` (codex: z jego pamięci podręcznej)
};

export type ModelRef = { provider: string; model: string };
export type Source = { url: string; title: string };

export type Message = {
  id: string;
  role: "user" | "assistant";
  text: string;
  at: number;
  model?: ModelRef; // tylko odpowiedzi
  thinking?: string;
  searches?: string[];
  found?: Source[]; // strony z wyników wyszukiwania (licznik „Przeszukano N stron”)
  sources?: Source[]; // źródła przypisów [n]
  error?: string;
  stopped?: boolean; // przerwane przyciskiem Stop
  ms?: number; // czas odpowiedzi
};

export type Chat = {
  version: 1;
  id: string;
  title: string;
  created: number;
  updated: number;
  model: ModelRef;
  search: boolean;
  messages: Message[];
  /** Sesje programów CLI: `modelKey` → id sesji (claude `--resume`, codex `resume`). */
  cli: Record<string, string>;
};

export type ChatMeta = { id: string; title: string; updated: number };

/** Wiadomość w formacie API (OpenAI / Anthropic). */
export type WireMessage = { role: "user" | "assistant"; content: string };

export type ChatRequest = {
  provider: ProviderDef;
  model: string;
  system: string;
  /** Cała historia razem z ostatnim pytaniem (dostawcy HTTP). */
  messages: WireMessage[];
  /** Tekst dla programu CLI: samo pytanie albo pytanie z wcześniejszą rozmową (`cliPrompt`). */
  prompt: string;
  /** Sesja CLI: `resume` = istniejąca, inaczej nowa o tym id (claude) albo nowa bez id (codex). */
  session?: { id: string; resume: boolean };
  search: boolean;
};

export type ChatEvent =
  | { type: "text"; text: string }
  | { type: "thinking"; text: string }
  | { type: "search"; query: string }
  | { type: "source"; url: string; title: string } // źródło przypisu, w kolejności numerów
  | { type: "found"; url: string; title: string } // strona z wyników wyszukiwania
  | { type: "session"; id: string }
  | { type: "done" }
  | { type: "error"; message: string };

export const DEFAULT_PROVIDERS: ProviderDef[] = [
  {
    id: "claude",
    name: "Claude",
    kind: "claude-cli",
    group: "sub",
    command: "claude",
    models: [
      { id: "claude-opus-5-5", name: "Opus 5.5" },
      { id: "claude-sonnet-5-5", name: "Sonnet 5.5" },
      { id: "haiku", name: "Haiku 4.5" },
    ],
  },
  {
    id: "chatgpt",
    name: "ChatGPT",
    kind: "codex-cli",
    group: "sub",
    command: "codex",
    models: [
      { id: "gpt-5.6-luna", name: "GPT-5.6 Luna" },
      { id: "gpt-5.6-terra", name: "GPT-5.6 Terra" },
      { id: "gpt-5.5", name: "GPT-5.5" },
    ],
    discover: true, // ~/.codex/models_cache.json
  },
  {
    id: "llama",
    name: "llama-server",
    kind: "openai",
    group: "local",
    baseUrl: "http://127.0.0.1:8080/v1",
    models: [],
    discover: true,
  },
];

export const DEFAULT_SYSTEM =
  "Jesteś pomocnym asystentem w zwykłej rozmowie. Odpowiadaj w języku pytania, zwięźle i konkretnie. " +
  "Formatuj w markdownie, kod w blokach z nazwą języka.";

export const SEARCH_SYSTEM =
  " Masz wyszukiwanie w sieci: używaj go do faktów, które mogą być nieaktualne. Oznaczaj fakty przypisami [1], [2]. " +
  "Na samym końcu dodaj sekcję `Źródła:` z wierszami `[n] Tytuł — URL` (tylko adresy z wyników wyszukiwania).";

const KINDS: ProviderKind[] = ["claude-cli", "codex-cli", "openai", "anthropic"];
const GROUPS: ProviderGroup[] = ["sub", "api", "local"];
const ID_RE = /^[a-z0-9][a-z0-9._-]*$/i;

export const modelKey = (r: ModelRef) => `${r.provider}/${r.model}`;
export const isCli = (p: ProviderDef) => p.kind === "claude-cli" || p.kind === "codex-cli";

function parseModels(raw: unknown): ChatModel[] | null {
  if (!Array.isArray(raw)) return null;
  const out: ChatModel[] = [];
  for (const m of raw) {
    if (typeof m === "string") out.push({ id: m, name: m });
    else if (m && typeof m.id === "string") out.push({ id: m.id, name: typeof m.name === "string" ? m.name : m.id });
  }
  return out;
}

/** `chat.json`: `{ providers: [...] }`. Złe wpisy pominięte i opisane; pusty wynik = domyślni. */
export function parseChatConfig(raw: unknown): { providers: ProviderDef[]; errors: string[] } {
  const errors: string[] = [];
  const list = (raw as { providers?: unknown })?.providers;
  if (!Array.isArray(list)) return { providers: DEFAULT_PROVIDERS, errors: ["chat.json: brak tablicy `providers`"] };
  const providers: ProviderDef[] = [];
  const seen = new Set<string>();
  list.forEach((p: Record<string, unknown>, i) => {
    const where = `chat.json: dostawca ${i + 1}`;
    if (!p || typeof p !== "object") return void errors.push(`${where}: nie jest obiektem`);
    const id = p.id;
    if (typeof id !== "string" || !ID_RE.test(id)) return void errors.push(`${where}: złe \`id\``);
    if (seen.has(id)) return void errors.push(`${where}: powtórzone id \`${id}\``);
    const kind = p.kind as ProviderKind;
    if (!KINDS.includes(kind)) return void errors.push(`${where} (${id}): nieznany \`kind\``);
    const group = (GROUPS.includes(p.group as ProviderGroup) ? p.group : kind.endsWith("-cli") ? "sub" : "api") as ProviderGroup;
    const models = parseModels(p.models ?? []);
    if (!models) return void errors.push(`${where} (${id}): \`models\` musi być tablicą`);
    if ((kind === "openai" || kind === "anthropic") && typeof p.baseUrl !== "string")
      return void errors.push(`${where} (${id}): brak \`baseUrl\``);
    seen.add(id);
    providers.push({
      id,
      name: typeof p.name === "string" ? p.name : id,
      kind,
      group,
      ...(typeof p.baseUrl === "string" ? { baseUrl: p.baseUrl.replace(/\/+$/, "") } : {}),
      ...(typeof p.command === "string" ? { command: p.command } : {}),
      ...(p.key === true ? { key: true } : {}),
      ...(p.discover === true ? { discover: true } : {}),
      models,
    });
  });
  return providers.length ? { providers, errors } : { providers: DEFAULT_PROVIDERS, errors };
}

const isLocalUrl = (url: string) => /^https?:\/\/(127\.|localhost|\[::1\]|0\.0\.0\.0)/.test(url);

/** Dostawcy z `~/.pi/agent/models.json` (`providers.<id>.baseUrl/api/models`) jako `openai`. */
export function importPiProviders(raw: unknown): ProviderDef[] {
  const providers = (raw as { providers?: Record<string, Record<string, unknown>> })?.providers;
  if (!providers || typeof providers !== "object") return [];
  const out: ProviderDef[] = [];
  for (const [id, p] of Object.entries(providers)) {
    if (!p || typeof p.baseUrl !== "string" || !ID_RE.test(id)) continue;
    if (typeof p.api === "string" && !p.api.startsWith("openai")) continue;
    const local = isLocalUrl(p.baseUrl);
    out.push({
      id,
      name: id,
      kind: "openai",
      group: local ? "local" : "api",
      baseUrl: p.baseUrl.replace(/\/+$/, ""),
      ...(local ? {} : { key: true }),
      models: parseModels(p.models) ?? [],
    });
  }
  return out;
}

/** Dostawcy z pliku + z pi, bez powtórzeń id i adresów (wygrywa plik). */
export function mergeProviders(own: ProviderDef[], extra: ProviderDef[]): ProviderDef[] {
  const ids = new Set(own.map((p) => p.id));
  const urls = new Set(own.map((p) => p.baseUrl).filter(Boolean));
  return [...own, ...extra.filter((p) => !ids.has(p.id) && !(p.baseUrl && urls.has(p.baseUrl)))];
}

/** Modele wykryte z `/models` dopisane do listy (bez powtórzeń, kolejność: znane, potem nowe). */
export function withDiscovered(p: ProviderDef, ids: string[]): ProviderDef {
  const known = new Set(p.models.map((m) => m.id));
  return { ...p, models: [...p.models, ...ids.filter((id) => !known.has(id)).map((id) => ({ id, name: id }))] };
}

export function findModel(providers: ProviderDef[], ref: ModelRef): { provider: ProviderDef; model: ChatModel } | null {
  const provider = providers.find((p) => p.id === ref.provider);
  const model = provider?.models.find((m) => m.id === ref.model);
  return provider && model ? { provider, model } : null;
}

/** Pierwszy model z listy: grupa lokalna, potem subskrypcje, potem API. */
export function firstModel(providers: ProviderDef[]): ModelRef | null {
  for (const g of ["local", "sub", "api"] as ProviderGroup[])
    for (const p of providers) if (p.group === g && p.models[0]) return { provider: p.id, model: p.models[0].id };
  return null;
}

/** Krótka nazwa modelu pod odpowiedzią i na przycisku menu. */
export function modelLabel(providers: ProviderDef[], ref: ModelRef | undefined): string {
  if (!ref) return "";
  const f = findModel(providers, ref);
  if (f) return f.model.name === f.model.id || f.provider.group === "local" ? f.model.name : `${f.provider.name} ${f.model.name}`;
  return ref.model || ref.provider;
}

export function newChat(id: string, now: number, model: ModelRef, search = false): Chat {
  return { version: 1, id, title: "", created: now, updated: now, model, search, messages: [], cli: {} };
}

/** Tytuł z pierwszego pytania: jedna linia, ≤ 60 znaków, ucięty na granicy słowa. */
export function chatTitle(prompt: string): string {
  const line = prompt.replace(/\s+/g, " ").trim();
  if (line.length <= 60) return line;
  const cut = line.slice(0, 60);
  const space = cut.lastIndexOf(" ");
  return `${(space > 30 ? cut.slice(0, space) : cut).replace(/[\s,.;:–-]+$/, "")}…`;
}

export const displayTitle = (c: { title: string }) => c.title || "Nowa rozmowa";

/** Plik rozmowy; `null` = nie da się odczytać (zły JSON, inna wersja). */
export function parseChat(text: string): Chat | null {
  try {
    const c = JSON.parse(text) as Partial<Chat>;
    if (c?.version !== 1 || typeof c.id !== "string" || !Array.isArray(c.messages)) return null;
    return { ...c, search: c.search ?? false, cli: c.cli ?? {}, title: c.title ?? "" } as Chat;
  } catch {
    return null;
  }
}

export const chatMeta = (c: Chat): ChatMeta => ({ id: c.id, title: c.title, updated: c.updated });

export const sortChats = (list: ChatMeta[]) => [...list].sort((a, b) => b.updated - a.updated);

export type DayGroup = "Dziś" | "Wczoraj" | "Ostatnie 7 dni" | "Ostatnie 30 dni" | "Starsze";

/** Grupa na liście rozmów, liczona od północy czasu lokalnego. */
export function dayGroup(at: number, now: number): DayGroup {
  const midnight = new Date(now);
  midnight.setHours(0, 0, 0, 0);
  const day = 86_400_000;
  const t = midnight.getTime();
  if (at >= t) return "Dziś";
  if (at >= t - day) return "Wczoraj";
  if (at >= t - 6 * day) return "Ostatnie 7 dni";
  if (at >= t - 29 * day) return "Ostatnie 30 dni";
  return "Starsze";
}

export function groupChats(list: ChatMeta[], now: number): { group: DayGroup; chats: ChatMeta[] }[] {
  const out: { group: DayGroup; chats: ChatMeta[] }[] = [];
  for (const c of sortChats(list)) {
    const g = dayGroup(c.updated, now);
    const last = out[out.length - 1];
    if (last?.group === g) last.chats.push(c);
    else out.push({ group: g, chats: [c] });
  }
  return out;
}

/** Historia do API: bez odpowiedzi z błędem i bez pustych (Stop przed pierwszym tokenem). */
export function wireHistory(messages: Message[]): WireMessage[] {
  const out: WireMessage[] = [];
  for (const m of messages) {
    if (m.role === "assistant" && (m.error || m.text.trim() === "")) continue;
    // Dwa pytania pod rząd (odpowiedź z błędem wypadła): API Anthropic wymaga przemienności.
    const last = out[out.length - 1];
    if (last?.role === m.role) last.content += `\n\n${m.text}`;
    else out.push({ role: m.role, content: m.text });
  }
  return out;
}

const CONTEXT_LIMIT = 8000;

/** Tekst dla programu CLI. Gdy rozmowa ma wcześniejsze wiadomości, a ten model nie ma jeszcze
 *  sesji (zmiana modelu w środku rozmowy), wcześniejsza rozmowa idzie jako tło, od najnowszych
 *  do limitu znaków. `messages` bez ostatniego pytania. */
export function cliPrompt(messages: Message[], hasSession: boolean, text: string): string {
  if (hasSession) return text;
  const history = wireHistory(messages);
  if (history.length === 0) return text;
  const parts: string[] = [];
  let size = 0;
  for (let i = history.length - 1; i >= 0; i--) {
    const m = history[i];
    const part = `${m.role === "user" ? "Użytkownik" : "Asystent"}: ${m.content}`;
    if (size + part.length > CONTEXT_LIMIT) {
      if (parts.length === 0) parts.unshift(`${part.slice(0, CONTEXT_LIMIT)}…`);
      break;
    }
    parts.unshift(part);
    size += part.length;
  }
  return `Wcześniejsza część tej rozmowy (z innym modelem), jako tło:\n\n${parts.join("\n\n")}\n\n---\n\n${text}`;
}

/** Zdarzenie strumienia dopisane do odpowiedzi (nowy obiekt, wejście bez zmian). */
export function applyEvent(m: Message, e: ChatEvent): Message {
  switch (e.type) {
    case "text":
      return { ...m, text: m.text + e.text };
    case "thinking":
      return { ...m, thinking: (m.thinking ?? "") + e.text };
    case "search":
      return { ...m, searches: [...(m.searches ?? []), e.query] };
    case "source":
      if (m.sources?.some((s) => s.url === e.url)) return m;
      return { ...m, sources: [...(m.sources ?? []), { url: e.url, title: e.title }] };
    case "found":
      if (m.found?.some((s) => s.url === e.url)) return m;
      return { ...m, found: [...(m.found ?? []), { url: e.url, title: e.title }] };
    case "error":
      return { ...m, error: e.message };
    default:
      return m;
  }
}

/** Domena do karty źródła: `https://www.x.pl/a` → `x.pl`. */
export function domain(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

export type ChatConfig = { providers: ProviderDef[]; errors: string[] };

/** Konfiguracja z surowego `chat.json` i `~/.pi/agent/models.json` (może nie być). */
export function buildChatConfig(chatText: string, piText: string | null): ChatConfig {
  let parsed: ChatConfig;
  try {
    parsed = parseChatConfig(JSON.parse(chatText));
  } catch (e) {
    parsed = { providers: DEFAULT_PROVIDERS, errors: [`chat.json: ${String(e)}`] };
  }
  let pi: ProviderDef[] = [];
  if (piText) {
    try {
      pi = importPiProviders(JSON.parse(piText));
    } catch {
      // zepsuty plik pi to nie nasz błąd: bez importu
    }
  }
  return { providers: mergeProviders(parsed.providers, pi), errors: parsed.errors };
}

/** Przypisy `[1]` → linki markdown do źródeł (tytuł w `title`). Bloki kodu i istniejące
 *  linki (`[1](…)`) bez zmian; numer spoza listy źródeł zostaje tekstem. */
export function linkCitations(text: string, sources: Source[] | undefined): string {
  if (!sources?.length) return text;
  return text
    .split(/(```[\s\S]*?(?:```|$))/)
    .map((part, i) =>
      i % 2 === 1
        ? part
        : part.replace(/\[(\d{1,2})\](?![(:])/g, (whole, n: string) => {
            const s = sources[Number(n) - 1];
            if (!s || !/^https?:\/\//.test(s.url)) return whole;
            const title = s.title.replace(/["\\]/g, "");
            return `[\\[${n}\\]](${s.url.replace(/[()\s]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase().padStart(2, "0")}`)} "${title}")`;
          }),
    )
    .join("");
}

/** Czy dostawca umie „Szukaj w sieci” (CLI natywnie, HTTP przez pi – etap 7b). */
export const supportsSearch = (p: ProviderDef | undefined) => p?.kind === "claude-cli" || p?.kind === "codex-cli";

export const GROUP_LABELS: Record<ProviderGroup, string> = { sub: "Subskrypcje", api: "API", local: "Lokalne" };

/** Powitanie pustego czatu według pory dnia. */
export function greeting(hour: number): string {
  if (hour >= 5 && hour < 12) return "Dzień dobry";
  if (hour >= 12 && hour < 18) return "Miłego popołudnia";
  if (hour >= 18 && hour < 23) return "Dobry wieczór";
  return "Nocna zmiana?";
}

const SOURCES_HEAD = /\n[ \t]*(?:#{1,4}[ \t]*)?\**(?:Źródła|Sources|Zrodla)\**:?\**[ \t]*\n/i;
const SOURCE_LINE = /^[ \t]*(?:[-*][ \t]*)?\[?(\d{1,2})[\].)][ \t]*(.*?)[ \t]*(?:[—–-][ \t]*)?<?(https?:\/\/[^\s>)]+)>?\)?[ \t]*$/;

/** Koniec odpowiedzi: sekcja „Źródła:” z wierszami `[n] Tytuł — URL` (albo `[n] [Tytuł](URL)`)
 *  przechodzi do `sources` i znika z tekstu. Bez takiej sekcji wiadomość bez zmian. */
export function extractSources(m: Message): Message {
  const head = SOURCES_HEAD.exec(m.text);
  if (!head) return m;
  const tail = m.text.slice(head.index + head[0].length);
  const sources: Source[] = [];
  for (const raw of tail.split("\n")) {
    if (raw.trim() === "") continue;
    const line = raw.replace(/\[([^\]]*)\]\((https?:\/\/[^)\s]+)\)/, "$1 — $2"); // [Tytuł](URL)
    const hit = SOURCE_LINE.exec(line);
    if (!hit) return m; // coś innego niż lista źródeł: zostawiamy tekst
    const n = Number(hit[1]);
    const title = hit[2].replace(/[\s—–:-]+$/, "").replace(/^\*+|\*+$/g, "");
    // Sam adres bez tytułu: tytuł strony z wyników wyszukiwania, jeśli tam była.
    sources[n - 1] = { url: hit[3], title: title || (m.found?.find((f) => f.url === hit[3])?.title ?? "") };
  }
  if (sources.length === 0) return m;
  const filled = Array.from(sources, (s) => s ?? { url: "", title: "" });
  return { ...m, text: m.text.slice(0, head.index).trimEnd(), sources: filled };
}
