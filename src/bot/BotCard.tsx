import { useEffect, useState, type CSSProperties } from "react";
import { ChevronDown, ChevronRight, Download, FolderPlus, ImagePlus, Trash2, X } from "lucide-react";
import { locale, t, type Key } from "../i18n";
import { useT } from "../i18n/useT";
import { backend, type BotSkillMeta, type BotSkillSource } from "../backend";
import {
  botGreeting,
  displayName,
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
const TAB_IDS: CardTab[] = ["persona", "memory", "skills", "routines", "settings"];

/** Etykiety liczone przy każdym użyciu, żeby szły za zmianą języka. */
export const tones = (): { id: Tone; label: string }[] =>
  (["serious", "balanced", "playful"] as const).map((id) => ({ id, label: t(`bot.tone.${id}` as const) }));
const COLORS = ["#7c8cff", "#e2704a", "#e0a050", "#4fc38a", "#3fb4d0", "#9b7cf0", "#e05f95", "#9aa0a6"];
const EMOJI = ["🤖", "🦀", "🌙", "🧭", "📚", "🛠️", "🧪", "🎨", "🐙", "🦉"];

export const groups = (): Record<ToolGroup, { label: string; hint: string }> =>
  Object.fromEntries(TOOL_GROUPS.map((g) => [g, { label: t(`bot.group.${g}` as Key), hint: t(`bot.group.${g}.hint` as Key) }])) as Record<ToolGroup, { label: string; hint: string }>;

const day = (ms: number) => new Date(ms).toLocaleDateString(locale(), { day: "numeric", month: "short", year: "numeric" });
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
  const { t } = useT();
  const tn = tones();
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
          <span>{t("bot.persona.name")}</span>
          <input value={draft.name} maxLength={40} onChange={(e) => set({ name: e.target.value })} />
        </label>
        <div className="card-field">
          <span>{t("bot.persona.avatar")}</span>
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
              placeholder={t("bot.persona.emojiOther")}
              maxLength={8}
              onChange={(e) => set({ avatar: { emoji: e.target.value || undefined } })}
              aria-label={t("bot.persona.emojiAria")}
            />
            <button type="button" className="btn" onClick={() => void pickImage()}>
              <ImagePlus aria-hidden /> {t("bot.persona.image")}
            </button>
          </div>
        </div>
        <div className="card-field">
          <span>{t("bot.persona.color")}</span>
          <div className="card-row">
            {COLORS.map((c) => (
              <button key={c} type="button" className={`card-swatch${draft.color === c ? " is-on" : ""}`} style={{ background: c }} onClick={() => set({ color: c })} aria-label={t("bot.persona.colorAria", { c })} />
            ))}
            <input type="color" className="card-color" value={draft.color} onChange={(e) => set({ color: e.target.value })} aria-label={t("bot.persona.colorCustom")} />
          </div>
        </div>
        <label className="card-field">
          <span>{t("bot.persona.who")}</span>
          <textarea rows={3} value={draft.persona} placeholder={t("bot.persona.whoPh")} onChange={(e) => set({ persona: e.target.value })} />
        </label>
        <label className="card-field">
          <span>{t("bot.persona.how")}</span>
          <textarea rows={2} value={draft.style} placeholder={t("bot.persona.howPh")} onChange={(e) => set({ style: e.target.value })} />
        </label>
        <label className="card-field">
          <span>{t("bot.persona.avoid")}</span>
          <input value={draft.avoid} placeholder={t("bot.persona.avoidPh")} onChange={(e) => set({ avoid: e.target.value })} />
        </label>
        <div className="card-field">
          <span>{t("bot.persona.tone")}</span>
          <div className="card-tone">
            <input
              type="range"
              min={0}
              max={2}
              step={1}
              value={tn.findIndex((x) => x.id === draft.tone)}
              onChange={(e) => set({ tone: tn[Number(e.target.value)].id })}
              aria-label={t("bot.persona.toneAria")}
            />
            <div className="card-tone-labels">
              {tn.map((x) => (
                <span key={x.id} className={draft.tone === x.id ? "is-on" : ""}>
                  {x.label}
                </span>
              ))}
            </div>
          </div>
        </div>
      </div>
      <aside className="card-preview" style={{ "--bot": draft.color } as CSSProperties}>
        <div className="rail-label">{t("bot.persona.preview")}</div>
        <Avatar bot={draft} size="lg" />
        <div className="card-preview-name">{draft.name || t("bot.persona.unnamed")}</div>
        <p className="card-preview-text">{botGreeting(draft)}</p>
        {draft.style.trim() && <p className="card-preview-style">„{draft.style.trim()}”</p>}
      </aside>
    </div>
  );
}

function MemoryField({ title, hint, value, limit, onSave }: { title: string; hint: string; value: string; limit: number; onSave(text: string): Promise<void> }) {
  const { t } = useT();
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
        {state === "saved" && <small className="card-ok">{t("bot.mem.saved")}</small>}
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
          {t("bot.save")}
        </button>
      </div>
    </div>
  );
}

function Memory({ bot, onError }: { bot: BotDef; onError(e: string): void }) {
  const { t } = useT();
  const [mem, setMem] = useState<{ memory: string; user: string } | null>(null);
  useEffect(() => {
    void backend.botMemory(bot.id).then(setMem, (e: unknown) => onError(errText(e)));
  }, [bot.id, onError]);
  if (!mem) return <p className="card-hint">{t("bot.loading")}</p>;
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
      <p className="card-hint">{t("bot.mem.intro")}</p>
      <MemoryField title={t("bot.mem.notes")} hint={t("bot.mem.notesHint")} value={mem.memory} limit={MEMORY_LIMIT} onSave={save("memory")} />
      <MemoryField title={t("bot.mem.user")} hint={t("bot.mem.userHint")} value={mem.user} limit={USER_LIMIT} onSave={save("user")} />
    </div>
  );
}

function Skills({ bot, onError }: { bot: BotDef; onError(e: string): void }) {
  const { t } = useT();
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
        <p className="card-hint">{t("bot.loading")}</p>
      ) : list.length === 0 ? (
        <p className="card-hint">{t("bot.skills.none")}</p>
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
                  {s.by ? `${t(`bot.by.${s.by}` as const)} · ` : ""}
                  {day(s.updated)}
                </span>
                <button type="button" className={`btn card-del${armed === s.name ? " is-confirm" : ""}`} onClick={() => remove(s.name)} title={t("bot.skills.delete")}>
                  {armed === s.name ? t("bot.sure") : <Trash2 aria-hidden />}
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
          <Download aria-hidden /> {t("bot.skills.import")} <code>~/.claude/skills</code>
          {sources ? <ChevronDown aria-hidden /> : null}
        </button>
      </div>
      {sources && (
        <div className="card-list">
          {sources.length === 0 && <p className="card-hint">{t("bot.skills.noSources")}</p>}
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
                {have.has(s.name) ? t("bot.skills.have") : t("bot.skills.importBtn")}
              </button>
            </div>
          ))}
          <p className="card-hint">{t("bot.skills.copyHint")}</p>
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
  const { t } = useT();
  const g = groups();
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
        <span>{t("bot.set.model")}</span>
        <div className="chat-model-wrap">
          <button type="button" className="btn card-model" onClick={() => setMenu((v) => !v)} aria-haspopup="menu" aria-expanded={menu}>
            {draft.model ? modelLabel(providers, draft.model) : t("bot.set.firstModel")}
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
        <span>{t("bot.set.folders")}</span>
        {draft.folders.length === 0 && <small className="card-hint">{t("bot.set.noFolders")}</small>}
        {draft.folders.map((f) => (
          <div key={f} className="card-folder">
            <code>{f}</code>
            <button type="button" className="icon" aria-label={t("bot.set.removeFolder", { f })} onClick={() => set({ folders: draft.folders.filter((x) => x !== f) })}>
              <X size={14} aria-hidden />
            </button>
          </div>
        ))}
        <div className="card-row">
          <button type="button" className="btn" onClick={() => void addFolder()}>
            <FolderPlus aria-hidden /> {t("bot.set.addFolder")}
          </button>
        </div>
      </div>
      <div className="card-field">
        <span>{t("bot.set.tools")}</span>
        <div className="card-tools">
          {TOOL_GROUPS.map((id) => (
            <label key={id} className="card-tool">
              <input type="checkbox" checked={draft.tools[id]} onChange={(e) => set({ tools: { ...draft.tools, [id]: e.target.checked } })} />
              <span className="card-tool-text">
                <b>{g[id].label}</b>
                <small>{g[id].hint}</small>
              </span>
            </label>
          ))}
        </div>
      </div>
      {!draft.builtin && (
        <div className="card-danger">
          <span>
            {t("bot.set.trash", { dir: "bots-trash" })}
          </span>
          <button
            type="button"
            className={`btn card-del${armed ? " is-confirm" : ""}`}
            onClick={() => {
              if (!armed) return setArmed(true);
              onDelete();
            }}
          >
            <Trash2 aria-hidden /> {armed ? t("bot.set.confirmDelete") : t("bot.set.delete")}
          </button>
        </div>
      )}
    </div>
  );
}

/** Karta bota: osobowość, pamięć, skille, harmonogram i ustawienia. Osobowość i ustawienia zapisuje
 *  „Zapisz”, pamięć, skille i harmonogram zapisują się od razu (osobne pliki). */
export function BotCard({ bot, providers, offline, tab: initial, onSaved, onDeleted, onProviders, onOpenRun, onClose }: Props) {
  const { t } = useT();
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
    <Dialog label={t("bot.card.label", { name: displayName(bot) })} className="bot-card" onClose={onClose}>
      {(cancel) => (
        <>
          <header className="card-head">
            <Avatar bot={draft} size="md" />
            <div className="card-title">
              <h2>{draft.builtin ? displayName(draft) : draft.name || t("bot.persona.unnamed")}</h2>
              <small>{draft.builtin ? t("bot.card.builtin") : t("bot.card.created", { date: day(draft.created) })}</small>
            </div>
            <button type="button" className="icon" aria-label={t("bot.card.close")} onClick={cancel}>
              <X size={15} aria-hidden />
            </button>
          </header>
          <div className="seg card-tabs" role="tablist">
            {TAB_IDS.map((id) => (
              <button key={id} type="button" role="tab" aria-selected={tab === id} className={tab === id ? "is-on" : ""} onClick={() => setTab(id)}>
                {t(`bot.tab.${id}` as const)}
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
              <small>{dirty ? t("bot.card.dirty") : t("bot.card.clean")}</small>
              <span className="chat-composer-gap" />
              <button type="button" className="btn" onClick={cancel}>
                {t("bot.cancel")}
              </button>
              <button type="button" className="btn primary" disabled={!dirty || !valid || saving} onClick={() => void save(cancel)}>
                {t("bot.save")}
              </button>
            </footer>
          )}
        </>
      )}
    </Dialog>
  );
}
