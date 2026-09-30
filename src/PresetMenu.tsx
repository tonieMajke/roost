import { useEffect, useMemo, useRef, useState } from "react";
import type { AgentDef } from "./agents";
import type { Preset } from "./workspace";
import { BUILT_IN_PRESETS } from "./presets";

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

/** Menu „Presety”: wbudowane, kreska, własne z ✕, na końcu zapis obecnego układu. */
export function PresetMenu({ custom, agents, canSave, onApply, onDelete, onSave, onClose }: Props) {
  const [name, setName] = useState("");
  const box = useRef<HTMLDivElement>(null);
  const before = useRef(document.activeElement as HTMLElement | null);

  useEffect(() => {
    box.current?.focus();
  }, []);

  // Własny preset o nazwie wbudowanego zastępuje go w menu (nie dublujemy wierszy).
  const builtIn = useMemo(() => {
    const own = new Set(custom.map((p) => p.name));
    return BUILT_IN_PRESETS.filter((p) => !own.has(p.name));
  }, [custom]);
  const label = (preset: Preset) =>
    preset.agents.map((id) => agents.find((a) => a.id === id)?.name ?? id).join(" · ");

  const cancel = () => {
    onClose();
    before.current?.focus();
  };
  const save = () => {
    const trimmed = name.trim();
    if (trimmed === "") return;
    onSave(trimmed);
    cancel();
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key !== "Escape") return;
    e.preventDefault();
    e.stopPropagation();
    cancel();
  };
  const row = (preset: Preset) => (
    <>
      <span className="pm-name">{preset.name}</span>
      <span className="pm-agents">{label(preset)}</span>
    </>
  );

  return (
    <div className="dialog-backdrop" onMouseDown={cancel}>
      <div
        className="dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="pm-title"
        tabIndex={-1}
        ref={box}
        onKeyDown={onKeyDown}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <h2 id="pm-title">Presety paneli</h2>
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
          <p className="pm-hint">Brak własnych presetów</p>
        ) : (
          <ul className="pm-list">
            {custom.map((preset) => (
              <li key={preset.name} className="pm-item">
                <button type="button" className="pm-row" onClick={() => onApply(preset)}>
                  {row(preset)}
                </button>
                <button
                  type="button"
                  className="pm-del"
                  aria-label={`Usuń preset ${preset.name}`}
                  onClick={() => onDelete(preset.name)}
                >
                  ✕
                </button>
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
          <button type="button" onClick={save} disabled={!canSave || name.trim() === ""}>
            Zapisz obecny układ…
          </button>
        </div>
        <p className="pm-hint">Klik dodaje panele · Esc zamyka</p>
      </div>
    </div>
  );
}
