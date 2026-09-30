import type { CSSProperties } from "react";
import { X } from "lucide-react";
import { agentColor, type AgentDef } from "./agents";
import { paneMeter, type SessionContext } from "./context";
import type { Project } from "./workspace";
import { IconButton } from "./IconButton";

type Props = {
  project: Project | null; // aktywny: sekcja „Kontekst” pokazuje jego panele
  agents: AgentDef[];
  contexts: Record<string, SessionContext>;
  onClose: () => void;
};

/** Pulpit po prawej (wzór D `.dock`): limity Claude (etap 10), kontekst, na żywo (etap 9). */
export function Dock({ project, agents, contexts, onClose }: Props) {
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
        <h3>Limity Claude</h3>
        <span className="meter-note">wkrótce</span>
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
        <span className="meter-note">wkrótce</span>
      </section>
    </aside>
  );
}
