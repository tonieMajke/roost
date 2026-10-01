// Okno „Dyktowanie”: który silnik zamienia głos na tekst (OpenRouter, cortecs.ai, OpenAI albo
// serwer lokalny), jego adres, model i klucz. Wygląd jak okno „Dostawcy” czatu (klasy `prov-*`).

import { useEffect, useState } from "react";
import { Check, Mic, Plus, Trash2 } from "lucide-react";
import { backend, type KeyState } from "./backend";
import { Dialog } from "./Dialog";
import { t as tr } from "./i18n";
import { useT } from "./i18n/useT";
import { STT_PRESETS, sttFreeId, type SttConfig, type SttProvider } from "./stt";
import { TalkSettings, type VoiceTab } from "./voice/TalkSettings";

type Props = {
  config: SttConfig;
  /** Zapis do `stt.json` i nowa konfiguracja dla reszty aplikacji. */
  onSave(config: SttConfig): Promise<void>;
  onClose(): void;
  /** Zakładka na start: dyktowanie (mikrofon w panelu) albo rozmowa (kuleczka). */
  tab?: VoiceTab;
};

const LANGUAGES = ["auto", "pl", "en", "de", "es", "fr", "ja"] as const;

function Row({
  p,
  active,
  keyState,
  onActivate,
  onEdit,
  onRemove,
  onKey,
}: {
  p: SttProvider;
  active: boolean;
  keyState: KeyState | undefined;
  onActivate(): void;
  onEdit(patch: Partial<SttProvider>): void;
  onRemove(): void;
  onKey(key: string | null): Promise<void>;
}) {
  const { t } = useT();
  const [url, setUrl] = useState(p.baseUrl);
  const [model, setModel] = useState(p.model);
  const [keyOpen, setKeyOpen] = useState(false);
  const [key, setKey] = useState("");
  const [keyErr, setKeyErr] = useState<string | null>(null);
  const missingKey = p.key && keyState == null;

  return (
    <div className="prov-row">
      <div className="prov-main">
        <Mic className="prov-icon" aria-hidden />
        <div className="prov-text">
          <div className="prov-name">
            {p.name}
            {active && <span className="prov-tag">{t("voice.dlg.inUse")}</span>}
          </div>
          <div className="prov-state">
            {!p.key ? (
              <span>{t("voice.dlg.noKeyLocal")}</span>
            ) : keyState === "stored" ? (
              <span className="is-ok">{t("voice.dlg.keyStored")}</span>
            ) : keyState === "env" ? (
              <span className="is-ok">{t("voice.dlg.keyEnv", { env: p.keyEnv ?? "" })}</span>
            ) : (
              <span className="is-warn">{t("voice.dlg.keyMissing")}</span>
            )}
          </div>
        </div>
        <div className="prov-btns">
          <button type="button" className={`btn${active ? " is-on" : ""}`} onClick={onActivate} disabled={active || missingKey} title={missingKey ? t("voice.dlg.needKey") : undefined}>
            <Check aria-hidden /> {active ? t("voice.dlg.selected") : t("voice.dlg.use")}
          </button>
          {p.key && (
            <button type="button" className={`btn${keyOpen ? " is-on" : ""}`} onClick={() => setKeyOpen((v) => !v)}>
              {t("voice.dlg.key")}
            </button>
          )}
          <button type="button" className="icon" title={t("voice.dlg.removeEngine")} aria-label={t("voice.dlg.removeEngineNamed", { name: p.name })} onClick={onRemove}>
            <Trash2 size={15} strokeWidth={1.75} aria-hidden />
          </button>
        </div>
      </div>
      <label className="prov-field">
        <span>{t("voice.dlg.address")}</span>
        <input value={url} spellCheck={false} onChange={(e) => setUrl(e.target.value)} onBlur={() => url.trim() !== p.baseUrl && /^https?:\/\//i.test(url.trim()) && onEdit({ baseUrl: url.trim().replace(/\/+$/, "") })} />
      </label>
      <label className="prov-field">
        <span>{t("voice.dlg.model")}</span>
        <input value={model} spellCheck={false} onChange={(e) => setModel(e.target.value)} onBlur={() => model.trim() && model.trim() !== p.model && onEdit({ model: model.trim() })} />
      </label>
      {keyOpen && (
        <form
          className="prov-field"
          onSubmit={(e) => {
            e.preventDefault();
            setKeyErr(null);
            void onKey(key)
              .then(() => {
                setKey("");
                setKeyOpen(false);
              })
              .catch((err: unknown) => setKeyErr(err instanceof Error ? err.message : String(err)));
          }}
        >
          <span>{t("voice.dlg.apiKey")}</span>
          <input type="password" value={key} autoFocus autoComplete="off" placeholder={keyState === "stored" ? t("voice.dlg.keyPlaceholderStored") : t("voice.dlg.keyPlaceholder")} onChange={(e) => setKey(e.target.value)} />
          <button type="submit" className="btn primary" disabled={key.trim() === ""}>
            {t("voice.dlg.save")}
          </button>
          {keyState === "stored" && (
            <button type="button" className="btn" onClick={() => void onKey(null).then(() => setKeyOpen(false))}>
              {t("voice.dlg.remove")}
            </button>
          )}
          {keyErr && <em className="is-warn">{keyErr}</em>}
        </form>
      )}
    </div>
  );
}

type Mic = { id: string; label: string };

/** Mikrofony systemu. Etykiet przeglądarka nie podaje, dopóki strona nie dostała zgody na mikrofon,
 *  więc przy pustych etykietach otwieramy na chwilę strumień (zgoda jest i tak potrzebna do dyktowania). */
async function listMics(): Promise<Mic[]> {
  const inputs = async () => (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === "audioinput");
  let devices = await inputs();
  if (devices.length > 0 && devices.every((d) => d.label === "")) {
    const s = await navigator.mediaDevices.getUserMedia({ audio: true });
    s.getTracks().forEach((t) => t.stop());
    devices = await inputs();
  }
  // „default” i „communications” dublują konkretne urządzenia; domyślny mikrofon ma własną pozycję na liście.
  return devices.filter((d) => d.deviceId !== "default" && d.deviceId !== "communications").map((d, i) => ({ id: d.deviceId, label: d.label || tr("voice.dict.micN", { n: i + 1 }) }));
}

export function VoiceDialog({ config, onSave, onClose, tab: initialTab = "dictation" }: Props) {
  const { t } = useT();
  const [tab, setTab] = useState<VoiceTab>(initialTab);
  const [keys, setKeys] = useState<Record<string, KeyState>>({});
  const [error, setError] = useState<string | null>(null);
  const [mics, setMics] = useState<Mic[]>([]);
  const [micErr, setMicErr] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    listMics()
      .then((m) => live && setMics(m))
      .catch(() => live && setMicErr(t("voice.dict.micErr")));
    return () => {
      live = false;
    };
  }, []);

  const refreshKeys = () =>
    void backend
      .sttKeyStatus(config.providers)
      .then(setKeys)
      .catch(() => undefined);
  useEffect(refreshKeys, [config.providers]);

  const save = (next: SttConfig) => {
    setError(null);
    void onSave(next).catch((e: unknown) => setError(String(e)));
  };
  const add = (preset: SttProvider) => {
    const taken = config.providers.map((p) => p.id);
    const id = sttFreeId(preset.id, taken);
    const added = { ...preset, id, name: id === preset.id ? preset.name : `${preset.name} ${id.split("-").pop()}` };
    // Pierwszy silnik bez klucza (lokalny) od razu działa; z kluczem czeka na jego wpisanie.
    save({ ...config, active: config.active ?? (added.key ? null : id), providers: [...config.providers, added] });
  };

  return (
    <Dialog label={t("voice.dlg.title")} className="prov-dialog" onClose={onClose}>
      {() => (
        <>
          <h2>{t("voice.dlg.title")}</h2>
          <div className="seg voice-tabs" role="tablist" aria-label={t("voice.dlg.tabs")}>
            <button type="button" role="tab" aria-selected={tab === "dictation"} className={tab === "dictation" ? "is-on" : undefined} onClick={() => setTab("dictation")}>
              {t("voice.dlg.tabDictation")}
            </button>
            <button type="button" role="tab" aria-selected={tab === "talk"} className={tab === "talk" ? "is-on" : undefined} onClick={() => setTab("talk")}>
              {t("voice.dlg.tabTalk")}
            </button>
          </div>
          {tab === "talk" ? (
            <TalkSettings />
          ) : (
            <>
              <p>
                {t("voice.dict.intro.pre")}<code>/audio/transcriptions</code>{t("voice.dict.intro.post")}
              </p>
              {error && <div className="prov-error">{error}</div>}
              <div className="prov-list">
                {config.providers.map((p) => (
                  <Row
                    key={p.id}
                    p={p}
                    active={config.active === p.id}
                    keyState={keys[p.id]}
                    onActivate={() => save({ ...config, active: p.id })}
                    onEdit={(patch) => save({ ...config, providers: config.providers.map((x) => (x.id === p.id ? { ...x, ...patch } : x)) })}
                    onRemove={() => save({ ...config, active: config.active === p.id ? null : config.active, providers: config.providers.filter((x) => x.id !== p.id) })}
                    onKey={async (k) => {
                      await backend.sttSetKey(p.id, k);
                      refreshKeys();
                      if (k && config.active === null) save({ ...config, active: p.id });
                    }}
                  />
                ))}
              </div>
              <div className="rail-label">{t("voice.dict.addEngine")}</div>
              <div className="prov-add">
                {STT_PRESETS.map((preset) => (
                  <button key={preset.id} type="button" className="btn" onClick={() => add(preset)}>
                    <Plus aria-hidden /> {preset.name}
                  </button>
                ))}
              </div>
              <label className="prov-field" style={{ marginLeft: 0, marginTop: 16 }}>
                <span>{t("voice.dict.mic")}</span>
                <select value={config.mic} onChange={(e) => save({ ...config, mic: e.target.value })}>
                  <option value="">{t("voice.dict.micDefault")}</option>
                  {mics.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.label}
                    </option>
                  ))}
                  {config.mic !== "" && !mics.some((m) => m.id === config.mic) && <option value={config.mic}>{t("voice.dict.micSaved")}</option>}
                </select>
                {micErr && <em className="is-warn">{micErr}</em>}
              </label>
              <p className="prov-state">{t("voice.dict.micNote")}</p>
              <label className="prov-field" style={{ marginLeft: 0, marginTop: 8 }}>
                <span>{t("voice.dict.language")}</span>
                <select value={config.language} onChange={(e) => save({ ...config, language: e.target.value })}>
                  {LANGUAGES.map((code) => (
                    <option key={code} value={code}>
                      {t(`voice.lang.${code}`)}
                    </option>
                  ))}
                </select>
              </label>
            </>
          )}
        </>
      )}
    </Dialog>
  );
}
