import { useEffect, useMemo, useState } from "react";
import type { AgentDef } from "./agents";
import { backend } from "./backend";
import { Dialog } from "./Dialog";
import { agentRows, presetChoices } from "./firstrun";
import { useT } from "./i18n/useT";
import { BUILT_IN_PRESETS } from "./presets";
import { UiRowControl } from "./UiRowControl";
import { uiRows, type Ui } from "./ui";

type Props = {
  agents: AgentDef[];
  ui: Ui;
  onSet(patch: Partial<Ui>): void;
  /** `path` = folder wybrany w oknie (bezwzględny), `agentIds` = panele do dodania (może być pusta). */
  onStart(path: string, agentIds: string[]): void;
  onClose(): void;
};

/** Okno pierwszego uruchomienia (brak `workspace.json`): język i motyw, stan agentów w PATH, pierwszy projekt. */
export function FirstRunDialog({ agents, ui, onSet, onStart, onClose }: Props) {
  const { t } = useT();
  const [available, setAvailable] = useState<Record<string, boolean> | null>(null);
  const [folder, setFolder] = useState<string | null>(null);
  const [pickError, setPickError] = useState<string | null>(null);
  const [presetIdx, setPresetIdx] = useState(0);

  const check = () => {
    setAvailable(null);
    backend
      .commandsAvailable(agents.map((a) => a.command))
      .then(setAvailable)
      .catch(() => setAvailable({}));
  };
  // Agenci wczytują się przed pokazaniem okna; sprawdzenie raz na zmianę listy.
  useEffect(check, [agents]); // eslint-disable-line react-hooks/exhaustive-deps

  const rows = useMemo(() => (available ? agentRows(agents, available) : []), [agents, available]);
  const presets = useMemo(() => presetChoices(BUILT_IN_PRESETS, rows), [rows]);
  const chosen = Math.min(presetIdx, presets.length - 1); // lista zmienia się po „Sprawdź ponownie”
  const preset = presets[chosen];
  const missing = rows.filter((r) => !r.ok);
  const langRow = uiRows().filter((r) => r.key === "lang" || r.key === "theme");

  const pick = async () => {
    try {
      const dir = await backend.pickDir();
      setPickError(null);
      if (dir !== null) setFolder(dir);
    } catch (e) {
      setPickError(t("app.pickDirFailed", { error: String(e) }));
    }
  };

  return (
    <Dialog label={t("first.title")} className="is-firstrun" onClose={onClose}>
      {(cancel) => (
        <>
          <h2>{t("first.title")}</h2>
          <p>{t("first.desc")}</p>

          {langRow.map((row) => (
            <UiRowControl key={row.key} row={row} ui={ui} onSet={onSet} />
          ))}

          <div className="set-row">
            <span className="set-label">{t("first.agents")}</span>
            {available === null ? (
              <p className="first-note">{t("first.checking")}</p>
            ) : (
              <ul className="first-agents">
                {rows.map((r) => (
                  <li key={r.id} className={r.ok ? "is-ok" : "is-missing"}>
                    <span aria-hidden>{r.ok ? "✓" : "✗"}</span>
                    <span className="first-name">{r.name}</span>
                    <code>{r.command}</code>
                    <span className="first-state">{r.ok ? t("first.found") : t("first.missing")}</span>
                    {!r.ok && r.install && <code className="first-install">{r.install}</code>}
                  </li>
                ))}
              </ul>
            )}
            {missing.length > 0 && <p className="first-note">{t("first.missingHint")}</p>}
            <button type="button" className="btn" onClick={check} disabled={available === null}>
              {t("first.recheck")}
            </button>
          </div>

          <div className="set-row">
            <span className="set-label">{t("first.project")}</span>
            <div className="first-folder">
              <button type="button" className="btn" onClick={() => void pick()}>
                {t("first.pickFolder")}
              </button>
              <span className="first-path" title={folder ?? undefined}>
                {folder ?? t("first.noFolder")}
              </span>
            </div>
            {pickError && <p className="first-note">{pickError}</p>}
            {presets.length > 0 && (
              <div className="seg" role="group" aria-label={t("first.preset")}>
                {presets.map((p, i) => (
                  <button key={p.name} type="button" className={i === chosen ? "is-on" : undefined} aria-pressed={i === chosen} onClick={() => setPresetIdx(i)}>
                    {p.name}
                  </button>
                ))}
              </div>
            )}
            {available !== null && presets.length === 0 && <p className="first-note">{t("first.noPreset")}</p>}
          </div>

          <div className="first-foot">
            <button type="button" className="btn" onClick={cancel}>
              {t("first.skip")}
            </button>
            <button
              type="button"
              className="btn primary"
              disabled={folder === null || available === null}
              onClick={() => folder !== null && onStart(folder, preset?.agents ?? [])}
            >
              {t("first.start")}
            </button>
          </div>
        </>
      )}
    </Dialog>
  );
}
