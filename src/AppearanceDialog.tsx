import type { CSSProperties } from "react";
import { UI_ROWS, uiPatch, type Ui } from "./ui";
import { Dialog } from "./Dialog";

type Props = {
  ui: Ui;
  /** Zmiana widoczna od razu: App robi `setUi`, zapis idzie ze zwykłym zapisem workspace.json. */
  onSet(patch: Partial<Ui>): void;
  onClose(): void;
};

/**
 * Okno „Wygląd” (`.settings` ze wzoru D): wiersze z tabeli ustawień, akcent jako kółka
 * kolorów, reszta jako przyciski segmentowe. Kotwica: lewy dolny róg, naprzeciw stopki szyny.
 */
export function AppearanceDialog({ ui, onSet, onClose }: Props) {
  return (
    <Dialog label="Wygląd" className="settings" scrim={false} onClose={onClose}>
      {() => (
        <>
          <h2>Wygląd</h2>
          {UI_ROWS.map((row) => (
            <div className="set-row" key={row.key}>
              <span className="set-label">{row.label}</span>
              <div className="seg" role="group" aria-label={row.label}>
                {row.choices.map((choice) => {
                  const on = ui[row.key] === choice.value;
                  return choice.swatch ? (
                    <button
                      key={choice.value}
                      type="button"
                      className={`swatch${on ? " is-on" : ""}`}
                      aria-label={choice.label}
                      aria-pressed={on}
                      title={choice.label}
                      onClick={() => onSet(uiPatch(row.key, choice.value))}
                    >
                      <i style={{ background: choice.swatch } as CSSProperties} />
                    </button>
                  ) : (
                    <button
                      key={choice.value}
                      type="button"
                      className={on ? "is-on" : undefined}
                      aria-pressed={on}
                      onClick={() => onSet(uiPatch(row.key, choice.value))}
                    >
                      {choice.label}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
          <div className="set-foot">Zapisywane w workspace.json · kolory agentów w agents.json</div>
        </>
      )}
    </Dialog>
  );
}
