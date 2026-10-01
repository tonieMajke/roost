import { useCallback, useEffect, useRef, useState } from "react";
import { backend } from "../backend";
import { withDiscovered, type ProviderDef } from "../chat";

/** Dostawcy z `chat.json` (+ pi), potem wykrywanie modeli u każdego z `discover` (równolegle).
 *  Wspólne dla Czatu i zakładki Bot. `gen` odrzuca wyniki starszego wczytania (zapis w oknie
 *  „Dostawcy” wczytuje od nowa). */
export function useProviders() {
  const [providers, setProviders] = useState<ProviderDef[]>([]);
  const [offline, setOffline] = useState<Record<string, string>>({});
  const [errors, setErrors] = useState<string[]>([]);
  const gen = useRef(0);
  const discovered = useRef<Record<string, string[]>>({});
  const reload = useCallback(async () => {
    const my = ++gen.current;
    const cfg = await backend.chatConfig().catch((e: unknown) => ({ providers: [] as ProviderDef[], errors: [String(e)] }));
    if (my !== gen.current) return;
    setProviders(cfg.providers);
    setErrors(cfg.errors);
    setOffline({});
    discovered.current = {};
    for (const p of cfg.providers.filter((p) => p.discover)) {
      backend
        .chatModels(p)
        .then((ids) => {
          if (my !== gen.current) return;
          discovered.current[p.id] = ids;
          setProviders((prev) => prev.map((x) => (x.id === p.id ? withDiscovered(x, ids) : x)));
        })
        .catch((e: unknown) => my === gen.current && setOffline((prev) => ({ ...prev, [p.id]: e instanceof Error ? e.message : String(e) })));
    }
  }, []);
  useEffect(() => {
    void reload();
    return () => {
      gen.current++;
    };
  }, [reload]);
  return { providers, offline, errors, setErrors, discovered, reload };
}
