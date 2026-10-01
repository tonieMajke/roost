import type { CSSProperties } from "react";
import { useT } from "../i18n/useT";
import { botGreeting, displayName, scheduleLabel, TOOL_GROUPS, type BotDef, type BotPreview } from "../bot";
import { Avatar } from "./Avatar";
import { groups, tones } from "./BotCard";

/** Pola `BotDef` pokazane w podglądzie (zmienione przez `bot_update` są wyróżnione). */
type Row = { key: keyof BotDef; label: string; value: string };

/** Podgląd bota w karcie zgody `bot_create` / `bot_update`: tak, jak będzie wyglądał, zamiast JSON-a. */
export function BotPreviewCard({ preview }: { preview: BotPreview }) {
  const { t } = useT();
  const { bot, skills = [], routines = [], changed } = preview;
  const hit = (k: keyof BotDef) => (changed?.includes(k) ? " is-changed" : "");
  const tools = TOOL_GROUPS.filter((g) => bot.tools[g]);
  const rows: Row[] = [
    { key: "persona", label: t("bot.prev.persona"), value: bot.persona },
    { key: "style", label: t("bot.prev.style"), value: bot.style },
    { key: "avoid", label: t("bot.prev.avoid"), value: bot.avoid },
    { key: "tone", label: t("bot.prev.tone"), value: tones().find((x) => x.id === bot.tone)?.label ?? bot.tone },
    { key: "model", label: t("bot.prev.model"), value: bot.model ? bot.model.model : t("bot.prev.firstModel") },
  ];
  return (
    <div className="bot-preview" style={{ "--bot": bot.color } as CSSProperties}>
      <div className={`bot-preview-head${hit("name") || hit("avatar") || hit("color")}`}>
        <Avatar bot={bot} size="md" />
        <div className="bot-preview-who">
          <b>{displayName(bot)}</b>
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
          <dt>{t("bot.prev.tools")}</dt>
          <dd className="bot-preview-chips">
            {tools.length ? tools.map((g) => <span key={g}>{groups()[g].label}</span>) : <em>{t("bot.prev.noTools")}</em>}
          </dd>
        </div>
        {(bot.folders.length > 0 || changed?.includes("folders")) && (
          <div className={`bot-preview-row${hit("folders")}`}>
            <dt>{t("bot.prev.folders")}</dt>
            <dd>{bot.folders.length ? bot.folders.map((f) => <code key={f}>{f}</code>) : "—"}</dd>
          </div>
        )}
        {skills.length > 0 && (
          <div className="bot-preview-row">
            <dt>{t("bot.prev.skills")}</dt>
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
            <dt>{t("bot.prev.routines")}</dt>
            <dd className="bot-preview-list">
              {routines.map((r, i) => (
                <span key={i}>
                  {r.name} · <b>{scheduleLabel(r.schedule)}</b>
                </span>
              ))}
              <small>{t("bot.prev.routinesOff")}</small>
            </dd>
          </div>
        )}
      </dl>
    </div>
  );
}
