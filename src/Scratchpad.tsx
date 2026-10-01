// Scratchpad: notatka markdown projektu w panelu po prawej (obok Pulpitu). Edycja i podgląd
// przełączane; autozapis po ciszy (`src/scratchpad.ts`), plik w katalogu konfiguracji.

import { useEffect, useMemo, useRef, useState } from "react";
import { Eye, Pencil, X } from "lucide-react";
import { backend } from "./backend";
import { IconButton } from "./IconButton";
import { Markdown } from "./chat/Markdown";
import { createAutosave, type SaveState } from "./scratchpad";

type Props = {
  /** Notatka należy do projektu; zmiana projektu = nowy `key`, więc stan zaczyna się od zera. */
  projectId: string;
  projectName: string;
  onClose(): void;
};

const STATE_TEXT: Record<SaveState, string> = {
  saved: "Zapisano",
  dirty: "Niezapisane…",
  saving: "Zapisuję…",
  error: "Błąd zapisu",
};

export function Scratchpad({ projectId, projectName, onClose }: Props) {
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
        (t) => backend.scratchpadSave(projectId, t),
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
      .then((t) => {
        if (!on) return;
        setText(t);
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
    <aside className="scratch" aria-label={`Notatki projektu ${projectName}`}>
      <header className="scratch-head">
        <span className="scratch-title" title={projectName}>
          Notatki · {projectName}
        </span>
        <IconButton
          icon={preview ? Pencil : Eye}
          label={preview ? "Edytuj" : "Podgląd"}
          shortcut="Ctrl+Enter"
          onClick={() => setPreview((p) => !p)}
          disabled={!loaded}
        />
        <IconButton icon={X} label="Zamknij notatki" onClick={onClose} />
      </header>
      {loadError !== null ? (
        <p className="scratch-empty">Nie udało się wczytać notatki: {loadError}</p>
      ) : preview ? (
        <div className="scratch-preview chat-md">
          {text.trim() === "" ? <p className="scratch-empty">Pusta notatka.</p> : <Markdown text={text} />}
        </div>
      ) : (
        <textarea
          ref={area}
          className="scratch-edit"
          value={text}
          disabled={!loaded}
          spellCheck={false}
          placeholder={loaded ? "Markdown: # nagłówek, - lista, - [ ] zadanie, ```kod```" : "Wczytywanie…"}
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
        {STATE_TEXT[state]}
        {state === "error" && error ? `: ${error}` : ""}
      </footer>
    </aside>
  );
}
