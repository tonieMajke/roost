import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { ArrowUp, Check, ChevronDown, FolderOpen, Globe, Square, X } from "lucide-react";
import { useT } from "../i18n/useT";
import { GROUP_LABELS, findModel, isCli, modelLabel, supportsSearch, type ModelRef, type ProviderDef, type ProviderGroup } from "../chat";
import { baseName } from "../paths";

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
  /** Przełącznik wyszukiwania (Bot: nie – sieć to narzędzie bota). */
  searchToggle?: boolean;
  placeholder?: string;
  /** Folder do czytania przez agenta; `onFolder` brak = bez przycisku (np. Bot). */
  folder?: string;
  onFolder?(): void;
  onClearFolder?(): void;
};

const GROUPS: ProviderGroup[] = ["sub", "api", "local"];

export function ModelMenu({ providers, offline, model, onModel, onProviders, onClose }: Pick<Props, "providers" | "offline" | "model" | "onModel" | "onProviders"> & { onClose(): void }) {
  const { t } = useT();
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const down = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) onClose();
    };
    const key = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.stopPropagation(); // Esc zamyka samo menu, nie okno pod nim (karta bota)
      onClose();
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
                  {offline[p.id] && <span className="chat-menu-off" title={offline[p.id]}>{t("chat.offline")}</span>}
                </div>
                {p.models.length === 0 && <div className="chat-menu-empty">{offline[p.id] ? t("chat.noModels") : t("chat.findingModels")}</div>}
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
        <span>{t("chat.manageProviders")}</span>
      </button>
    </div>
  );
}

export function Composer({ providers, offline, model, onModel, search, onSearch, busy, onSend, onStop, inject, big, onProviders, searchToggle = true, placeholder, folder, onFolder, onClearFolder }: Props) {
  const { t: tr } = useT();
  const [text, setText] = useState("");
  const [menu, setMenu] = useState(false);
  const area = useRef<HTMLTextAreaElement>(null);
  const provider = model ? providers.find((p) => p.id === model.provider) : undefined;
  const canSearch = supportsSearch(provider);
  const canFolder = provider ? isCli(provider) : false;
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
        placeholder={known ? (placeholder ?? tr("chat.composer.placeholder")) : tr("chat.composer.pickModel")}
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
            <span>{model ? modelLabel(providers, model) : tr("chat.pickModel")}</span>
            <ChevronDown aria-hidden />
          </button>
          {menu && <ModelMenu providers={providers} offline={offline} model={model} onModel={onModel} onProviders={onProviders} onClose={() => setMenu(false)} />}
        </div>
        {searchToggle && (
          <button
            type="button"
            className={`chat-search-btn${search && canSearch ? " is-on" : ""}`}
            aria-pressed={search && canSearch}
            disabled={!canSearch}
            title={canSearch ? tr("chat.webSearch") : tr("chat.webSearch.unsupported")}
            onClick={() => onSearch(!search)}
          >
            <Globe aria-hidden />
            <span>{tr("chat.webSearch")}</span>
          </button>
        )}
        {onFolder && (
          <span className={`chat-folder${folder ? " is-on" : ""}`}>
            <button
              type="button"
              className="chat-search-btn chat-folder-btn"
              disabled={!canFolder}
              title={canFolder ? (folder ? tr("chat.folder.current", { folder }) : tr("chat.folder.grant")) : tr("chat.folder.cliOnly")}
              onClick={onFolder}
            >
              <FolderOpen aria-hidden />
              <span>{folder && canFolder ? baseName(folder) || folder : tr("chat.folder")}</span>
            </button>
            {folder && (
              <button type="button" className="chat-folder-clear" title={tr("chat.folder.clear")} aria-label={tr("chat.folder.clear")} onClick={onClearFolder}>
                <X aria-hidden />
              </button>
            )}
          </span>
        )}
        <span className="chat-composer-gap" />
        {busy ? (
          <button type="button" className="chat-send is-stop" title={tr("chat.stop")} onClick={onStop}>
            <Square aria-hidden />
          </button>
        ) : (
          <button type="button" className="chat-send" title={tr("chat.send")} disabled={text.trim() === "" || !known} onClick={send}>
            <ArrowUp aria-hidden />
          </button>
        )}
      </div>
    </div>
  );
}
