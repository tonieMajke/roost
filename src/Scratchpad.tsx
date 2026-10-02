// Scratchpad: notatka markdown projektu w panelu po prawej (obok Pulpitu). Edycja i podgląd
// przełączane; autozapis po ciszy (`src/scratchpad-save.ts`), plik w katalogu konfiguracji.

import { useEffect, useMemo, useRef, useState } from "react";
import { Eye, Pencil, X } from "lucide-react";
import { backend } from "./backend";
import { IconButton } from "./IconButton";
import { Markdown } from "./chat/Markdown";
import { createAutosave, type SaveState } from "./scratchpad-save";
import { useT } from "./i18n/useT";

type Props = {
  /** Notatka należy do projektu; zmiana projektu = nowy `key`, więc stan zaczyna się od zera. */
  projectId: string;
  projectName: string;
  onClose(): void;
};

const STATE_KEY = {
  saved: "ui2.scratch.saved",
  dirty: "ui2.scratch.dirty",
  saving: "ui2.scratch.saving",
  error: "ui2.scratch.error",
} as const satisfies Record<SaveState, string>;

export function Scratchpad({ projectId, projectName, onClose }: Props) {
  const { t } = useT();
  const [text, setText] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [preview, setPreview] = useState(false);
  const [state, setState] = useState<SaveState>("saved");
  const [error, setError] = useState<string | undefined>();
  const area = useRef<HTMLTextAreaElement>(null);

  const autosave = useMemo(
    () =>
      createAutosave(
        (txt) => backend.scratchpadSave(projectId, txt),
        (s, e) => {
          setState(s);
          setError(e);
        },
      ),
    [projectId],
  );

  useEffect(() => {
    let on = true;
    backend
      .scratchpadLoad(projectId)
      .then((txt) => {
        if (!on) return;
        setText(txt);
        setLoaded(true);
      })
      .catch((e: unknown) => {
        // Nie edytujemy po błędzie odczytu: autozapis nadpisałby nieodczytaną notatkę pustą.
        if (on) setLoadError(e instanceof Error ? e.message : String(e));
      });
    return () => {
      on = false;
    };
  }, [projectId]);

  // Zamknięcie panelu, zmiana projektu i zamknięcie okna zapisują to, co czeka na timer.
  useEffect(() => {
    const flush = () => void autosave.flush();
    window.addEventListener("beforeunload", flush);
    return () => {
      window.removeEventListener("beforeunload", flush);
      void autosave.flush();
    };
  }, [autosave]);

  useEffect(() => {
    if (loaded && !preview) area.current?.focus();
  }, [loaded, preview]);

  return (
    <aside className="scratch" aria-label={t("ui2.scratch.aria", { name: projectName })}>
      <header className="scratch-head">
        <span className="scratch-title" title={projectName}>
          {t("ui2.scratch.title", { name: projectName })}
        </span>
        <IconButton
          icon={preview ? Pencil : Eye}
          label={preview ? t("ui2.scratch.edit") : t("ui2.scratch.preview")}
          shortcut="Ctrl+Enter"
          onClick={() => setPreview((p) => !p)}
          disabled={!loaded}
        />
        <IconButton icon={X} label={t("ui2.scratch.close")} onClick={onClose} />
      </header>
      {loadError !== null ? (
        <p className="scratch-empty">{t("ui2.scratch.loadFail", { error: loadError })}</p>
      ) : preview ? (
        <div className="scratch-preview chat-md">
          {text.trim() === "" ? <p className="scratch-empty">{t("ui2.scratch.empty")}</p> : <Markdown text={text} />}
        </div>
      ) : (
        <textarea
          ref={area}
          className="scratch-edit"
          value={text}
          disabled={!loaded}
          spellCheck={false}
          placeholder={loaded ? t("ui2.scratch.placeholder") : t("ui2.scratch.loading")}
          onChange={(e) => {
            setText(e.target.value);
            autosave.change(e.target.value);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
              e.preventDefault();
              setPreview(true);
            }
          }}
        />
      )}
      <footer className={`scratch-foot is-${state}`} role="status" title={error}>
        {t(STATE_KEY[state])}
        {state === "error" && error ? `: ${error}` : ""}
      </footer>
    </aside>
  );
}
