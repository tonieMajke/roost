import { useEffect, useState, type CSSProperties } from "react";
import { backend } from "../backend";
import type { BotDef } from "../bot";

// Obrazki awatarów jako data URL, raz na plik (lista botów rysuje je często).
const cache = new Map<string, Promise<string | null>>();
const key = (id: string, image: string) => `${id}/${image}`;

/** Po imporcie nowego obrazka o tej samej nazwie (`avatar.png`). */
export function forgetAvatar(id: string, image: string) {
  cache.delete(key(id, image));
}

function useImage(bot: BotDef): string | null {
  const image = bot.avatar.image;
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!image) return setUrl(null);
    let on = true;
    const k = key(bot.id, image);
    let p = cache.get(k);
    if (!p) cache.set(k, (p = backend.botAvatar(bot.id, image).catch(() => null)));
    void p.then((u) => on && setUrl(u));
    return () => {
      on = false;
    };
  }, [bot.id, image]);
  return url;
}

/** Awatar bota: obrazek z folderu bota, emoji albo pierwsza litera imienia, na tle w kolorze bota. */
export function Avatar({ bot, size = "sm" }: { bot: BotDef; size?: "sm" | "md" | "lg" }) {
  const url = useImage(bot);
  return (
    <span className={`bot-avatar is-${size}`} style={{ "--bot": bot.color } as CSSProperties} aria-hidden>
      {url ? <img src={url} alt="" /> : (bot.avatar.emoji ?? (bot.name.slice(0, 1).toUpperCase() || "?"))}
    </span>
  );
}
