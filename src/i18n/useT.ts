import { useSyncExternalStore } from "react";
import { getLang, subscribeLang, t, tp, type Lang } from "./index";

/** Components call this so they re-render when the language changes; use the returned `t`/`tp`. */
export function useT(): { t: typeof t; tp: typeof tp; lang: Lang } {
  const lang = useSyncExternalStore(subscribeLang, getLang, getLang);
  return { t, tp, lang };
}
