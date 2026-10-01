import type { CSSProperties } from "react";
import { botGreeting, scheduleLabel, TOOL_GROUPS, type BotDef, type BotPreview } from "../bot";
import { Avatar } from "./Avatar";
import { GROUPS, TONES } from "./BotCard";

/** Pola `BotDef` pokazane w podglądzie (zmienione przez `bot_update` są wyróżnione). */
type Row = { key: keyof BotDef; label: string; value: string };

/** Podgląd bota w karcie zgody `bot_create` / `bot_update`: tak, jak będzie wyglądał, zamiast JSON-a. */
export function BotPreviewCard({ preview }: { preview: BotPreview }) {
  const { bot, skills = [], routines = [], changed } = preview;
  const hit = (k: keyof BotDef) => (changed?.includes(k) ? " is-changed" : "");
  const tools = TOOL_GROUPS.filter((g) => bot.tools[g]);
  const rows: Row[] = [
    { key: "persona", label: "Charakter", value: bot.persona },
    { key: "style", label: "Styl", value: bot.style },
    { key: "avoid", label: "Unika", value: bot.avoid },
    { key: "tone", label: "Ton", value: TONES.find((t) => t.id === bot.tone)?.label ?? bot.tone },
    { key: "model", label: "Model", value: bot.model ? bot.model.model : "pierwszy z listy" },
  ];
  return (
    <div className="bot-preview" style={{ "--bot": bot.color } as CSSProperties}>
      <div className={`bot-preview-head${hit("name") || hit("avatar") || hit("color")}`}>
        <Avatar bot={bot} size="md" />
        <div className="bot-preview-who">
          <b>{bot.name}</b>
          <span>„{botGreeting(bot)}”</span>
        </div>
      </div>
      <dl className="bot-preview-rows">
        {rows
          .filter((r) => r.value.trim() || changed?.includes(r.key))
          .map((r) => (
            <div key={r.key} className={`bot-preview-row${hit(r.key)}`}>
              <dt>{r.label}</dt>
              <dd>{r.value || "—"}</dd>
            </div>
          ))}
        <div className={`bot-preview-row${hit("tools")}`}>
          <dt>Narzędzia</dt>
          <dd className="bot-preview-chips">
            {tools.length ? tools.map((g) => <span key={g}>{GROUPS[g].label}</span>) : <em>bez narzędzi – tylko rozmowa</em>}
          </dd>
        </div>
        {(bot.folders.length > 0 || changed?.includes("folders")) && (
          <div className={`bot-preview-row${hit("folders")}`}>
            <dt>Foldery</dt>
            <dd>{bot.folders.length ? bot.folders.map((f) => <code key={f}>{f}</code>) : "—"}</dd>
          </div>
        )}
        {skills.length > 0 && (
          <div className="bot-preview-row">
            <dt>Skille</dt>
            <dd className="bot-preview-list">
              {skills.map((s) => (
                <span key={s.name}>
                  <code>{s.name}</code> {s.description}
                </span>
              ))}
            </dd>
          </div>
        )}
        {routines.length > 0 && (
          <div className="bot-preview-row">
            <dt>Harmonogram</dt>
            <dd className="bot-preview-list">
              {routines.map((r, i) => (
                <span key={i}>
                  {r.name} · <b>{scheduleLabel(r.schedule)}</b>
                </span>
              ))}
              <small>Zadania powstaną wyłączone – włączysz je w karcie bota.</small>
            </dd>
          </div>
        )}
      </dl>
    </div>
  );
}
