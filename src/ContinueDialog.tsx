import { Dialog } from "./Dialog";
import { useT } from "./i18n";
import type { ContinueTarget } from "./continue";

type Props = {
  /** Nazwa agenta i projektu źródła, np. „Claude · agents”. */
  source: string;
  targets: ContinueTarget[];
  /** false = brak miejsca na kolejny panel (limit `MAX_PANES`). */
  canAdd: boolean;
  onPick(target: ContinueTarget): void;
  onClose(): void;
};

/** Okno „Kontynuuj gdzie indziej”: lista celów; wybór otwiera nowy panel ze streszczeniem rozmowy. */
export function ContinueDialog({ source, targets, canAdd, onPick, onClose }: Props) {
  const { t } = useT();
  return (
    <Dialog label={t("ui2.cont.title")} onClose={onClose}>
      {() => (
        <>
          <h2>{t("ui2.cont.title")}</h2>
          <p>{t("ui2.cont.desc", { source })}</p>
          {targets.length === 0 ? (
            <p className="set-foot">{t("ui2.cont.none")}</p>
          ) : (
            <ul className="pm-list">
              {targets.map((target) => (
                <li key={`${target.agentId}:${target.account ?? ""}`}>
                  <button type="button" className="pm-row" disabled={!canAdd} onClick={() => onPick(target)}>
                    <span className="pm-name">{target.label}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          {!canAdd && <p className="set-foot">{t("ui2.cont.limit")}</p>}
        </>
      )}
    </Dialog>
  );
}
