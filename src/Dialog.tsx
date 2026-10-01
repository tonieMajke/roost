import { useEffect, useRef, type ReactNode } from "react";
import { useT } from "./i18n/useT";

type Props = {
  /** Opis okna dla czytnika (wzór D: „Nowy panel”, „Presety”). */
  label: string;
  /** Klasa karty, np. `is-wide`. */
  className?: string;
  /** false = przezroczyste tło (popover „Wygląd”): klik poza kartą i tak zamyka. */
  scrim?: boolean;
  /** Zamyka od góry (App zdejmuje okno ze stanu). `cancel` od Dialogu zwraca fokus. */
  onClose(): void;
  /** Klawisze w karcie (np. 1–9 i strzałki w „Nowym panelu”). Esc obsługuje Dialog. */
  onKey?: (e: React.KeyboardEvent, cancel: () => void) => void;
  /** Treść karty; dostaje `cancel` = anuluj i oddaj fokus elementowi, który był przed oknem. */
  children: (cancel: () => void) => ReactNode;
};

/**
 * Nakładka ze wzoru D: `.overlay` > `.backdrop` + karta `.dialog` (animacja `pop`).
 * Esc i klik w tło anulują i oddają fokus; karta przejmuje klawiaturę przy starcie.
 */
export function Dialog({ label, className, scrim = true, onClose, onKey, children }: Props) {
  const { t } = useT();
  const box = useRef<HTMLDivElement>(null);
  // Gdzie był fokus przed oknem (zwykle terminal panelu); anulowanie go przywraca.
  // Wybór agenta celowo nie przywraca: nowy panel przejmuje fokus sam.
  const before = useRef(document.activeElement as HTMLElement | null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    box.current?.focus();
  }, []);

  const cancel = () => {
    closeRef.current();
    before.current?.focus();
  };

  return (
    <div className="overlay">
      <button
        type="button"
        className={scrim ? "backdrop" : "backdrop is-clear"}
        aria-label={t("ui2.dialog.closeWin", { label })}
        onClick={cancel}
      />
      <div
        className={className ? `dialog ${className}` : "dialog"}
        role="dialog"
        aria-modal="true"
        aria-label={label}
        tabIndex={-1}
        ref={box}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.preventDefault();
            e.stopPropagation();
            cancel();
            return;
          }
          onKey?.(e, cancel);
        }}
        onMouseDown={(e) => e.stopPropagation()}
      >
        {children(cancel)}
      </div>
    </div>
  );
}
