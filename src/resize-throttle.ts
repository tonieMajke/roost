//! Dławienie fit() przy zmianie rozmiaru okna. Każdy fit to przeliczenie siatki xterm (reflow
//! historii) i SIGWINCH dla agenta, który przerysowuje cały ekran; przy przeciąganiu krawędzi
//! okna ResizeObserver strzela co klatkę we wszystkich panelach naraz. Bez Reacta i xterm.

/** Cisza po ostatniej zmianie, po której idzie końcowy fit. */
export const QUIET_MS = 120;
/** W trakcie przeciągania fit najwyżej co tyle (terminal nie stoi w starym rozmiarze do końca). */
export const MAX_WAIT_MS = 250;

/**
 * Pierwsza zmiana po ciszy idzie od razu (maksymalizacja, przełączenie panelu – jeden skok),
 * kolejne w serii najwyżej co `MAX_WAIT_MS`, a ostatnia zawsze po `QUIET_MS` ciszy.
 */
export class ResizeThrottle {
  private quiet: ReturnType<typeof setTimeout> | undefined;
  private lastRun = -Infinity;
  private pending = false;

  constructor(private run: () => void, private now: () => number = () => performance.now()) {}

  request(): void {
    const t = this.now();
    const idle = this.quiet === undefined;
    if (idle || t - this.lastRun >= MAX_WAIT_MS) this.fire(t);
    else this.pending = true;
    clearTimeout(this.quiet);
    this.quiet = setTimeout(() => {
      this.quiet = undefined;
      if (this.pending) this.fire(this.now());
    }, QUIET_MS);
  }

  dispose(): void {
    clearTimeout(this.quiet);
    this.quiet = undefined;
    this.pending = false;
  }

  private fire(t: number): void {
    this.pending = false;
    this.lastRun = t;
    this.run();
  }
}
