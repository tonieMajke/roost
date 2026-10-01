import { useEffect, useState, type CSSProperties } from "react";
import { ChevronDown, ChevronRight, Download, FolderPlus, ImagePlus, Trash2, X } from "lucide-react";
import { backend, type BotSkillMeta, type BotSkillSource } from "../backend";
import {
  botGreeting,
  MEMORY_LIMIT,
  parseSkill,
  TOOL_GROUPS,
  USER_LIMIT,
  type BotDef,
  type Tone,
  type ToolGroup,
} from "../bot";
import { modelLabel, type ProviderDef } from "../chat";
import { CONFIRM_MS } from "../confirm";
import { Dialog } from "../Dialog";
import { ModelMenu } from "../chat/Composer";
import { Markdown } from "../chat/Markdown";
import { Avatar, forgetAvatar } from "./Avatar";
import { Routines } from "./Routines";

export type CardTab = "persona" | "memory" | "skills" | "routines" | "settings";
const TABS: { id: CardTab; label: string }[] = [
  { id: "persona", label: "Osobowość" },
  { id: "memory", label: "Pamięć" },
  { id: "skills", label: "Skille" },
  { id: "routines", label: "Harmonogram" },
  { id: "settings", label: "Ustawienia" },
];

export const TONES: { id: Tone; label: string }[] = [
  { id: "serious", label: "Poważnie" },
  { id: "balanced", label: "Pośrodku" },
  { id: "playful", label: "Na luzie" },
];
const COLORS = ["#7c8cff", "#e2704a", "#e0a050", "#4fc38a", "#3fb4d0", "#9b7cf0", "#e05f95", "#9aa0a6"];
const EMOJI = ["🤖", "🦀", "🌙", "🧭", "📚", "🛠️", "🧪", "🎨", "🐙", "🦉"];

export const GROUPS: Record<ToolGroup, { label: string; hint: string }> = {
  web: { label: "Sieć", hint: "wyszukiwanie i czytanie stron" },
  read: { label: "Czytanie plików", hint: "foldery poniżej bez pytania, reszta za zgodą" },
  write: { label: "Zapis plików", hint: "w katalogu roboczym swobodnie, poza nim za zgodą" },
  bash: { label: "Powłoka", hint: "każde polecenie za zgodą" },
  memory: { label: "Pamięć", hint: "notatki bota i to, co wie o tobie" },
  skills: { label: "Skille", hint: "czyta i zapisuje własne przepisy" },
};

const BY: Record<NonNullable<BotSkillMeta["by"]>, string> = { bot: "bot", user: "ty", import: "import" };
const day = (ms: number) => new Date(ms).toLocaleDateString("pl-PL", { day: "numeric", month: "short", year: "numeric" });
const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));

type Props = {
  bot: BotDef;
  providers: ProviderDef[];
  offline: Record<string, string>;
  tab: CardTab;
  onSaved(bot: BotDef): void;
  onDeleted(id: string): void;
  onProviders(): void;
  /** Przebieg z zakładki Harmonogram: karta się zamyka, przebieg otwiera w rozmowie. */
  onOpenRun(chat: string): void;
  onClose(): void;
};

function Persona({ draft, set, onError }: { draft: BotDef; set(p: Partial<BotDef>): void; onError(e: string): void }) {
  const pickImage = async () => {
    try {
      const file = await backend.pickImage();
      if (!file) return;
      const image = await backend.botAvatarImport(draft.id, file);
      forgetAvatar(draft.id, image);
      // Nowy obiekt awatara: obrazek z tą samą nazwą pliku też się przerysuje.
      set({ avatar: { ...draft.avatar, image } });
    } catch (e) {
      onError(errText(e));
    }
  };
  return (
    <div className="card-grid">
      <div className="card-fields">
        <label className="card-field">
          <span>Imię</span>
          <input value={draft.name} maxLength={40} onChange={(e) => set({ name: e.target.value })} />
        </label>
        <div className="card-field">
          <span>Awatar</span>
          <div className="card-row">
            {EMOJI.map((em) => (
              <button
                key={em}
                type="button"
                className={`card-emoji${!draft.avatar.image && draft.avatar.emoji === em ? " is-on" : ""}`}
                onClick={() => set({ avatar: { emoji: em } })}
              >
                {em}
              </button>
            ))}
            <input
              className="card-emoji-input"
              value={draft.avatar.image ? "" : (draft.avatar.emoji ?? "")}
              placeholder="inne"
              maxLength={8}
              onChange={(e) => set({ avatar: { emoji: e.target.value || undefined } })}
              aria-label="Własne emoji"
            />
            <button type="button" className="btn" onClick={() => void pickImage()}>
              <ImagePlus aria-hidden /> Obrazek…
            </button>
          </div>
        </div>
        <div className="card-field">
          <span>Kolor</span>
          <div className="card-row">
            {COLORS.map((c) => (
              <button key={c} type="button" className={`card-swatch${draft.color === c ? " is-on" : ""}`} style={{ background: c }} onClick={() => set({ color: c })} aria-label={`Kolor ${c}`} />
            ))}
            <input type="color" className="card-color" value={draft.color} onChange={(e) => set({ color: e.target.value })} aria-label="Własny kolor" />
          </div>
        </div>
        <label className="card-field">
          <span>Kim jest i do czego służy</span>
          <textarea rows={3} value={draft.persona} placeholder="Pierwsze zdanie to powitanie w nowej rozmowie." onChange={(e) => set({ persona: e.target.value })} />
        </label>
        <label className="card-field">
          <span>Jak mówi</span>
          <textarea rows={2} value={draft.style} placeholder="np. krótko, z humorem, jak pirat" onChange={(e) => set({ style: e.target.value })} />
        </label>
        <label className="card-field">
          <span>Czego unika</span>
          <input value={draft.avoid} placeholder="np. plotek bez źródła" onChange={(e) => set({ avoid: e.target.value })} />
        </label>
        <div className="card-field">
          <span>Ton</span>
          <div className="card-tone">
            <input
              type="range"
              min={0}
              max={2}
              step={1}
              value={TONES.findIndex((t) => t.id === draft.tone)}
              onChange={(e) => set({ tone: TONES[Number(e.target.value)].id })}
              aria-label="Ton: powaga – luz"
            />
            <div className="card-tone-labels">
              {TONES.map((t) => (
                <span key={t.id} className={draft.tone === t.id ? "is-on" : ""}>
                  {t.label}
                </span>
              ))}
            </div>
          </div>
        </div>
      </div>
      <aside className="card-preview" style={{ "--bot": draft.color } as CSSProperties}>
        <div className="rail-label">Tak się przedstawi</div>
        <Avatar bot={draft} size="lg" />
        <div className="card-preview-name">{draft.name || "Bez imienia"}</div>
        <p className="card-preview-text">{botGreeting(draft)}</p>
        {draft.style.trim() && <p className="card-preview-style">„{draft.style.trim()}”</p>}
      </aside>
    </div>
  );
}

function MemoryField({ title, hint, value, limit, onSave }: { title: string; hint: string; value: string; limit: number; onSave(text: string): Promise<void> }) {
  const [text, setText] = useState(value);
  const [state, setState] = useState<"idle" | "saving" | "saved">("idle");
  useEffect(() => setText(value), [value]);
  const over = text.length > limit;
  return (
    <div className="card-field">
      <div className="card-field-head">
        <span>{title}</span>
        <span className={`card-count${over ? " is-over" : ""}`}>
          {text.length} / {limit}
        </span>
      </div>
      <textarea rows={7} value={text} spellCheck={false} onChange={(e) => (setText(e.target.value), setState("idle"))} />
      <div className="card-row">
        <small className="card-hint">{hint}</small>
        <span className="chat-composer-gap" />
        {state === "saved" && <small className="card-ok">zapisano</small>}
        <button
          type="button"
          className="btn"
          disabled={over || text === value || state === "saving"}
          onClick={() => {
            setState("saving");
            void onSave(text).then(
              () => setState("saved"),
              () => setState("idle"),
            );
          }}
        >
          Zapisz
        </button>
      </div>
    </div>
  );
}

function Memory({ bot, onError }: { bot: BotDef; onError(e: string): void }) {
  const [mem, setMem] = useState<{ memory: string; user: string } | null>(null);
  useEffect(() => {
    void backend.botMemory(bot.id).then(setMem, (e: unknown) => onError(errText(e)));
  }, [bot.id, onError]);
  if (!mem) return <p className="card-hint">Wczytuję…</p>;
  const save = (target: "memory" | "user") => async (text: string) => {
    try {
      await backend.botMemorySave(bot.id, target, text);
      setMem((m) => (m ? { ...m, [target]: text } : m));
    } catch (e) {
      onError(errText(e));
      throw e;
    }
  };
  return (
    <div className="card-fields">
      <p className="card-hint">Wpisy oddziela linia z samym znakiem §. Bot widzi zmiany od następnej rozmowy.</p>
      <MemoryField title="Notatki bota" hint="fakty i wnioski z pracy" value={mem.memory} limit={MEMORY_LIMIT} onSave={save("memory")} />
      <MemoryField title="O tobie" hint="kim jesteś, co lubisz" value={mem.user} limit={USER_LIMIT} onSave={save("user")} />
    </div>
  );
}

function Skills({ bot, onError }: { bot: BotDef; onError(e: string): void }) {
  const [list, setList] = useState<BotSkillMeta[] | null>(null);
  const [open, setOpen] = useState<{ name: string; body: string } | null>(null);
  const [armed, setArmed] = useState<string | null>(null);
  const [sources, setSources] = useState<BotSkillSource[] | null>(null);
  const reload = () => void backend.botSkills(bot.id).then(setList, (e: unknown) => onError(errText(e)));
  useEffect(reload, [bot.id]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (armed === null) return;
    const t = setTimeout(() => setArmed(null), CONFIRM_MS);
    return () => clearTimeout(t);
  }, [armed]);

  const view = async (name: string) => {
    if (open?.name === name) return setOpen(null);
    const md = await backend.botSkill(bot.id, name).catch(() => null);
    const s = md ? parseSkill(md) : null;
    setOpen({ name, body: s && !("error" in s) ? s.body : (md ?? "") });
  };
  const remove = (name: string) => {
    if (armed !== name) return setArmed(name);
    setArmed(null);
    void backend.botSkillDelete(bot.id, name).then(reload, (e: unknown) => onError(errText(e)));
  };
  const toggleImport = () => {
    if (sources) return setSources(null);
    void backend.botSkillSources().then(setSources, (e: unknown) => onError(errText(e)));
  };
  const have = new Set(list?.map((s) => s.name));

  return (
    <div className="card-fields">
      {list === null ? (
        <p className="card-hint">Wczytuję…</p>
      ) : list.length === 0 ? (
        <p className="card-hint">Bot nie ma jeszcze skilli. Zapisze je sam po zadaniach, które wymagały wielu kroków, albo zaimportuj gotowe.</p>
      ) : (
        <div className="card-list">
          {list.map((s) => (
            <div key={s.name} className={`card-skill${open?.name === s.name ? " is-open" : ""}`}>
              <div className="card-skill-row">
                <button type="button" className="card-skill-head" onClick={() => void view(s.name)}>
                  <ChevronRight className="card-chev" aria-hidden />
                  <span className="card-skill-name">{s.name}</span>
                  <span className="card-skill-desc">{s.error ? <span className="is-warn">{s.error}</span> : s.description}</span>
                </button>
                <span className="card-skill-meta">
                  {s.by ? `${BY[s.by]} · ` : ""}
                  {day(s.updated)}
                </span>
                <button type="button" className={`btn card-del${armed === s.name ? " is-confirm" : ""}`} onClick={() => remove(s.name)} title="Usuń skill">
                  {armed === s.name ? "Na pewno?" : <Trash2 aria-hidden />}
                </button>
              </div>
              {open?.name === s.name && (
                <div className="card-skill-body chat-md">
                  <Markdown text={open.body} />
                </div>
              )}
            </div>
          ))}
        </div>
      )}
      <div className="card-row">
        <button type="button" className="btn" onClick={toggleImport}>
          <Download aria-hidden /> Importuj z <code>~/.claude/skills</code>
          {sources ? <ChevronDown aria-hidden /> : null}
        </button>
      </div>
      {sources && (
        <div className="card-list">
          {sources.length === 0 && <p className="card-hint">W ~/.claude/skills nie ma skilli.</p>}
          {sources.map((s) => (
            <div key={s.name} className="card-skill-row">
              <span className="card-skill-name">{s.name}</span>
              <span className="card-skill-desc">{s.error ? <span className="is-warn">{s.error}</span> : s.description}</span>
              <button
                type="button"
                className="btn"
                disabled={!!s.error || have.has(s.name)}
                onClick={() => void backend.botSkillImport(bot.id, s.name).then(reload, (e: unknown) => onError(errText(e)))}
              >
                {have.has(s.name) ? "jest" : "Importuj"}
              </button>
            </div>
          ))}
          <p className="card-hint">Kopia do folderu bota – oryginał zostaje bez zmian.</p>
        </div>
      )}
    </div>
  );
}

function Settings({
  draft,
  set,
  providers,
  offline,
  onProviders,
  onDelete,
}: {
  draft: BotDef;
  set(p: Partial<BotDef>): void;
  providers: ProviderDef[];
  offline: Record<string, string>;
  onProviders(): void;
  onDelete(): void;
}) {
  const [menu, setMenu] = useState(false);
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    if (!armed) return;
    const t = setTimeout(() => setArmed(false), CONFIRM_MS);
    return () => clearTimeout(t);
  }, [armed]);
  const addFolder = async () => {
    const dir = await backend.pickDir().catch(() => null);
    if (dir && !draft.folders.includes(dir)) set({ folders: [...draft.folders, dir] });
  };
  return (
    <div className="card-fields">
      <div className="card-field">
        <span>Model</span>
        <div className="chat-model-wrap">
          <button type="button" className="btn card-model" onClick={() => setMenu((v) => !v)} aria-haspopup="menu" aria-expanded={menu}>
            {draft.model ? modelLabel(providers, draft.model) : "Pierwszy z listy"}
            <ChevronDown aria-hidden />
          </button>
          {menu && (
            <ModelMenu
              providers={providers}
              offline={offline}
              model={draft.model}
              onModel={(m) => (set({ model: m }), setMenu(false))}
              onProviders={onProviders}
              onClose={() => setMenu(false)}
            />
          )}
        </div>
      </div>
      <div className="card-field">
        <span>Foldery, które bot czyta bez pytania</span>
        {draft.folders.length === 0 && <small className="card-hint">Żadnych – czyta tylko swój katalog roboczy.</small>}
        {draft.folders.map((f) => (
          <div key={f} className="card-folder">
            <code>{f}</code>
            <button type="button" className="icon" aria-label={`Usuń folder ${f}`} onClick={() => set({ folders: draft.folders.filter((x) => x !== f) })}>
              <X size={14} aria-hidden />
            </button>
          </div>
        ))}
        <div className="card-row">
          <button type="button" className="btn" onClick={() => void addFolder()}>
            <FolderPlus aria-hidden /> Dodaj folder…
          </button>
        </div>
      </div>
      <div className="card-field">
        <span>Narzędzia</span>
        <div className="card-tools">
          {TOOL_GROUPS.map((g) => (
            <label key={g} className="card-tool">
              <input type="checkbox" checked={draft.tools[g]} onChange={(e) => set({ tools: { ...draft.tools, [g]: e.target.checked } })} />
              <span className="card-tool-text">
                <b>{GROUPS[g].label}</b>
                <small>{GROUPS[g].hint}</small>
              </span>
            </label>
          ))}
        </div>
      </div>
      {!draft.builtin && (
        <div className="card-danger">
          <span>
            Usunięty bot trafia do kosza (<code>bots-trash</code>) razem z pamięcią i rozmowami.
          </span>
          <button
            type="button"
            className={`btn card-del${armed ? " is-confirm" : ""}`}
            onClick={() => {
              if (!armed) return setArmed(true);
              onDelete();
            }}
          >
            <Trash2 aria-hidden /> {armed ? "Na pewno usunąć?" : "Usuń bota"}
          </button>
        </div>
      )}
    </div>
  );
}

/** Karta bota: osobowość, pamięć, skille, harmonogram i ustawienia. Osobowość i ustawienia zapisuje
 *  „Zapisz”, pamięć, skille i harmonogram zapisują się od razu (osobne pliki). */
export function BotCard({ bot, providers, offline, tab: initial, onSaved, onDeleted, onProviders, onOpenRun, onClose }: Props) {
  const [tab, setTab] = useState<CardTab>(initial);
  const [draft, setDraft] = useState<BotDef>(bot);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const set = (p: Partial<BotDef>) => setDraft((d) => ({ ...d, ...p }));
  const dirty = JSON.stringify(draft) !== JSON.stringify(bot);
  const valid = draft.name.trim() !== "";

  const save = async (close: () => void) => {
    setSaving(true);
    setError(null);
    try {
      onSaved(await backend.botSave({ ...draft, name: draft.name.trim() }));
      close();
    } catch (e) {
      setError(errText(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog label={`Karta bota ${bot.name}`} className="bot-card" onClose={onClose}>
      {(cancel) => (
        <>
          <header className="card-head">
            <Avatar bot={draft} size="md" />
            <div className="card-title">
              <h2>{draft.name || "Bez imienia"}</h2>
              <small>{draft.builtin ? "wbudowany – można edytować, nie można usunąć" : `utworzony ${day(draft.created)}`}</small>
            </div>
            <button type="button" className="icon" aria-label="Zamknij" onClick={cancel}>
              <X size={15} aria-hidden />
            </button>
          </header>
          <div className="seg card-tabs" role="tablist">
            {TABS.map((t) => (
              <button key={t.id} type="button" role="tab" aria-selected={tab === t.id} className={tab === t.id ? "is-on" : ""} onClick={() => setTab(t.id)}>
                {t.label}
              </button>
            ))}
          </div>
          {error && <div className="prov-error">{error}</div>}
          <div className="card-body">
            {tab === "persona" && <Persona draft={draft} set={set} onError={setError} />}
            {tab === "memory" && <Memory bot={bot} onError={setError} />}
            {tab === "skills" && <Skills bot={bot} onError={setError} />}
            {tab === "routines" && <Routines bot={bot} onError={setError} onOpenRun={onOpenRun} />}
            {tab === "settings" && (
              <Settings
                draft={draft}
                set={set}
                providers={providers}
                offline={offline}
                onProviders={onProviders}
                onDelete={() =>
                  void backend.botDelete(bot.id).then(
                    () => onDeleted(bot.id),
                    (e: unknown) => setError(errText(e)),
                  )
                }
              />
            )}
          </div>
          {(tab === "persona" || tab === "settings" || dirty) && (
            <footer className="card-foot">
              <small>{dirty ? "Niezapisane zmiany osobowości lub ustawień" : "Bez zmian"}</small>
              <span className="chat-composer-gap" />
              <button type="button" className="btn" onClick={cancel}>
                Anuluj
              </button>
              <button type="button" className="btn primary" disabled={!dirty || !valid || saving} onClick={() => void save(cancel)}>
                Zapisz
              </button>
            </footer>
          )}
        </>
      )}
    </Dialog>
  );
}
