//! Sieć dla narzędzi bota: `web_search` (DuckDuckGo HTML, bez klucza) i `web_fetch`
//! (strona jako tekst). Dostawcy CLI mają własne WebSearch/WebFetch; to jest dla reszty.

import { lookup as dnsLookup } from "node:dns/promises";
import http from "node:http";
import https from "node:https";
import { isIP, type LookupFunction } from "node:net";
import { Readable } from "node:stream";
import { isPrivateHost } from "../../../src/bot";
import { t } from "../i18n";
const UA = "Mozilla/5.0 (X11; Linux x86_64; rv:140.0) Gecko/20100101 Firefox/140.0";
const FETCH_TIMEOUT = 20_000;
const MAX_DOWNLOAD = 2_000_000;
export const FETCH_LIMIT = 30_000;

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", "#39": "'", "#x27": "'" };

export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+\d*);/gi, (whole, e: string) => {
    const k = e.toLowerCase();
    if (k in ENTITIES) return ENTITIES[k];
    if (k.startsWith("#x")) return safeChar(parseInt(k.slice(2), 16), whole);
    if (k.startsWith("#")) return safeChar(parseInt(k.slice(1), 10), whole);
    return whole;
  });
}

const safeChar = (n: number, fallback: string) => (Number.isFinite(n) && n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : fallback);

/** HTML → czytelny tekst: bez skryptów, stylów i nawigacji; bloki jako nowe linie, linki jako „tekst (url)”. */
export function htmlToText(html: string): { title: string; text: string } {
  const title = decodeEntities(/<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1] ?? "").replace(/\s+/g, " ").trim();
  let body = /<body[^>]*>([\s\S]*)<\/body>/i.exec(html)?.[1] ?? html;
  body = body
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<(script|style|noscript|svg|nav|footer|header|form|iframe|template)\b[\s\S]*?<\/\1>/gi, "")
    .replace(/<a\b[^>]*href="(https?:[^"]+)"[^>]*>([\s\S]*?)<\/a>/gi, (_m, href: string, inner: string) => {
      const t = inner.replace(/<[^>]+>/g, "").trim();
      return t ? `${t} (${decodeEntities(href)})` : "";
    })
    .replace(/<(h[1-6])\b[^>]*>/gi, (_m, h: string) => `\n\n${"#".repeat(Number(h[1]))} `)
    .replace(/<li\b[^>]*>/gi, "\n- ")
    .replace(/<(br|hr)\b[^>]*>/gi, "\n")
    .replace(/<\/?(p|div|section|article|main|ul|ol|table|tr|pre|blockquote|h[1-6])\b[^>]*>/gi, "\n\n")
    .replace(/<\/?(td|th)\b[^>]*>/gi, " | ")
    .replace(/<[^>]+>/g, "");
  const text = decodeEntities(body)
    .split("\n")
    .map((l) =>
      l
        .replace(/[ \t\u00a0]+/g, " ")
        .replace(/^[\s|]+|[\s|]+$/g, "") // komórki tabel: bez pustych ramek na brzegach
        .replace(/(\s*\|\s*){2,}/g, " | "),
    )
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return { title, text };
}

export type SearchResult = { title: string; url: string; snippet: string };

/** Wyniki z `html.duckduckgo.com/html/`; adresy z przekierowania `//duckduckgo.com/l/?uddg=…`. */
export function parseDdg(html: string): SearchResult[] {
  const out: SearchResult[] = [];
  const re = /<a[^>]*class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>([\s\S]*?)(?=<a[^>]*class="result__a"|$)/g;
  for (const m of html.matchAll(re)) {
    let url = decodeEntities(m[1]);
    const uddg = /[?&]uddg=([^&]+)/.exec(url);
    if (uddg) url = decodeURIComponent(uddg[1]);
    if (url.startsWith("//")) url = `https:${url}`;
    if (!/^https?:\/\//.test(url) || /duckduckgo\.com\/y\.js/.test(url)) continue; // reklamy
    const snippet = /class="result__snippet"[^>]*>([\s\S]*?)<\/a>/.exec(m[3])?.[1] ?? "";
    const clean = (s: string) => decodeEntities(s.replace(/<[^>]+>/g, "")).replace(/\s+/g, " ").trim();
    if (out.some((r) => r.url === url)) continue;
    out.push({ title: clean(m[2]), url, snippet: clean(snippet) });
  }
  return out;
}

export function formatResults(query: string, results: SearchResult[]): string {
  if (results.length === 0) return `Brak wyników dla „${query}”.`;
  return results.map((r, i) => `[${i + 1}] ${r.title}\n${r.url}\n${r.snippet}`).join("\n\n");
}

async function get(url: string, signal: AbortSignal, redirect: "follow" | "manual" = "follow"): Promise<Response> {
  const timeout = AbortSignal.timeout(FETCH_TIMEOUT);
  try {
    return await fetch(url, { headers: { "User-Agent": UA, Accept: "text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.5" }, signal: AbortSignal.any([signal, timeout]), redirect });
  } catch (e) {
    if (timeout.aborted && !signal.aborted) throw new Error(`${new URL(url).host} nie odpowiada (20 s)`);
    throw e;
  }
}

/** Ciało odpowiedzi do `max` bajtów (reszta odrzucona). */
async function readCapped(res: Response, max: number): Promise<{ text: string; capped: boolean }> {
  const reader = res.body?.getReader();
  if (!reader) return { text: "", capped: false };
  const parts: Uint8Array[] = [];
  let size = 0;
  let capped = false;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    parts.push(value);
    size += value.length;
    if (size >= max) {
      capped = true;
      await reader.cancel();
      break;
    }
  }
  return { text: new TextDecoder().decode(Buffer.concat(parts).subarray(0, max)), capped };
}

export async function webSearch(query: string, signal: AbortSignal, limit = 8): Promise<string> {
  const q = query.trim();
  if (!q) throw new Error("puste zapytanie");
  const res = await get(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(q)}`, signal);
  const { text } = await readCapped(res, MAX_DOWNLOAD);
  if (!res.ok) throw new Error(`wyszukiwarka: HTTP ${res.status}`);
  const results = parseDdg(text);
  if (results.length === 0 && /error-lite|anomaly/i.test(text)) throw new Error(t("web.rejected"));
  return formatResults(q, results.slice(0, limit));
}

export type FetchOpts = {
  /** `host:port`, na który użytkownik zgodził się mimo adresu lokalnego/prywatnego; tylko ten host, także po przekierowaniu. */
  allowPrivate?: string;
  /** Czy po przekierowaniu można wejść na ten host (nazwa, małe litery); brak = bez ograniczeń. */
  allowHost?: (hostname: string) => boolean;
  /** Do testów: rozwiązywanie nazw. */
  resolve?: (host: string) => Promise<string[]>;
  /** Do testów: wykonanie żądania (domyślnie `pinnedGet`: połączenie tylko z adresem sprawdzonym w `lookup`). */
  transport?: (url: URL, signal: AbortSignal, lookup: LookupFunction) => Promise<Response>;
};

export const MAX_REDIRECTS = 5;

const resolveAll = async (host: string) => (await dnsLookup(host, { all: true })).map((a) => a.address);

/** `lookup` dla `http(s).request`: jedno rozwiązanie nazwy, odrzucenie adresów prywatnych (poza hostem zatwierdzonym
 *  przez użytkownika) i połączenie dokładnie z tym adresem, więc DNS-rebinding między sprawdzeniem a połączeniem nie przejdzie. */
export function pinnedLookup(u: URL, opts: FetchOpts): LookupFunction {
  const approved = opts.allowPrivate !== undefined && u.host === opts.allowPrivate;
  return (hostname, options, cb) => {
    const done = (err: Error | null, addrs: string[]) => {
      const list = addrs.map((address) => ({ address, family: isIP(address) === 6 ? 6 : 4 }));
      if (err || list.length === 0) return cb(err ?? new Error(`nie znaleziono adresu: ${hostname}`), "", 4);
      if (!approved && list.some((a) => isPrivateHost(a.address))) return cb(new Error(t("web.privateResolved", { host: u.host })), "", 4);
      if (typeof options === "object" && options.all) return (cb as unknown as (e: null, a: typeof list) => void)(null, list);
      cb(null, list[0].address, list[0].family);
    };
    (opts.resolve ?? resolveAll)(hostname).then((a) => done(null, a), (e: unknown) => done(e instanceof Error ? e : new Error(String(e)), []));
  };
}

/** GET przez `node:http(s)` z przypiętym adresem (bez przekierowań; limit 20 s jak w `get`). */
function pinnedGet(url: URL, signal: AbortSignal, lookup: LookupFunction): Promise<Response> {
  const timeout = AbortSignal.timeout(FETCH_TIMEOUT);
  return new Promise((resolve, reject) => {
    const req = (url.protocol === "https:" ? https : http).request(
      url,
      { method: "GET", lookup, signal: AbortSignal.any([signal, timeout]), headers: { "User-Agent": UA, Accept: "text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.5" } },
      (res) => {
        const headers = new Headers();
        for (const [k, v] of Object.entries(res.headers)) if (v !== undefined) headers.set(k, Array.isArray(v) ? v.join(", ") : v);
        const status = res.statusCode ?? 0;
        const empty = status === 204 || status === 205 || status === 304;
        if (empty) res.resume();
        resolve(new Response(empty ? null : (Readable.toWeb(res) as ReadableStream<Uint8Array>), { status, headers }));
      },
    );
    req.on("error", (e) => reject(timeout.aborted && !signal.aborted ? new Error(`${url.host} nie odpowiada (20 s)`) : e));
    req.end();
  });
}

/** Odrzuca adres lokalny/prywatny (tekstowo i po rozwiązaniu DNS), chyba że to host zatwierdzony przez użytkownika. */
async function guardHost(u: URL, opts: FetchOpts, hop: boolean): Promise<void> {
  if (opts.allowPrivate !== undefined && u.host === opts.allowPrivate) return;
  if (isPrivateHost(u.hostname)) throw new Error(hop ? t("web.privateRedirect", { host: u.host }) : t("web.privateResolved", { host: u.host }));
  const bare = u.hostname.replace(/^\[|\]$/g, "");
  if (isIP(bare)) return; // literał IP już sprawdzony wyżej
  let addrs: string[];
  try {
    addrs = await (opts.resolve ?? resolveAll)(bare);
  } catch {
    return; // brak DNS: fetch sam zgłosi błąd
  }
  if (addrs.some((a) => isPrivateHost(a))) throw new Error(t("web.privateResolved", { host: u.host }));
}

/** Strona jako tekst (≤ 30 KB). Tylko http(s). Adresy lokalne/prywatne (bot czyta np. własny serwer deweloperski)
 *  tylko za zgodą (`opts.allowPrivate`, ustalane przez wywołującego); przekierowania ręcznie, max 5 skoków,
 *  każdy host sprawdzany od nowa (tekst + DNS), a samo połączenie idzie na adres sprawdzony w `pinnedLookup`
 *  (bez drugiego rozwiązania nazwy), więc DNS-rebinding nie działa. */
export async function webFetch(url: string, signal: AbortSignal, opts: FetchOpts = {}): Promise<string> {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    throw new Error(t("web.badUrl", { url }));
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") throw new Error("tylko adresy http(s)");
  const first = u.href;
  let res: Response;
  for (let hop = 0; ; hop++) {
    if (hop > 0 && opts.allowHost && !opts.allowHost(u.hostname.toLowerCase())) throw new Error(t("web.hostRedirect", { host: u.hostname, url: u.href }));
    await guardHost(u, opts, hop > 0);
    res = await (opts.transport ?? pinnedGet)(u, signal, pinnedLookup(u, opts));
    const loc = res.headers.get("location");
    if (res.status < 300 || res.status >= 400 || !loc) break;
    await res.body?.cancel();
    if (hop >= MAX_REDIRECTS) throw new Error(t("web.tooManyRedirects"));
    try {
      u = new URL(loc, u);
    } catch {
      throw new Error(t("web.badUrl", { url: loc }));
    }
    if (u.protocol !== "http:" && u.protocol !== "https:") throw new Error("tylko adresy http(s)");
  }
  const type = res.headers.get("content-type") ?? "";
  if (!res.ok) throw new Error(`HTTP ${res.status} dla ${u.href}`);
  if (type && !/text\/|json|xml|javascript/.test(type)) throw new Error(`nie tekst (${type.split(";")[0]})`);
  const { text: raw, capped } = await readCapped(res, MAX_DOWNLOAD);
  const isHtml = /html/.test(type) || /^\s*<(!doctype|html)/i.test(raw);
  const { title, text } = isHtml ? htmlToText(raw) : { title: "", text: raw };
  let out = `${title ? `# ${title}\n` : ""}${u.href !== first ? `(po przekierowaniu: ${u.href})\n` : ""}\n${text}`;
  if (out.length > FETCH_LIMIT) out = `${out.slice(0, FETCH_LIMIT)}\n… [ucięte, strona ma ${out.length} znaków]`;
  else if (capped) out += "\n… [strona większa niż 2 MB, reszta pominięta]";
  return out;
}
