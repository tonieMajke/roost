import type { CSSProperties } from "react";
import { uiPatch, type Ui, type UiRow } from "./ui";

type Props = {
  row: UiRow;
  ui: Ui;
  onSet(patch: Partial<Ui>): void;
};

/** Jeden wiersz ustawień wyglądu (etykieta + kafelki motywu, kółka akcentu albo przyciski segmentowe).
 *  Wspólny dla okna „Wygląd” i okna pierwszego uruchomienia. */
export function UiRowControl({ row, ui, onSet }: Props) {
  return (
    <div className="set-row">
      <span className="set-label">{row.label}</span>
      <div className={row.key === "theme" ? "themes" : "seg"} role="group" aria-label={row.label}>
        {row.choices.map((choice) => {
          const on = ui[row.key] === choice.value;
          if (choice.theme) {
            const [bg, pane, text] = choice.theme.colors;
            return (
              <button
                key={choice.value}
                type="button"
                className={`theme-tile${on ? " is-on" : ""}`}
                aria-pressed={on}
                title={choice.label}
                onClick={() => onSet(uiPatch(row.key, choice.value))}
              >
                <span className="theme-chip" style={{ background: bg } as CSSProperties} aria-hidden>
                  <i style={{ background: pane, color: text } as CSSProperties}>Aa</i>
                  <b style={{ background: choice.theme.accent } as CSSProperties} />
                </span>
                <span className="theme-name">{choice.label}</span>
              </button>
            );
          }
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
  );
}
