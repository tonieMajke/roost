// Zakładka „Rozmowa” okna głosu: mózg (model z Czatu), silnik mowy (API `/audio/speech` albo Piper),
// głos, słuchawki i próba głosu. Zapis od razu przy każdej zmianie, jak w zakładce „Dyktowanie”.

import { useEffect, useRef, useState } from "react";
import { Check, Plus, Trash2, Volume2 } from "lucide-react";
import { backend, type KeyState } from "../backend";
import { isCli, modelKey, withDiscovered, type ProviderDef } from "../chat";
import { sttFreeId } from "../stt";
import { Player } from "./audio";
import "./voice.css";
import { activeTts, DEFAULT_TTS, DEFAULT_VOICE, fmtMs, TTS_PRESETS, type TtsConfig, type TtsProvider, type VoiceConfig } from "./voice";

export type VoiceTab = "dictation" | "talk";

const SAMPLE = "Cześć, tak brzmi mój głos. Możemy porozmawiać o twoim pomyśle.";

/** Pole tekstowe zapisywane po wyjściu z pola (jak w zakładce „Dyktowanie”). */
function Field({ label, value, placeholder, valid = (v) => v !== "", onSave }: { label: string; value: string; placeholder?: string; valid?: (v: string) => boolean; onSave(v: string): void }) {
  const [v, setV] = useState(value);
  useEffect(() => setV(value), [value]);
  return (
    <label className="prov-field">
      <span>{label}</span>
      <input value={v} placeholder={placeholder} spellCheck={false} onChange={(e) => setV(e.target.value)} onBlur={() => v.trim() !== value && valid(v.trim()) && onSave(v.trim())} />
    </label>
  );
}

function TtsRow({
  p,
  active,
  keyState,
  onActivate,
  onEdit,
  onRemove,
  onKey,
}: {
  p: TtsProvider;
  active: boolean;
  keyState: KeyState | undefined;
  onActivate(): void;
  onEdit(patch: Partial<TtsProvider>): void;
  onRemove(): void;
  onKey(key: string | null): Promise<void>;
}) {
  const [keyOpen, setKeyOpen] = useState(false);
  const [key, setKey] = useState("");
  const [keyErr, setKeyErr] = useState<string | null>(null);
  const missingKey = p.key && keyState == null;
  return (
    <div className="prov-row">
      <div className="prov-main">
        <Volume2 className="prov-icon" aria-hidden />
        <div className="prov-text">
          <div className="prov-name">
            {p.name}
            {active && <span className="prov-tag">używany</span>}
          </div>
          <div className="prov-state">
            {p.kind === "piper" ? (
              <span>lokalny program Piper</span>
            ) : !p.key ? (
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
      {p.kind === "speech" ? (
        <>
          <Field label="Adres" value={p.baseUrl ?? ""} valid={(v) => /^https?:\/\//i.test(v)} onSave={(v) => onEdit({ baseUrl: v.replace(/\/+$/, "") })} />
          <Field label="Model" value={p.model} onSave={(model) => onEdit({ model })} />
        </>
      ) : (
        <>
          <Field label="Program" value={p.command ?? ""} placeholder="piper (z PATH)" valid={() => true} onSave={(v) => onEdit({ command: v || undefined })} />
          <Field label="Głos (.onnx)" value={p.model} onSave={(model) => onEdit({ model })} />
        </>
      )}
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

export function TalkSettings() {
  const [voice, setVoice] = useState<VoiceConfig>(DEFAULT_VOICE);
  const [tts, setTts] = useState<TtsConfig>(DEFAULT_TTS);
  const [providers, setProviders] = useState<ProviderDef[]>([]);
  const [keys, setKeys] = useState<Record<string, KeyState>>({});
  const [errors, setErrors] = useState<string[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [test, setTest] = useState<{ busy: boolean; text?: string; error?: boolean }>({ busy: false });
  const player = useRef<Player | null>(null);

  useEffect(() => {
    let live = true;
    void Promise.all([backend.voiceConfig(), backend.ttsConfig(), backend.chatConfig()])
      .then(([v, t, c]) => {
        if (!live) return;
        setVoice(v.config);
        setTts(t.config);
        setProviders(c.providers);
        setErrors([...v.errors, ...t.errors]);
        setLoaded(true);
        for (const p of c.providers.filter((p) => p.discover))
          void backend
            .chatModels(p)
            .then((ids) => live && setProviders((prev) => prev.map((x) => (x.id === p.id ? withDiscovered(x, ids) : x))))
            .catch(() => undefined);
      })
      .catch((e: unknown) => live && setErrors([String(e)]));
    return () => {
      live = false;
      player.current?.close();
    };
  }, []);

  const refreshKeys = () =>
    void backend
      .ttsKeyStatus(tts.providers)
      .then(setKeys)
      .catch(() => undefined);
  useEffect(refreshKeys, [tts.providers]);

  const fail = (e: unknown) => setErrors([e instanceof Error ? e.message : String(e)]);
  const saveVoice = (next: VoiceConfig) => {
    setVoice(next);
    void backend.voiceSaveConfig(next).catch(fail);
  };
  const saveTts = (next: TtsConfig, nextVoice?: VoiceConfig) => {
    setTts(next);
    void backend.ttsSaveConfig(next).catch(fail);
    if (nextVoice) saveVoice(nextVoice);
  };
  const add = (t: TtsProvider) => {
    const id = sttFreeId(t.id, tts.providers.map((p) => p.id));
    const added = { ...t, id, name: id === t.id ? t.name : `${t.name} ${id.split("-").pop()}` };
    // Pierwszy silnik bez klucza od razu jest używany; z kluczem czeka na jego wpisanie.
    saveTts({ providers: [...tts.providers, added] }, voice.tts === null && !added.key ? { ...voice, tts: id } : undefined);
  };

  const listen = async () => {
    setTest({ busy: true });
    const t0 = performance.now();
    try {
      const audio = await backend.voiceSpeak("probe", SAMPLE);
      const ms = Math.round(performance.now() - t0);
      setTest({ busy: true, text: `synteza ${fmtMs(ms)}, gra…` });
      player.current ??= new Player();
      await player.current.play(audio, new AbortController().signal);
      setTest({ busy: false, text: `synteza ${fmtMs(ms)}` });
    } catch (e) {
      setTest({ busy: false, text: e instanceof Error ? e.message : String(e), error: true });
    }
  };

  const brainValue = voice.brain ? modelKey(voice.brain) : "";
  const selected = activeTts(tts, voice);
  const brainProvider = voice.brain && providers.find((p) => p.id === voice.brain!.provider);
  const brainMissing = voice.brain && !providers.some((p) => p.id === voice.brain!.provider && (p.discover || p.models.some((m) => m.id === voice.brain!.model)));

  if (!loaded && errors.length === 0) return <p>Wczytuję…</p>;

  return (
    <>
      <p>
        Kuleczka rozmowy słucha cały czas, a koniec wypowiedzi wykrywa po ciszy. Tekst rozpoznaje silnik z zakładki „Dyktowanie”, odpowiada model z Czatu, a czyta silnik mowy: lokalny Piper albo dowolne API z <code>/audio/speech</code>. Każdy z tych trzech elementów wybierasz osobno.
      </p>
      {errors.map((e, i) => (
        <div key={i} className="prov-error">
          {e}
        </div>
      ))}

      <div className="rail-label">Mózg</div>
      <label className="prov-field" style={{ marginLeft: 0 }}>
        <span>Model</span>
        <select
          value={brainValue}
          onChange={(e) => {
            const v = e.target.value;
            const [provider, ...rest] = v.split("/");
            saveVoice({ ...voice, brain: v ? { provider, model: rest.join("/") } : null });
          }}
        >
          <option value="">Pierwszy model z Czatu</option>
          {providers.map((p) => (
            <optgroup key={p.id} label={isCli(p) ? `${p.name} (bez narzędzi, wolniejszy start)` : p.name}>
              {p.models.map((m) => (
                <option key={m.id} value={modelKey({ provider: p.id, model: m.id })}>
                  {m.name}
                </option>
              ))}
            </optgroup>
          ))}
          {brainMissing && <option value={brainValue}>{brainValue} (nie ma w Czacie)</option>}
        </select>
        {brainProvider && isCli(brainProvider) && (
          <em>Program CLI startuje przy każdej odpowiedzi (kilka sekund). Do płynnej rozmowy lepszy jest model przez API albo lokalny.</em>
        )}
      </label>

      <div className="rail-label" style={{ marginTop: 16 }}>
        Głos
      </div>
      <div className="prov-list">
        {tts.providers.map((p) => (
          <TtsRow
            key={p.id}
            p={p}
            active={voice.tts === p.id}
            keyState={keys[p.id]}
            onActivate={() => saveVoice({ ...voice, tts: p.id })}
            onEdit={(patch) => saveTts({ providers: tts.providers.map((x) => (x.id === p.id ? { ...x, ...patch } : x)) })}
            onRemove={() => saveTts({ providers: tts.providers.filter((x) => x.id !== p.id) }, voice.tts === p.id ? { ...voice, tts: null } : undefined)}
            onKey={async (k) => {
              await backend.ttsSetKey(p.id, k);
              refreshKeys();
              if (k && voice.tts === null) saveVoice({ ...voice, tts: p.id });
            }}
          />
        ))}
        {tts.providers.length === 0 && <p className="prov-state">Bez silnika mowy rozmówca odpowiada tylko tekstem w zapisie rozmowy.</p>}
      </div>
      <div className="prov-add">
        {TTS_PRESETS.map((t) => (
          <button key={t.id} type="button" className="btn" onClick={() => add(t)}>
            <Plus aria-hidden /> {t.name}
          </button>
        ))}
      </div>
      {selected && (
        <>
          <Field
            key={`${selected.id}-${voice.voice}`}
            label={selected.kind === "piper" ? "Mówca (numer)" : "Głos"}
            value={voice.voice}
            placeholder={selected.voice || (selected.kind === "piper" ? "0" : "domyślny serwera")}
            valid={() => true}
            onSave={(v) => saveVoice({ ...voice, voice: v })}
          />
          <div className="prov-field">
            <button type="button" className="btn" disabled={test.busy} onClick={() => void listen()}>
              <Volume2 aria-hidden /> Posłuchaj
            </button>
            {test.text && <span className={test.error ? "is-warn" : undefined}>{test.text}</span>}
          </div>
        </>
      )}

      <label className="prov-check">
        <input type="checkbox" checked={voice.headphones} onChange={(e) => saveVoice({ ...voice, headphones: e.target.checked })} />
        <span>
          Mam słuchawki — szybsze przerywanie (bez ochrony przed echem z głośników)
        </span>
      </label>
      <p className="prov-state" style={{ marginTop: 12 }}>
        Zmiany działają od następnej rozmowy (zamknij i otwórz kuleczkę).
      </p>
    </>
  );
}
