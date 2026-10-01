/** Interface translations. Pure: no DOM needed (tests and the Electron-free preview run in node).
 *  Polish is the source language; every area file in ./messages exports `{ pl, en }`, and the
 *  compiler checks that `en` has exactly the keys of `pl`. */

import app from "./messages/app";
import ui from "./messages/ui";
import panes from "./messages/panes";
import chat from "./messages/chat";
import bot from "./messages/bot";
import voice from "./messages/voice";
import backend from "./messages/backend";
import core from "./messages/core";

export type Lang = "pl" | "en";
/** `auto` follows the system language: Polish for Polish systems, English for everything else. */
export type LangPref = "auto" | Lang;
export const LANGS: readonly Lang[] = ["pl", "en"];
export const LANG_PREFS: readonly LangPref[] = ["auto", "pl", "en"];

const AREAS = [app, ui, panes, chat, bot, voice, backend, core];
const DICT: Record<Lang, Record<string, string>> = {
  pl: Object.assign({}, ...AREAS.map((a) => a.pl)),
  en: Object.assign({}, ...AREAS.map((a) => a.en)),
};

type Merged = typeof app.pl & typeof ui.pl & typeof panes.pl & typeof chat.pl & typeof bot.pl &
  typeof voice.pl & typeof backend.pl & typeof core.pl;
export type Key = keyof Merged;
/** Base of a plural group: `x` for the keys `x.one`, `x.few`, `x.many`, `x.other`. */
export type PluralKey = Key extends infer K ? (K extends `${infer B}.other` ? B : never) : never;
type Params = Record<string, string | number>;

/** `pl` for a Polish locale tag, English for anything else (including no locale at all). */
export function resolveLang(pref: LangPref, systemLocale: string | undefined): Lang {
  if (pref !== "auto") return pref;
  return systemLocale?.toLowerCase().startsWith("pl") ? "pl" : "en";
}

const systemLocale = (): string | undefined => (typeof navigator === "undefined" ? undefined : navigator.language);

let current: Lang = resolveLang("auto", systemLocale());
const listeners = new Set<() => void>();

export const getLang = (): Lang => current;

export function setLang(lang: Lang): void {
  if (lang === current) return;
  current = lang;
  if (typeof document !== "undefined") document.documentElement.lang = lang;
  for (const l of listeners) l();
}

/** Apply the saved preference (`ui.lang`). */
export const applyLangPref = (pref: LangPref): void => setLang(resolveLang(pref, systemLocale()));

function fill(text: string, params?: Params): string {
  if (!params) return text;
  return text.replace(/\{(\w+)\}/g, (m, name: string) => (name in params ? String(params[name]) : m));
}

/** Translate `key` into the current language, filling `{name}` placeholders from `params`. */
export function t(key: Key, params?: Params): string {
  return fill(DICT[current][key] ?? DICT.pl[key] ?? key, params);
}

/** Plural form: looks up `base.one|few|many|other` by the current language's plural rule
 *  (Polish has four forms, English two) and fills `{n}` with the count. */
export function tp(base: PluralKey, n: number, params?: Params): string {
  const rule = new Intl.PluralRules(current).select(n);
  const dict = DICT[current];
  const text = dict[`${base}.${rule}`] ?? dict[`${base}.other`] ?? DICT.pl[`${base}.other`] ?? base;
  return fill(text, { n, ...params });
}

/** Locale tag for `Intl`/`toLocale*String`. */
export const locale = (): string => (current === "pl" ? "pl-PL" : "en-US");

/** Language-change subscription for the React hook in ./useT (kept out of here: the Electron main
 *  process imports this module and does not ship React). */
export const subscribeLang = (cb: () => void) => {
  listeners.add(cb);
  return () => void listeners.delete(cb);
};
