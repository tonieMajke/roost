import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { ArrowUp, Check, ChevronDown, Globe, Square } from "lucide-react";
import { GROUP_LABELS, findModel, modelLabel, supportsSearch, type ModelRef, type ProviderDef, type ProviderGroup } from "../chat";

type Props = {
  providers: ProviderDef[];
  /** Dostawcy, którzy nie odpowiedzieli przy wykrywaniu modeli (id → powód). */
  offline: Record<string, string>;
  model: ModelRef | null;
  onModel(m: ModelRef): void;
  search: boolean;
  onSearch(on: boolean): void;
  busy: boolean;
  onSend(text: string): void;
  onStop(): void;
  /** Tekst wstawiony z zewnątrz (Edytuj); zmiana `seq` = nowe wstawienie. */
  inject: { text: string; seq: number } | null;
  big?: boolean; // pusty czat: większe pole na środku
  onProviders(): void;
};

const GROUPS: ProviderGroup[] = ["sub", "api", "local"];

function ModelMenu({ providers, offline, model, onModel, onProviders, onClose }: Pick<Props, "providers" | "offline" | "model" | "onModel" | "onProviders"> & { onClose(): void }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const down = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) onClose();
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("pointerdown", down, true);
    window.addEventListener("keydown", key, true);
    return () => {
      window.removeEventListener("pointerdown", down, true);
      window.removeEventListener("keydown", key, true);
    };
  }, [onClose]);

  // Strona i wysokość według miejsca w obszarze czatu (bez paska tytułu okna): tam, gdzie
  // go więcej, przycięte do krawędzi.
  const [place, setPlace] = useState<{ up: boolean; max: number } | null>(null);
  useLayoutEffect(() => {
    const fit = () => {
      const anchor = ref.current?.parentElement?.getBoundingClientRect();
      const area = ref.current?.closest(".chat-main")?.getBoundingClientRect() ?? { top: 0, bottom: window.innerHeight };
      if (!anchor) return;
      const margin = 12 + 8; // od krawędzi obszaru + odstęp od przycisku
      const below = area.bottom - anchor.bottom - margin;
      const above = anchor.top - area.top - margin;
      const up = above > below;
      setPlace({ up, max: Math.max(120, Math.min(520, up ? above : below)) });
    };
    fit();
    window.addEventListener("resize", fit);
    return () => window.removeEventListener("resize", fit);
  }, []);

  return (
    <div
      className={`chat-menu${place?.up === false ? " is-down" : ""}`}
      ref={ref}
      role="menu"
      style={place ? { maxHeight: place.max } : { visibility: "hidden" }}
    >
      {GROUPS.map((g) => {
        const list = providers.filter((p) => p.group === g);
        if (list.length === 0) return null;
        return (
          <div key={g} className="chat-menu-group">
            <div className="chat-menu-label">{GROUP_LABELS[g]}</div>
            {list.map((p) => (
              <div key={p.id} className="chat-menu-provider">
                <div className="chat-menu-pname">
                  {p.name}
                  {offline[p.id] && <span className="chat-menu-off" title={offline[p.id]}>nie odpowiada</span>}
                </div>
                {p.models.length === 0 && <div className="chat-menu-empty">{offline[p.id] ? "brak modeli" : "szukam modeli…"}</div>}
                {p.models.map((m) => {
                  const on = model?.provider === p.id && model.model === m.id;
                  return (
                    <button
                      key={m.id}
                      type="button"
                      role="menuitemradio"
                      aria-checked={on}
                      className={`chat-menu-item${on ? " is-on" : ""}`}
                      onClick={() => {
                        onModel({ provider: p.id, model: m.id });
                        onClose();
                      }}
                    >
                      <span>{m.name}</span>
                      {on && <Check aria-hidden />}
                    </button>
                  );
                })}
              </div>
            ))}
          </div>
        );
      })}
      <button
        type="button"
        className="chat-menu-item chat-menu-manage"
        onClick={() => {
          onClose();
          onProviders();
        }}
      >
        <span>Dostawcy i klucze API…</span>
      </button>
    </div>
  );
}

export function Composer({ providers, offline, model, onModel, search, onSearch, busy, onSend, onStop, inject, big, onProviders }: Props) {
  const [text, setText] = useState("");
  const [menu, setMenu] = useState(false);
  const area = useRef<HTMLTextAreaElement>(null);
  const provider = model ? providers.find((p) => p.id === model.provider) : undefined;
  const canSearch = supportsSearch(provider);
  const known = model ? findModel(providers, model) !== null : false;

  useEffect(() => {
    if (!inject) return;
    setText(inject.text);
    area.current?.focus();
  }, [inject]);

  useEffect(() => {
    area.current?.focus();
  }, [model]);

  // Pole rośnie z tekstem do limitu z CSS (max-height), dalej przewija się samo.
  useLayoutEffect(() => {
    const el = area.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [text]);

  const send = () => {
    const t = text.trim();
    if (t === "" || busy || !known) return;
    onSend(t);
    setText("");
  };

  return (
    <div className={`chat-composer${big ? " is-big" : ""}`}>
      <textarea
        ref={area}
        rows={1}
        value={text}
        placeholder={known ? "Napisz wiadomość…" : "Wybierz model poniżej"}
        spellCheck
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
            e.preventDefault();
            send();
          }
        }}
      />
      <div className="chat-composer-row">
        <div className="chat-model-wrap">
          <button type="button" className="chat-model-btn" onClick={() => setMenu((v) => !v)} aria-haspopup="menu" aria-expanded={menu}>
            <span>{model ? modelLabel(providers, model) : "Wybierz model"}</span>
            <ChevronDown aria-hidden />
          </button>
          {menu && <ModelMenu providers={providers} offline={offline} model={model} onModel={onModel} onProviders={onProviders} onClose={() => setMenu(false)} />}
        </div>
        <button
          type="button"
          className={`chat-search-btn${search && canSearch ? " is-on" : ""}`}
          aria-pressed={search && canSearch}
          disabled={!canSearch}
          title={canSearch ? "Szukaj w sieci" : "Ten model jeszcze nie umie szukać w sieci"}
          onClick={() => onSearch(!search)}
        >
          <Globe aria-hidden />
          <span>Szukaj w sieci</span>
        </button>
        <span className="chat-composer-gap" />
        {busy ? (
          <button type="button" className="chat-send is-stop" title="Zatrzymaj" onClick={onStop}>
            <Square aria-hidden />
          </button>
        ) : (
          <button type="button" className="chat-send" title="Wyślij (Enter)" disabled={text.trim() === "" || !known} onClick={send}>
            <ArrowUp aria-hidden />
          </button>
        )}
      </div>
    </div>
  );
}
