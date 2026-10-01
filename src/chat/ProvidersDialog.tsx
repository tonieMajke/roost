// Okno „Dostawcy” (na wzór `Providers.tsx` z Pi Code, fd9dedf): stan każdego dostawcy, klucze API,
// test połączenia, dodawanie z gotowych szablonów. Zapis idzie do `chat.json` i sejfu systemowego.

import { useEffect, useState } from "react";
import { Check, KeyRound, Loader2, Plus, Server, Terminal, Trash2, Zap } from "lucide-react";
import { backend, type KeyState } from "../backend";
import { Dialog } from "../Dialog";
import { freeId, GROUP_LABELS, modelsCount, PROVIDER_TEMPLATES, type ProviderDef, type ProviderGroup } from "../chat";

type Props = {
  providers: ProviderDef[];
  offline: Record<string, string>;
  /** Nowa lista własnych dostawców (bez tych z pi): zapis i ponowne wczytanie. */
  onSave(providers: ProviderDef[]): Promise<void>;
  onClose(): void;
};

type Test = { state: "run" } | { state: "ok"; text: string; ms: number } | { state: "fail"; text: string };

const GROUPS: ProviderGroup[] = ["sub", "api", "local"];

function kindLabel(p: ProviderDef): string {
  if (p.kind === "claude-cli") return `subskrypcja przez program ${p.command || "claude"}`;
  if (p.kind === "codex-cli") return `subskrypcja przez program ${p.command || "codex"}`;
  return p.baseUrl ?? "";
}

function ProviderRow({
  p,
  keyState,
  offline,
  onKey,
  onRemove,
  onEdit,
}: {
  p: ProviderDef;
  keyState: KeyState | undefined;
  offline?: string;
  onKey(key: string | null): Promise<void>;
  onRemove?: () => void;
  onEdit?: (patch: Partial<ProviderDef>) => void;
}) {
  const [test, setTest] = useState<Test | null>(null);
  const [keyOpen, setKeyOpen] = useState(false);
  const [key, setKey] = useState("");
  const [keyErr, setKeyErr] = useState<string | null>(null);
  const [url, setUrl] = useState(p.baseUrl ?? "");

  const runTest = () => {
    const model = p.models[0];
    if (!model) return setTest({ state: "fail", text: offline ?? "brak modelu do testu" });
    setTest({ state: "run" });
    const t0 = performance.now();
    let text = "";
    backend.chatSend(
      { provider: p, model: model.id, system: "Odpowiadaj jednym słowem.", messages: [{ role: "user", content: "Napisz: OK" }], prompt: "Napisz: OK", search: false },
      (e) => {
        if (e.type === "text") text += e.text;
        else if (e.type === "error") setTest({ state: "fail", text: e.message });
        else if (e.type === "done") setTest({ state: "ok", text: `${model.name}: „${text.trim().slice(0, 40)}”`, ms: Math.round(performance.now() - t0) });
      },
    );
  };

  const Icon = p.group === "sub" ? Terminal : p.group === "local" ? Server : KeyRound;
  return (
    <div className="prov-row">
      <div className="prov-main">
        <Icon className="prov-icon" aria-hidden />
        <div className="prov-text">
          <div className="prov-name">
            {p.name}
            {p.from === "pi" && <span className="prov-tag">z pi</span>}
          </div>
          <div className="prov-sub">{kindLabel(p)}</div>
          <div className="prov-state">
            {p.key && (keyState === "stored" ? <span className="is-ok">klucz w sejfie</span> : keyState === "env" ? <span className="is-ok">klucz z ${p.keyEnv}</span> : <span className="is-warn">brak klucza</span>)}
            {offline ? <span className="is-warn" title={offline}>nie odpowiada</span> : p.discover && p.models.length > 0 ? <span>{modelsCount(p.models.length)}</span> : null}
            {test?.state === "run" && (
              <span>
                <Loader2 className="spin" aria-hidden /> test…
              </span>
            )}
            {test?.state === "ok" && (
              <span className="is-ok">
                <Check aria-hidden /> {test.text} · {(test.ms / 1000).toFixed(1).replace(".", ",")} s
              </span>
            )}
            {test?.state === "fail" && <span className="is-warn">{test.text}</span>}
          </div>
        </div>
        <div className="prov-btns">
          <button type="button" className="btn" onClick={runTest} disabled={test?.state === "run"}>
            <Zap aria-hidden /> Testuj
          </button>
          {p.key && p.from !== "pi" && (
            <button type="button" className={`btn${keyOpen ? " is-on" : ""}`} onClick={() => setKeyOpen((v) => !v)}>
              <KeyRound aria-hidden /> Klucz
            </button>
          )}
          {onRemove && (
            <button type="button" className="icon" title="Usuń dostawcę" aria-label={`Usuń dostawcę ${p.name}`} onClick={onRemove}>
              <Trash2 size={15} strokeWidth={1.75} aria-hidden />
            </button>
          )}
        </div>
      </div>
      {onEdit && (p.kind === "openai" || p.kind === "anthropic") && (
        <label className="prov-field">
          <span>Adres</span>
          <input
            value={url}
            spellCheck={false}
            onChange={(e) => setUrl(e.target.value)}
            onBlur={() => url.trim() !== p.baseUrl && onEdit({ baseUrl: url.trim().replace(/\/+$/, "") })}
          />
        </label>
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
          <input type="password" value={key} autoFocus placeholder={keyState === "stored" ? "zapisany – wpisz nowy, by zmienić" : "sk-…"} onChange={(e) => setKey(e.target.value)} autoComplete="off" />
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

export function ProvidersDialog({ providers, offline, onSave, onClose }: Props) {
  const [keys, setKeys] = useState<Record<string, KeyState>>({});
  const [error, setError] = useState<string | null>(null);

  const refreshKeys = () =>
    void backend
      .chatKeyStatus(providers)
      .then(setKeys)
      .catch(() => undefined);
  useEffect(refreshKeys, [providers]);

  const own = providers.filter((p) => p.from !== "pi");
  const save = (next: ProviderDef[]) => {
    setError(null);
    void onSave(next).catch((e: unknown) => setError(String(e)));
  };
  const add = (t: ProviderDef) => {
    const id = freeId(t.id, providers.map((p) => p.id));
    save([...own, { ...t, id, name: id === t.id ? t.name : `${t.name} ${id.split("-").pop()}`, models: [...t.models] }]);
  };

  return (
    <Dialog label="Dostawcy" className="prov-dialog" onClose={onClose}>
      {() => (
        <>
          <h2>Dostawcy modeli</h2>
          <p>
            Subskrypcje działają przez zalogowane programy <code>claude</code> i <code>codex</code>. Klucze API trafiają do sejfu systemowego, nie do plików. Dostawców z pi edytujesz w <code>~/.pi/agent/models.json</code>.
          </p>
          {error && <div className="prov-error">{error}</div>}
          <div className="prov-list">
            {GROUPS.map((g) => {
              const list = providers.filter((p) => p.group === g);
              if (list.length === 0) return null;
              return (
                <section key={g}>
                  <div className="rail-label">{GROUP_LABELS[g]}</div>
                  {list.map((p) => (
                    <ProviderRow
                      key={p.id}
                      p={p}
                      keyState={keys[p.id]}
                      offline={offline[p.id]}
                      onKey={async (k) => {
                        await backend.chatSetKey(p.id, k);
                        refreshKeys();
                      }}
                      onRemove={p.from === "pi" ? undefined : () => save(own.filter((x) => x.id !== p.id))}
                      onEdit={p.from === "pi" ? undefined : (patch) => save(own.map((x) => (x.id === p.id ? { ...x, ...patch } : x)))}
                    />
                  ))}
                </section>
              );
            })}
          </div>
          <div className="rail-label">Dodaj</div>
          <div className="prov-add">
            {PROVIDER_TEMPLATES.map((t) => (
              <button key={t.id} type="button" className="btn" onClick={() => add(t)}>
                <Plus aria-hidden /> {t.name}
              </button>
            ))}
          </div>
        </>
      )}
    </Dialog>
  );
}
