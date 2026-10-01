// Okno „Dyktowanie”: który silnik zamienia głos na tekst (OpenRouter, cortecs.ai, OpenAI albo
// serwer lokalny), jego adres, model i klucz. Wygląd jak okno „Dostawcy” czatu (klasy `prov-*`).

import { useEffect, useState } from "react";
import { Check, Mic, Plus, Trash2 } from "lucide-react";
import { backend, type KeyState } from "./backend";
import { Dialog } from "./Dialog";
import { STT_PRESETS, sttFreeId, type SttConfig, type SttProvider } from "./stt";

type Props = {
  config: SttConfig;
  /** Zapis do `stt.json` i nowa konfiguracja dla reszty aplikacji. */
  onSave(config: SttConfig): Promise<void>;
  onClose(): void;
};

const LANGUAGES: [string, string][] = [
  ["auto", "Wykryj automatycznie"],
  ["pl", "Polski"],
  ["en", "Angielski"],
  ["de", "Niemiecki"],
  ["es", "Hiszpański"],
  ["fr", "Francuski"],
  ["ja", "Japoński"],
];

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
            {active && <span className="prov-tag">używany</span>}
          </div>
          <div className="prov-state">
            {!p.key ? (
              <span>bez klucza (serwer lokalny)</span>
            ) : keyState === "stored" ? (
              <span className="is-ok">klucz w sejfie</span>
            ) : keyState === "env" ? (
              <span className="is-ok">klucz z ${p.keyEnv}</span>
            ) : (
              <span className="is-warn">brak klucza</span>
            )}
          </div>
        </div>
        <div className="prov-btns">
          <button type="button" className={`btn${active ? " is-on" : ""}`} onClick={onActivate} disabled={active || missingKey} title={missingKey ? "Najpierw wpisz klucz" : undefined}>
            <Check aria-hidden /> {active ? "Wybrany" : "Użyj"}
          </button>
          {p.key && (
            <button type="button" className={`btn${keyOpen ? " is-on" : ""}`} onClick={() => setKeyOpen((v) => !v)}>
              Klucz
            </button>
          )}
          <button type="button" className="icon" title="Usuń silnik" aria-label={`Usuń silnik ${p.name}`} onClick={onRemove}>
            <Trash2 size={15} strokeWidth={1.75} aria-hidden />
          </button>
        </div>
      </div>
      <label className="prov-field">
        <span>Adres</span>
        <input value={url} spellCheck={false} onChange={(e) => setUrl(e.target.value)} onBlur={() => url.trim() !== p.baseUrl && /^https?:\/\//i.test(url.trim()) && onEdit({ baseUrl: url.trim().replace(/\/+$/, "") })} />
      </label>
      <label className="prov-field">
        <span>Model</span>
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
          <span>Klucz API</span>
          <input type="password" value={key} autoFocus autoComplete="off" placeholder={keyState === "stored" ? "zapisany – wpisz nowy, by zmienić" : "klucz API"} onChange={(e) => setKey(e.target.value)} />
          <button type="submit" className="btn primary" disabled={key.trim() === ""}>
            Zapisz
          </button>
          {keyState === "stored" && (
            <button type="button" className="btn" onClick={() => void onKey(null).then(() => setKeyOpen(false))}>
              Usuń
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
  return devices.filter((d) => d.deviceId !== "default" && d.deviceId !== "communications").map((d, i) => ({ id: d.deviceId, label: d.label || `Mikrofon ${i + 1}` }));
}

export function VoiceDialog({ config, onSave, onClose }: Props) {
  const [keys, setKeys] = useState<Record<string, KeyState>>({});
  const [error, setError] = useState<string | null>(null);
  const [mics, setMics] = useState<Mic[]>([]);
  const [micErr, setMicErr] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    listMics()
      .then((m) => live && setMics(m))
      .catch(() => live && setMicErr("nie udało się odczytać listy mikrofonów (brak zgody?)"));
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
  const add = (t: SttProvider) => {
    const taken = config.providers.map((p) => p.id);
    const id = sttFreeId(t.id, taken);
    const added = { ...t, id, name: id === t.id ? t.name : `${t.name} ${id.split("-").pop()}` };
    // Pierwszy silnik bez klucza (lokalny) od razu działa; z kluczem czeka na jego wpisanie.
    save({ ...config, active: config.active ?? (added.key ? null : id), providers: [...config.providers, added] });
  };

  return (
    <Dialog label="Dyktowanie" className="prov-dialog" onClose={onClose}>
      {() => (
        <>
          <h2>Dyktowanie głosem</h2>
          <p>
            Mikrofon w nagłówku panelu nagrywa głos, wysyła go do wybranego silnika, a gotowy tekst wkleja do terminala bez Entera. Silnik to dowolny serwer z <code>/audio/transcriptions</code>: chmura albo własny, lokalny. Klucze trafiają do sejfu systemowego.
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
          <div className="rail-label">Dodaj silnik</div>
          <div className="prov-add">
            {STT_PRESETS.map((t) => (
              <button key={t.id} type="button" className="btn" onClick={() => add(t)}>
                <Plus aria-hidden /> {t.name}
              </button>
            ))}
          </div>
          <label className="prov-field" style={{ marginLeft: 0, marginTop: 16 }}>
            <span>Mikrofon</span>
            <select value={config.mic} onChange={(e) => save({ ...config, mic: e.target.value })}>
              <option value="">Domyślny mikrofon systemu</option>
              {mics.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.label}
                </option>
              ))}
              {config.mic !== "" && !mics.some((m) => m.id === config.mic) && <option value={config.mic}>Zapisany mikrofon (niepodłączony)</option>}
            </select>
            {micErr && <em className="is-warn">{micErr}</em>}
          </label>
          <label className="prov-field" style={{ marginLeft: 0, marginTop: 8 }}>
            <span>Język</span>
            <select value={config.language} onChange={(e) => save({ ...config, language: e.target.value })}>
              {LANGUAGES.map(([code, name]) => (
                <option key={code} value={code}>
                  {name}
                </option>
              ))}
            </select>
          </label>
        </>
      )}
    </Dialog>
  );
}
