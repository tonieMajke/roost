import { useState, type CSSProperties } from "react";
import { agentColor, agentModels, type AgentDef } from "./agents";
import { accountKind, accountsFor, pickAccountId, type Accounts } from "./accounts";
import { Dialog } from "./Dialog";
import { useT } from "./i18n/useT";
import { dialogKey, stepModel, tileDelayMs } from "./new-pane";

type Props = {
  projectName: string;
  agents: AgentDef[];
  accounts: Accounts;
  /** Zaznaczony na starcie: ostatnio użyty agent (stan ulotny, nie plik). */
  startIndex: number;
  /** `model`: id wybranego modelu (`--model`), `undefined` = domyślny agenta. */
  onPick(index: number, model?: string, account?: string): void;
  onClose(): void;
};

/** Okno „Nowy panel” (wzór D): kafelki agentów, 1–9 / strzałki / Enter / Esc; ←/→ model. */
export function NewPaneDialog({ projectName, agents, accounts, startIndex, onPick, onClose }: Props) {
  const { t } = useT();
  const [index, setIndex] = useState(Math.min(Math.max(startIndex, 0), Math.max(agents.length - 1, 0)));
  // Model dotyczy zaznaczonego agenta; zmiana agenta wraca do domyślnego.
  const [model, setModel] = useState<string | undefined>(undefined);
  // Konto: `null` = nie ruszano (domyślne konto rodzaju), `""` = własny folder agenta, inaczej id.
  const [account, setAccount] = useState<string | null>(null);
  const selected = agents[index];
  const kind = accountKind(selected);
  const accountList = accountsFor(accounts, kind);
  const accountId = pickAccountId(accounts, kind, account);
  const models = selected ? agentModels(selected) : [];
  const select = (i: number) => {
    if (i !== index) {
      setModel(undefined);
      setAccount(null);
    }
    setIndex(i);
  };
  // Model tylko dla agenta, dla którego go wybrano (cyfra może wskazać innego).
  const pick = (i: number) => {
    const k = accountKind(agents[i]);
    onPick(i, i === index ? model : undefined, i === index ? accountId : pickAccountId(accounts, k, null));
  };

  return (
    <Dialog label={t("ui2.np.title", { name: projectName })} onClose={onClose} onKey={(e, cancel) => {
      const action = dialogKey(e.key, index, agents.length);
      if (!action) return;
      e.preventDefault();
      if (action.type === "close") cancel();
      else if (action.type === "move") select(action.index);
      else if (action.type === "model") setModel(stepModel(models.map((m) => m.id), model, action.delta));
      else pick(action.index);
    }}>
      {(cancel) => (
        <>
          <h2>{t("ui2.np.title", { name: projectName })}</h2>
          <p>{t("ui2.np.desc")}</p>
          {agents.length === 0 ? (
            <p className="tile-cmd">{t("ui2.np.noAgents")}</p>
          ) : (
            <div className="tiles">
              {agents.map((agent, i) => (
                <button
                  key={agent.id}
                  type="button"
                  className={`tile${i === index ? " is-active" : ""}`}
                  // opóźnienie wjazdu kafelka (80 + 55·i ms) i kolor agenta dla ramki
                  style={{ "--ag": agentColor(agent), animationDelay: `${tileDelayMs(i)}ms` } as CSSProperties}
                  onClick={() => pick(i)}
                >
                  <span className="tile-top">
                    <span className="ag-badge" aria-hidden>
                      {agent.name.charAt(0).toUpperCase()}
                    </span>
                    <kbd>{i < 9 ? i + 1 : ""}</kbd>
                  </span>
                  <span className="tile-name">{agent.name}</span>
                  <span className="tile-cmd">{agent.command}</span>
                </button>
              ))}
            </div>
          )}
          {selected && models.length > 0 && (
            <div
              className="models"
              role="radiogroup"
              aria-label={t("ui2.np.modelAria", { name: selected.name })}
              style={{ "--ag": agentColor(selected) } as CSSProperties}
            >
              <span className="models-label">{t("ui2.np.model")}</span>
              {[{ id: undefined, name: t("ui2.np.defaultM") }, ...models].map((m) => (
                <button
                  key={m.id ?? ""}
                  type="button"
                  role="radio"
                  aria-checked={m.id === model}
                  className={`model-chip${m.id === model ? " is-active" : ""}`}
                  onClick={() => setModel(m.id)}
                >
                  {m.name}
                </button>
              ))}
            </div>
          )}
          {selected && accountList.length > 0 && (
            <div
              className="models"
              role="radiogroup"
              aria-label={t("ui2.np.accountAria", { name: selected.name })}
              style={{ "--ag": agentColor(selected) } as CSSProperties}
            >
              <span className="models-label">{t("ui2.np.account")}</span>
              {[{ id: "", name: t("ui2.np.defaultA") }, ...accountList].map((a) => (
                <button
                  key={a.id}
                  type="button"
                  role="radio"
                  aria-checked={(accountId ?? "") === a.id}
                  className={`model-chip${(accountId ?? "") === a.id ? " is-active" : ""}`}
                  onClick={() => setAccount(a.id)}
                >
                  {a.name}
                </button>
              ))}
            </div>
          )}
          <div className="dialog-foot">
            <span>
              <kbd>1</kbd>–<kbd>{Math.min(agents.length, 9)}</kbd> {t("ui2.np.hintPick")}
            </span>
            <span>
              <kbd>↑</kbd>
              <kbd>↓</kbd> {t("ui2.np.hintMove")}
            </span>
            {models.length > 0 && (
              <span>
                <kbd>←</kbd>
                <kbd>→</kbd> {t("ui2.np.hintModel")}
              </span>
            )}
            <span>
              <kbd>Esc</kbd> {t("ui2.preset.hintClose")}
            </span>
          </div>
        </>
      )}
    </Dialog>
  );
}
