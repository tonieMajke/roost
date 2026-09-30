import { useMemo, useState } from "react";
import type { AgentDef } from "./agents";
import type { Preset } from "./workspace";
import { BUILT_IN_PRESETS } from "./presets";
import { Dialog } from "./Dialog";
import { IconButton } from "./IconButton";
import { X } from "lucide-react";

type Props = {
  /** Presety własne z workspace.presets. */
  custom: Preset[];
  agents: AgentDef[];
  /** false = projekt bez paneli: nie ma czego zapisywać. */
  canSave: boolean;
  onApply(preset: Preset): void;
  onDelete(name: string): void;
  onSave(name: string): void;
  onClose(): void;
};

/** Okno „Presety”: wbudowane, kreska, własne z ✕, na końcu zapis obecnego układu. */
export function PresetMenu({ custom, agents, canSave, onApply, onDelete, onSave, onClose }: Props) {
  const [name, setName] = useState("");

  // Własny preset o nazwie wbudowanego zastępuje go w menu (nie dublujemy wierszy).
  const builtIn = useMemo(() => {
    const own = new Set(custom.map((p) => p.name));
    return BUILT_IN_PRESETS.filter((p) => !own.has(p.name));
  }, [custom]);
  const label = (preset: Preset) =>
    preset.agents.map((id) => agents.find((a) => a.id === id)?.name ?? id).join(" · ");
  const row = (preset: Preset) => (
    <>
      <span className="pm-name">{preset.name}</span>
      <span className="pm-agents">{label(preset)}</span>
    </>
  );

  return (
    <Dialog label="Presety paneli" onClose={onClose}>
      {(cancel) => {
        const save = () => {
          const trimmed = name.trim();
          if (!canSave || trimmed === "") return;
          onSave(trimmed);
          cancel();
        };
        return (
          <>
            <h2>Presety paneli</h2>
            <p>Dodają panele do aktywnego projektu.</p>
            <ul className="pm-list">
              {builtIn.map((preset) => (
                <li key={preset.name}>
                  <button type="button" className="pm-row" onClick={() => onApply(preset)}>
                    {row(preset)}
                  </button>
                </li>
              ))}
            </ul>
            <hr className="pm-sep" />
            {custom.length === 0 ? (
              <p className="set-foot">Brak własnych presetów</p>
            ) : (
              <ul className="pm-list">
                {custom.map((preset) => (
                  <li key={preset.name} className="pm-item">
                    <button type="button" className="pm-row" onClick={() => onApply(preset)}>
                      {row(preset)}
                    </button>
                    <IconButton
                      icon={X}
                      label={`Usuń preset ${preset.name}`}
                      className="pm-del"
                      onClick={() => onDelete(preset.name)}
                    />
                  </li>
                ))}
              </ul>
            )}
            <div className="pm-save">
              <input
                className="pm-input"
                value={name}
                placeholder="nazwa"
                aria-label="Nazwa nowego presetu"
                onChange={(e) => setName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key !== "Enter") return;
                  e.preventDefault();
                  save();
                }}
              />
              <button type="button" className="btn" onClick={save} disabled={!canSave || name.trim() === ""}>
                Zapisz obecny układ…
              </button>
            </div>
            <div className="dialog-foot">
              <span>
                <kbd>Enter</kbd> zapisz
              </span>
              <span>
                <kbd>Esc</kbd> zamknij
              </span>
            </div>
          </>
        );
      }}
    </Dialog>
  );
}
