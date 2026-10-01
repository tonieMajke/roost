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
import { useT } from "../i18n";

export type VoiceTab = "dictation" | "talk";

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
  const { t } = useT();
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
            {active && <span className="prov-tag">{t("voice.dlg.inUse")}</span>}
          </div>
          <div className="prov-state">
            {p.kind === "piper" ? (
              <span>{t("voice.talk.piperLocal")}</span>
            ) : !p.key ? (
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
      {p.kind === "speech" ? (
        <>
          <Field label={t("voice.dlg.address")} value={p.baseUrl ?? ""} valid={(v) => /^https?:\/\//i.test(v)} onSave={(v) => onEdit({ baseUrl: v.replace(/\/+$/, "") })} />
          <Field label={t("voice.dlg.model")} value={p.model} onSave={(model) => onEdit({ model })} />
        </>
      ) : (
        <>
          <Field label={t("voice.talk.program")} value={p.command ?? ""} placeholder={t("voice.talk.programPlaceholder")} valid={() => true} onSave={(v) => onEdit({ command: v || undefined })} />
          <Field label={t("voice.talk.onnx")} value={p.model} onSave={(model) => onEdit({ model })} />
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

export function TalkSettings() {
  const { t } = useT();
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
  const add = (preset: TtsProvider) => {
    const id = sttFreeId(preset.id, tts.providers.map((p) => p.id));
    const added = { ...preset, id, name: id === preset.id ? preset.name : `${preset.name} ${id.split("-").pop()}` };
    // Pierwszy silnik bez klucza od razu jest używany; z kluczem czeka na jego wpisanie.
    saveTts({ providers: [...tts.providers, added] }, voice.tts === null && !added.key ? { ...voice, tts: id } : undefined);
  };

  const listen = async () => {
    setTest({ busy: true });
    const t0 = performance.now();
    try {
      const audio = await backend.voiceSpeak("probe", t("voice.sample"));
      const ms = Math.round(performance.now() - t0);
      setTest({ busy: true, text: t("voice.talk.synthPlaying", { t: fmtMs(ms) }) });
      player.current ??= new Player();
      await player.current.play(audio, new AbortController().signal);
      setTest({ busy: false, text: t("voice.talk.synth", { t: fmtMs(ms) }) });
    } catch (e) {
      setTest({ busy: false, text: e instanceof Error ? e.message : String(e), error: true });
    }
  };

  const brainValue = voice.brain ? modelKey(voice.brain) : "";
  const selected = activeTts(tts, voice);
  const brainProvider = voice.brain && providers.find((p) => p.id === voice.brain!.provider);
  const brainMissing = voice.brain && !providers.some((p) => p.id === voice.brain!.provider && (p.discover || p.models.some((m) => m.id === voice.brain!.model)));

  if (!loaded && errors.length === 0) return <p>{t("voice.talk.loading")}</p>;

  return (
    <>
      <p>
        {t("voice.talk.intro.pre")}<code>/audio/speech</code>{t("voice.talk.intro.post")}
      </p>
      {errors.map((e, i) => (
        <div key={i} className="prov-error">
          {e}
        </div>
      ))}

      <div className="rail-label">{t("voice.talk.brain")}</div>
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
          <option value="">{t("voice.talk.firstModel")}</option>
          {providers.map((p) => (
            <optgroup key={p.id} label={isCli(p) ? t("voice.talk.cliGroup", { name: p.name }) : p.name}>
              {p.models.map((m) => (
                <option key={m.id} value={modelKey({ provider: p.id, model: m.id })}>
                  {m.name}
                </option>
              ))}
            </optgroup>
          ))}
          {brainMissing && <option value={brainValue}>{t("voice.talk.notInChat", { model: brainValue })}</option>}
        </select>
        {brainProvider && isCli(brainProvider) && (
          <em>{t("voice.talk.cliNote")}</em>
        )}
      </label>

      <div className="rail-label" style={{ marginTop: 16 }}>
        {t("voice.talk.voice")}
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
        {tts.providers.length === 0 && <p className="prov-state">{t("voice.talk.noEngine")}</p>}
      </div>
      <div className="prov-add">
        {TTS_PRESETS.map((preset) => (
          <button key={preset.id} type="button" className="btn" onClick={() => add(preset)}>
            <Plus aria-hidden /> {preset.name}
          </button>
        ))}
      </div>
      {selected && (
        <>
          <Field
            key={`${selected.id}-${voice.voice}`}
            label={selected.kind === "piper" ? t("voice.talk.speaker") : t("voice.talk.voice")}
            value={voice.voice}
            placeholder={selected.voice || (selected.kind === "piper" ? "0" : t("voice.talk.serverDefault"))}
            valid={() => true}
            onSave={(v) => saveVoice({ ...voice, voice: v })}
          />
          <div className="prov-field">
            <button type="button" className="btn" disabled={test.busy} onClick={() => void listen()}>
              <Volume2 aria-hidden /> {t("voice.talk.listen")}
            </button>
            {test.text && <span className={test.error ? "is-warn" : undefined}>{test.text}</span>}
          </div>
        </>
      )}

      <label className="prov-check">
        <input type="checkbox" checked={voice.headphones} onChange={(e) => saveVoice({ ...voice, headphones: e.target.checked })} />
        <span>{t("voice.talk.headphones")}</span>
      </label>
      <p className="prov-state" style={{ marginTop: 12 }}>
        {t("voice.talk.applyNote")}
      </p>
    </>
  );
}
