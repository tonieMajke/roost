import { uiRows, type Ui } from "./ui";
import { UiRowControl } from "./UiRowControl";
import { Dialog } from "./Dialog";
import { useT } from "./i18n/useT";

type Props = {
  ui: Ui;
  /** Zmiana widoczna od razu: App robi `setUi`, zapis idzie ze zwykłym zapisem workspace.json. */
  onSet(patch: Partial<Ui>): void;
  onClose(): void;
};

/**
 * Okno „Wygląd” (`.settings` ze wzoru D): wiersze z tabeli ustawień, motyw jako kafelki
 * z próbką (tło, panel, tekst, akcent), akcent jako kółka kolorów, reszta jako przyciski segmentowe. Kotwica: lewy dolny róg, naprzeciw stopki szyny.
 */
export function AppearanceDialog({ ui, onSet, onClose }: Props) {
  const { t } = useT();
  return (
    <Dialog label={t("ui.title")} className="settings" scrim={false} onClose={onClose}>
      {() => (
        <>
          <h2>{t("ui.title")}</h2>
          {uiRows().map((row) => (
            <UiRowControl key={row.key} row={row} ui={ui} onSet={onSet} />
          ))}
          <div className="set-foot">{t("ui.foot")}</div>
        </>
      )}
    </Dialog>
  );
}
