import { useEffect, useMemo, useRef, useState, type CSSProperties, type DragEvent, type ReactNode } from "react";
import { GripVertical, RotateCw, Search, X } from "lucide-react";
import { agentColor, type AgentDef } from "./agents";
import { paneMeter, type SessionContext } from "./context";
import { FEED_CLOCK_MS, feedFor, relativeTime, type FeedItem } from "./feed";
import { limitBlocks, type ClaudeLimits } from "./limits";
import type { Project } from "./workspace";
import { IconButton } from "./IconButton";
import { Radar } from "./Radar";
import { blips, type BlipInput } from "./radar-model";
import { paneStatus, type PaneState } from "./activity";
import { filterBoard, idlePaneIds, type BoardRow } from "./board";
import { moveSection, stepSection, type DockSection } from "./dockOrder";
import { CONFIRM_MS, confirmClick, isArmed, type Arm } from "./confirm";
import { useT } from "./i18n/useT";

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
  /** Kolejność sekcji i jej zmiana (przeciągnięcie za uchwyt albo Alt+↑/↓ na uchwycie). */
  order: DockSection[];
  onOrder: (order: DockSection[]) => void;
  onClose: () => void;
  /** Sekcja „Panele”: wszystkie projekty, stan ulotny paneli i zamknięcie wielu naraz („Close idle”). */
  projects: Project[];
  state: Record<string, PaneState>;
  onCloseIdle: (paneIds: string[]) => void;
  /** Motyw „Wieża”: radar paneli na górze pulpitu (cisza z `activity.ts`). */
  radar?: { quietMs: (paneId: string) => number | null; state: Record<string, PaneState> };
};

/** Pulpit po prawej (wzór D `.dock`): limity Claude (etap 10), kontekst, na żywo (etap 9). */
export function Dock({ project, agents, contexts, titles, onPickPane, feed, onPickFeed, feedScope, onFeedScope, limits, limitSources, onRefreshLimits, order, onOrder, onClose, projects, state, onCloseIdle, radar }: Props) {
  const { t } = useT();
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

  // Sekcja „Panele”: szukanie po tytule, agencie, projekcie, branchu i ostatniej wiadomości.
  const [query, setQuery] = useState("");
  const [armed, setArmed] = useState(false);
  const armRef = useRef<Arm>(null);
  const board = useMemo(() => {
    const lastMessage = new Map<string, string>();
    for (const item of feed) if (!lastMessage.has(item.paneId)) lastMessage.set(item.paneId, item.text); // najnowsze pierwsze
    return projects.flatMap((p) =>
      p.panes.map((pane): BoardRow => {
        const name = agents.find((a) => a.id === pane.agentId)?.name ?? pane.agentId;
        return {
          paneId: pane.id,
          projectId: p.id,
          title: titles[pane.id] ?? name,
          agent: name,
          project: p.name,
          lastMessage: lastMessage.get(pane.id),
          state: state[pane.id] ?? {},
        };
      }),
    );
  }, [projects, agents, titles, feed, state]);
  const visible = useMemo(() => filterBoard(board, query), [board, query]);
  const idleIds = useMemo(() => idlePaneIds(visible), [visible]);
  const idleKey = `idle:${idleIds.join(",")}`;
  // „Zamknąć N?” trwa CONFIRM_MS albo do zmiany zbioru bezczynnych.
  useEffect(() => {
    if (!armed) return;
    const timer = setTimeout(() => setArmed(false), CONFIRM_MS);
    return () => clearTimeout(timer);
  }, [armed, idleKey]);
  useEffect(() => {
    if (armed && !isArmed(armRef.current, idleKey, Date.now())) setArmed(false);
  }, [armed, idleKey]);
  const closeIdle = () => {
    const r = confirmClick(armRef.current, idleKey, Date.now());
    armRef.current = r.arm;
    if (r.fire) {
      setArmed(false);
      onCloseIdle(idleIds);
    } else setArmed(true);
  };

  const radarBlips = radar
    ? blips(
        (project?.panes ?? []).map((pane): BlipInput => {
          const agent = agents.find((a) => a.id === pane.agentId);
          const st = radar.state[pane.id];
          return {
            id: pane.id,
            agentName: agent?.name ?? pane.agentId,
            color: agentColor(agent),
            quietMs: radar.quietMs(pane.id),
            level: paneMeter(pane, agent, contexts)?.pct ?? null,
            working: st?.working === true,
            done: st?.done === true || st?.exited !== undefined,
          };
        }),
      )
    : null;

  // Zmiana kolejności: przeciąganie za uchwyt (znacznik przed/za sekcją pod kursorem) i Alt+↑/↓ na uchwycie.
  const [dragId, setDragId] = useState<DockSection | null>(null);
  const [over, setOver] = useState<{ id: DockSection; place: "before" | "after" } | null>(null);
  const secProps = (id: DockSection, cls: string) => ({
    className: `${cls} dock-sec-ord${dragId === id ? " is-dragging" : ""}${over?.id === id ? ` is-over-${over.place}` : ""}`,
    onDragOver: (e: DragEvent<HTMLElement>) => {
      if (dragId === null || dragId === id) return;
      e.preventDefault();
      const r = e.currentTarget.getBoundingClientRect();
      const place = e.clientY < r.top + r.height / 2 ? "before" : "after";
      if (over?.id !== id || over.place !== place) setOver({ id, place });
    },
    onDrop: (e: DragEvent<HTMLElement>) => {
      e.preventDefault();
      if (dragId !== null && over !== null) onOrder(moveSection(order, dragId, over.id, over.place));
      setDragId(null);
      setOver(null);
    },
  });
  const grip = (id: DockSection) => (
    <button
      type="button"
      className="dock-grip"
      draggable
      aria-label={t("ui2.dock.grip")}
      title={t("ui2.dock.gripTip")}
      onDragStart={(e) => {
        e.dataTransfer.effectAllowed = "move";
        e.dataTransfer.setData("text/plain", id);
        const sec = e.currentTarget.closest("section");
        if (sec) e.dataTransfer.setDragImage(sec, 12, 12);
        setDragId(id);
      }}
      onDragEnd={() => {
        setDragId(null);
        setOver(null);
      }}
      onKeyDown={(e) => {
        if (!e.altKey || (e.key !== "ArrowUp" && e.key !== "ArrowDown")) return;
        e.preventDefault();
        onOrder(stepSection(order, id, e.key === "ArrowUp" ? -1 : 1));
      }}
    >
      <GripVertical size={13} aria-hidden />
    </button>
  );

  const sections: Record<DockSection, ReactNode> = {
    board: (
        <section key="board" {...secProps("board", "dock-sec dock-board")}>
          {grip("board")}
          <h3>
            {t("ui2.dock.panes")}
            <span>{query.trim() ? t("ui2.dock.count", { shown: visible.length, total: board.length }) : board.length}</span>
          </h3>
          <label className="board-search">
            <Search size={13} aria-hidden />
            <input
              type="search"
              className="pm-input"
              placeholder={t("ui2.dock.searchPh")}
              aria-label={t("ui2.dock.searchAria")}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Escape" && query !== "") {
                  e.preventDefault();
                  e.stopPropagation();
                  setQuery("");
                }
              }}
            />
          </label>
          <button
            type="button"
            className={`board-idle${armed ? " is-armed" : ""}`}
            disabled={idleIds.length === 0}
            onClick={closeIdle}
            title={t("ui2.dock.idleTip")}
          >
            {armed ? t("ui2.dock.idleConfirm", { n: idleIds.length }) : t("ui2.dock.idle", { n: idleIds.length })}
          </button>
          {board.length === 0 && <span className="meter-note">{t("ui2.dock.noPanes")}</span>}
          {board.length > 0 && visible.length === 0 && <span className="meter-note">{t("ui2.dock.noMatch")}</span>}
          {visible.map((r) => {
            const agent = agents.find((a) => a.name === r.agent || a.id === r.agent);
            const st = paneStatus(r.state);
            return (
              <button
                type="button"
                key={r.paneId}
                className="ctx-row board-row"
                data-ag={agent?.id}
                style={{ "--ag": agentColor(agent) } as CSSProperties}
                title={[r.title, `${r.agent} · ${r.project}`, r.lastMessage].filter(Boolean).join("\n")}
                onClick={() => onPickPane(r.paneId)}
              >
                <span className="ag-badge" aria-hidden>
                  {r.agent.charAt(0).toUpperCase()}
                </span>
                <div className="ctx-main">
                  <div className="ctx-line">
                    <span>{r.title}</span>
                    <b className={st.cls}>{st.text}</b>
                  </div>
                  <span className="meter-note board-sub">{[r.project, r.lastMessage].filter(Boolean).join(" · ")}</span>
                </div>
              </button>
            );
          })}
        </section>
    ),
    limits: (
        <section key="limits" {...secProps("limits", "dock-sec")}>
          {grip("limits")}
          <h3>
            {t("ui2.dock.limits")}
            <span className="dock-h3-end">
              {newest > 0 && <span>{t("ui2.dock.statusLine", { when: relativeTime(newest * 1000, now) })}</span>}
              <IconButton icon={RotateCw} label={t("ui2.dock.refreshLimits")} className="dock-refresh" onClick={onRefreshLimits} />
            </span>
          </h3>
          {blocks.length === 0 && (
            <span className="meter-note">{t("ui2.dock.noLimits")}</span>
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
    ),
    context: (
        <section key="context" {...secProps("context", "dock-sec")}>
          {grip("context")}
          <h3>
            {t("ui2.dock.context")} <span>{project?.name}</span>
          </h3>
          {rows.length === 0 && <span className="meter-note">{t("ui2.dock.noCtx")}</span>}
          {rows.map(({ pane, agent, meter, model }) => {
            const name = agent?.name ?? pane.agentId;
            return (
              <button
                type="button"
                key={pane.id}
                className={`ctx-row${meter.warn ? " is-warn" : ""}`}
                data-ag={pane.agentId}
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
    ),
    live: (
        <section key="live" {...secProps("live", "dock-sec dock-live")}>
          {grip("live")}
          <h3>
            {t("ui2.dock.live")}
            <span className="seg dock-seg" role="group" aria-label={t("ui2.dock.liveAria")}>
              {(
                [
                  ["project", t("ui2.dock.thisProject")],
                  ["all", t("ui2.dock.all")],
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
              {feedScope === "all" || feed.length === 0 ? t("ui2.dock.nothingYet") : t("ui2.dock.nothingHere")}
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
                  data-ag={item.agentId}
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
    ),
  };

  return (
    <aside className="dock">
      <div className="dock-head">
        <span className="dock-title">{t("ui2.dock.title")}</span>
        <IconButton icon={X} label={t("ui2.dock.close")} shortcut="Ctrl+Alt+D" onClick={onClose} />
      </div>
      {radarBlips && (
        <section className="dock-sec dock-radar">
          <h3>
            {t("ui2.dock.radar")} <span>{project?.name}</span>
          </h3>
          <Radar blips={radarBlips} onPick={onPickPane} />
          <span className="meter-note">{t("ui2.dock.radarNote")}</span>
        </section>
      )}
      {order.map((id) => sections[id])}
    </aside>
  );
}
