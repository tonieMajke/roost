import { Dialog } from "./Dialog";
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
  return (
    <Dialog label="Kontynuuj gdzie indziej" onClose={onClose}>
      {() => (
        <>
          <h2>Kontynuuj gdzie indziej</h2>
          <p>
            Otwiera nowy panel i wkleja streszczenie rozmowy „{source}” (bez Entera). Stary panel zostaje.
          </p>
          {targets.length === 0 ? (
            <p className="set-foot">Brak innego konta ani agenta. Dodaj konto w oknie „Konta”.</p>
          ) : (
            <ul className="pm-list">
              {targets.map((t) => (
                <li key={`${t.agentId}:${t.account ?? ""}`}>
                  <button type="button" className="pm-row" disabled={!canAdd} onClick={() => onPick(t)}>
                    <span className="pm-name">{t.label}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          {!canAdd && <p className="set-foot">Osiągnięto limit paneli – zamknij któryś.</p>}
        </>
      )}
    </Dialog>
  );
}
