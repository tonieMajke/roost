import { useEffect, useState, type CSSProperties } from "react";
import { RotateCw, X } from "lucide-react";
import { agentColor, type AgentDef } from "./agents";
import { paneMeter, type SessionContext } from "./context";
import { FEED_CLOCK_MS, relativeTime, type FeedItem } from "./feed";
import { limitMeters, type ClaudeLimits } from "./limits";
import type { Project } from "./workspace";
import { IconButton } from "./IconButton";

type Props = {
  project: Project | null; // aktywny: sekcja „Kontekst” pokazuje jego panele
  agents: AgentDef[];
  contexts: Record<string, SessionContext>;
  feed: FeedItem[]; // wszystkie projekty, najnowsze pierwsze
  onPickFeed: (item: FeedItem) => void;
  limits: ClaudeLimits | null; // z linii statusu paneli claude
  onRefreshLimits: () => void;
  onClose: () => void;
};

/** Pulpit po prawej (wzór D `.dock`): limity Claude (etap 10), kontekst, na żywo (etap 9). */
export function Dock({ project, agents, contexts, feed, onPickFeed, limits, onRefreshLimits, onClose }: Props) {
  // „40 s temu” musi się starzeć także bez nowych zdarzeń.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), FEED_CLOCK_MS);
    return () => clearInterval(timer);
  }, [feed, limits]);
  const meters = limitMeters(limits, now);

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
            {limits && <span>{`linia statusu · ${relativeTime(limits.at * 1000, now)}`}</span>}
            <IconButton icon={RotateCw} label="Odśwież limity" className="dock-refresh" onClick={onRefreshLimits} />
          </span>
        </h3>
        {meters.length === 0 && (
          <span className="meter-note">Brak danych: pojawią się po odpowiedzi claude w panelu (subskrypcja)</span>
        )}
        {meters.map((m) => (
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
      </section>
      <section className="dock-sec">
        <h3>
          Kontekst <span>{project?.name}</span>
        </h3>
        {rows.length === 0 && <span className="meter-note">Brak paneli z claude albo pi</span>}
        {rows.map(({ pane, agent, meter, model }) => {
          const name = agent?.name ?? pane.agentId;
          return (
            <div
              key={pane.id}
              className={`ctx-row${meter.warn ? " is-warn" : ""}`}
              style={{ "--ag": agentColor(agent) } as CSSProperties}
              title={model ?? undefined}
            >
              <span className="ag-badge" aria-hidden>
                {name.charAt(0).toUpperCase()}
              </span>
              <div className="ctx-main">
                <div className="ctx-line">
                  <span>{name}</span>
                  <b>
                    {meter.used} / {meter.limit}
                  </b>
                </div>
                <div className="bar">
                  <span style={{ width: `${meter.pct}%` }} />
                </div>
              </div>
            </div>
          );
        })}
      </section>
      <section className="dock-sec dock-live">
        <h3>
          Na żywo <span>wszystkie projekty</span>
        </h3>
        {feed.length === 0 && <span className="meter-note">Jeszcze nic się nie wydarzyło</span>}
        <div className="feed">
          {feed.map((item) => {
            const agent = agents.find((a) => a.id === item.agentId);
            const name = agent?.name ?? item.agentId;
            return (
              <button
                type="button"
                key={item.id}
                className="feed-item"
                style={{ "--ag": agentColor(agent) } as CSSProperties}
                title={`${name}: ${item.text}`}
                onClick={() => onPickFeed(item)}
              >
                <span className="ag-badge" aria-hidden>
                  {name.charAt(0).toUpperCase()}
                </span>
                <span className="feed-text">
                  <span>{item.text}</span>
                  <small>
                    {item.project} · {relativeTime(item.at, now)}
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
