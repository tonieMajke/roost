//! Scratchpad (UI): autozapis z opóźnieniem. Bez Reacta; zapis i stan wstrzykiwane (testy).

export const SAVE_DELAY_MS = 800;

export type SaveState = "saved" | "dirty" | "saving" | "error";

export type Autosave = {
  /** Nowa treść; zapis po `delay` ms ciszy (kolejna zmiana odsuwa termin). */
  change(text: string): void;
  /** Zapisz od razu, jeśli jest co (zmiana projektu, zamknięcie panelu). Czeka na trwający zapis. */
  flush(): Promise<void>;
  /** Wyłącza timer bez zapisu (po `flush`). */
  dispose(): void;
};

/**
 * Zapisy idą po kolei: nowy startuje po zakończeniu poprzedniego i zapisuje najnowszy tekst.
 * Błąd zostawia notatkę „brudną” – następna zmiana albo `flush` ponawia.
 */
export function createAutosave(
  save: (text: string) => Promise<void>,
  onState: (s: SaveState, error?: string) => void,
  delay = SAVE_DELAY_MS,
): Autosave {
  let pending: string | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let running: Promise<void> | null = null;

  const clear = () => {
    if (timer !== null) clearTimeout(timer);
    timer = null;
  };

  const run = (): Promise<void> => {
    if (running) return running;
    running = (async () => {
      while (pending !== null) {
        const text = pending;
        pending = null;
        onState("saving");
        try {
          await save(text);
        } catch (e) {
          if (pending === null) pending = text; // nie gub tekstu; nowszy ma pierwszeństwo
          onState("error", e instanceof Error ? e.message : String(e));
          return;
        }
      }
      onState("saved");
    })().finally(() => {
      running = null;
    });
    return running;
  };

  return {
    change(text) {
      pending = text;
      clear();
      onState("dirty");
      timer = setTimeout(() => {
        timer = null;
        void run();
      }, delay);
    },
    async flush() {
      clear();
      if (running) await running;
      if (pending !== null) await run();
    },
    dispose: clear,
  };
}
