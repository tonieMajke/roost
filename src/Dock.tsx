import { useEffect, useState, type CSSProperties } from "react";
import { RotateCw, X } from "lucide-react";
import { agentColor, type AgentDef } from "./agents";
import { paneMeter, type SessionContext } from "./context";
import { FEED_CLOCK_MS, feedFor, relativeTime, type FeedItem } from "./feed";
import { limitBlocks, type ClaudeLimits } from "./limits";
import type { Project } from "./workspace";
import { IconButton } from "./IconButton";

type Props = {
  project: Project | null; // aktywny: sekcja „Kontekst” pokazuje jego panele
  agents: AgentDef[];
  contexts: Record<string, SessionContext>;
  titles: Record<string, string>; // paneId → tytuł rozmowy (sessionTitles)
  onPickPane: (paneId: string) => void;
  feed: FeedItem[]; // wszystkie projekty, najnowsze pierwsze
  onPickFeed: (item: FeedItem) => void;
  feedScope: "all" | "project"; // ui.feed
  onFeedScope: (scope: "all" | "project") => void;
  /** Z linii statusu paneli claude, według id konta (`""` = domyślne). */
  limits: Record<string, ClaudeLimits>;
  /** Konta, których limity pokazujemy, w kolejności wyświetlania. */
  limitSources: { id: string; name: string }[];
  onRefreshLimits: () => void;
  onClose: () => void;
};

/** Pulpit po prawej (wzór D `.dock`): limity Claude (etap 10), kontekst, na żywo (etap 9). */
export function Dock({ project, agents, contexts, titles, onPickPane, feed, onPickFeed, feedScope, onFeedScope, limits, limitSources, onRefreshLimits, onClose }: Props) {
  // „40 s temu” musi się starzeć także bez nowych zdarzeń.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), FEED_CLOCK_MS);
    return () => clearInterval(timer);
  }, [feed, limits]);
  const blocks = limitBlocks(limitSources, limits, now);
  const newest = Math.max(0, ...blocks.map((b) => b.limits.at));
  const shown = feedFor(feed, feedScope, project?.id ?? null);

  const rows = (project?.panes ?? []).flatMap((pane) => {
    const agent = agents.find((a) => a.id === pane.agentId);
    const meter = paneMeter(pane, agent, contexts);
    if (meter === null) return [];
    const model = pane.sessionId ? contexts[pane.sessionId]?.model : null;
    return [{ pane, agent, meter, model }];
  });

  return (
    <aside className="dock">
      <div className="dock-head">
        <span className="dock-title">Pulpit</span>
        <IconButton icon={X} label="Zamknij pulpit" shortcut="Ctrl+Alt+D" onClick={onClose} />
      </div>
      <section className="dock-sec">
        <h3>
          Limity Claude
          <span className="dock-h3-end">
            {newest > 0 && <span>{`linia statusu · ${relativeTime(newest * 1000, now)}`}</span>}
            <IconButton icon={RotateCw} label="Odśwież limity" className="dock-refresh" onClick={onRefreshLimits} />
          </span>
        </h3>
        {blocks.length === 0 && (
          <span className="meter-note">Brak danych: pojawią się po odpowiedzi claude w panelu (subskrypcja)</span>
        )}
        {blocks.map((block) => (
          <div key={block.id} className="meter-block">
            {limitSources.length > 1 && <span className="meter-account">{block.name}</span>}
            {block.meters.map((m) => (
              <div key={m.label} className="meter">
                <div className="meter-top">
                  <span>{m.label}</span>
                  <b>{m.pct}%</b>
                </div>
                <div className="bar">
                  <span style={{ width: `${Math.min(100, m.pct)}%` }} />
                </div>
                <span className="meter-note">{m.note}</span>
              </div>
            ))}
          </div>
        ))}
      </section>
      <section className="dock-sec">
        <h3>
          Kontekst <span>{project?.name}</span>
        </h3>
        {rows.length === 0 && <span className="meter-note">Brak paneli z claude albo pi</span>}
        {rows.map(({ pane, agent, meter, model }) => {
          const name = agent?.name ?? pane.agentId;
          return (
            <button
              type="button"
              key={pane.id}
              className={`ctx-row${meter.warn ? " is-warn" : ""}`}
              style={{ "--ag": agentColor(agent) } as CSSProperties}
              title={[titles[pane.id], name, model].filter(Boolean).join(" · ")}
              onClick={() => onPickPane(pane.id)}
            >
              <span className="ag-badge" aria-hidden>
                {name.charAt(0).toUpperCase()}
              </span>
              <div className="ctx-main">
                <div className="ctx-line">
                  <span>{titles[pane.id] ?? name}</span>
                  <b>
                    {meter.used} / {meter.limit}
                  </b>
                </div>
                <div className="bar">
                  <span style={{ width: `${meter.pct}%` }} />
                </div>
              </div>
            </button>
          );
        })}
      </section>
      <section className="dock-sec dock-live">
        <h3>
          Na żywo
          <span className="seg dock-seg" role="group" aria-label="Zdarzenia z projektów">
            {(
              [
                ["project", "Ten projekt"],
                ["all", "Wszystkie"],
              ] as const
            ).map(([scope, label]) => (
              <button
                key={scope}
                type="button"
                className={feedScope === scope ? "is-on" : undefined}
                aria-pressed={feedScope === scope}
                onClick={() => onFeedScope(scope)}
              >
                {label}
              </button>
            ))}
          </span>
        </h3>
        {shown.length === 0 && (
          <span className="meter-note">
            {feedScope === "all" || feed.length === 0 ? "Jeszcze nic się nie wydarzyło" : "Nic w tym projekcie"}
          </span>
        )}
        <div className="feed">
          {shown.map((item) => {
            const agent = agents.find((a) => a.id === item.agentId);
            const name = agent?.name ?? item.agentId;
            return (
              <button
                type="button"
                key={item.id}
                className="feed-item"
                style={{ "--ag": agentColor(agent) } as CSSProperties}
                title={[titles[item.paneId], `${name}: ${item.text}`].filter(Boolean).join("\n")}
                onClick={() => onPickFeed(item)}
              >
                <span className="ag-badge" aria-hidden>
                  {name.charAt(0).toUpperCase()}
                </span>
                <span className="feed-text">
                  <span>{item.text}</span>
                  <small>
                    {titles[item.paneId] && <span className="feed-title">{titles[item.paneId]}</span>}
                    <span>
                      {titles[item.paneId] && "· "}
                      {feedScope === "all" && `${item.project} · `}
                    {relativeTime(item.at, now)}
                    </span>
                  </small>
                </span>
              </button>
            );
          })}
        </div>
      </section>
    </aside>
  );
}
