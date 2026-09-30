//! Dławienie zapisu do xterm: kolejka kawałków z PTY na panel, zapis paczkami, następna
//! paczka dopiero w callbacku `write` (xterm skończył parsować poprzednią). Bez Reacta i xterm.

/** Największa paczka oddawana xtermowi naraz. */
export const BATCH_BYTES = 64 * 1024;
/** Panel w schowanej siatce dostaje paczkę najwyżej co tyle; nic nie ginie, tylko czeka. */
export const HIDDEN_INTERVAL_MS = 250;
/** Szczyt kolejki powyżej tego = trzeba wstrzymywać czytanie PTY w Rust (plan M2, etap 7). */
export const PEAK_WARN_BYTES = 50 * 1024 * 1024;

/** Zapis paczki; `done` woła się, gdy odbiorca jest gotów na następną (xterm: callback `write`). */
export type Sink = (data: Uint8Array, done: () => void) => void;

/** Największy szczyt kolejki spośród wszystkich paneli od startu (do pomiaru w oknie). */
let globalPeak = 0;
export const peakQueueBytes = () => globalPeak;

/**
 * Jedna paczka w xterm naraz dla wszystkich paneli, po kolei. Każdy xterm parsuje we własnym
 * `setTimeout`; 16 timerów na ten sam moment wykonuje się jeden po drugim i klik czeka na
 * wszystkie (pomiar: skoki ~400 ms także przy panelach bez rysowania).
 */
export class WriteGate {
  private busy: WriteQueue | null = null;
  private waiting: WriteQueue[] = [];

  /** `q` zapisze, gdy przyjdzie jego kolej (od razu, gdy bramka wolna). */
  request(q: WriteQueue): void {
    if (this.busy === q || this.waiting.includes(q)) return;
    this.waiting.push(q);
    this.next();
  }

  /** Koniec zapisu `q` (callback odbiorcy albo dispose); pozostali czekający nie przepadają. */
  release(q: WriteQueue): void {
    this.waiting = this.waiting.filter((w) => w !== q);
    if (this.busy !== q) return;
    this.busy = null;
    this.next();
  }

  private next(): void {
    while (this.busy === null && this.waiting.length > 0) {
      const q = this.waiting.shift()!;
      this.busy = q;
      if (!q.grant()) this.busy = null; // nie ma już nic do zapisu albo zamknięty
    }
  }
}

const sharedGate = new WriteGate();

export class WriteQueue {
  private chunks: Uint8Array[] = [];
  private bytes = 0;
  private writing = false;
  private waiting = false;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private disposed = false;
  private warned = false;
  /** Najwięcej bajtów czekających naraz w tej kolejce. */
  peak = 0;

  constructor(
    private readonly sink: Sink,
    /** Panel niewidoczny (np. `clientWidth === 0`): zapis rzadziej. */
    private readonly isHidden: () => boolean,
    /** Wołane raz, gdy szczyt przekroczy PEAK_WARN_BYTES. */
    private readonly onPeakWarn?: (bytes: number) => void,
    private readonly gate: WriteGate = sharedGate,
  ) {}

  /** Bajty czekające na zapis. */
  get queued(): number {
    return this.bytes;
  }

  push(chunk: Uint8Array): void {
    if (this.disposed || chunk.length === 0) return;
    this.chunks.push(chunk);
    this.bytes += chunk.length;
    if (this.bytes > this.peak) {
      this.peak = this.bytes;
      if (this.peak > globalPeak) globalPeak = this.peak;
      if (!this.warned && this.peak > PEAK_WARN_BYTES) {
        this.warned = true;
        this.onPeakWarn?.(this.peak);
      }
    }
    this.pump();
  }

  dispose(): void {
    this.disposed = true;
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
    this.chunks = [];
    this.bytes = 0;
    // Zamknięty xterm może nigdy nie zawołać callbacku: bramka nie może na niego czekać.
    this.writing = false;
    this.waiting = false;
    this.gate.release(this);
  }

  private pump(): void {
    if (this.disposed || this.writing || this.waiting || this.timer !== null || this.bytes === 0) return;
    if (this.isHidden()) {
      this.timer = setTimeout(() => {
        this.timer = null;
        this.ask();
      }, HIDDEN_INTERVAL_MS);
      return;
    }
    this.ask();
  }

  private ask(): void {
    if (this.disposed || this.bytes === 0) return;
    this.waiting = true;
    this.gate.request(this);
  }

  /** Kolej tego panelu w bramce; `false` = nie zapisał (bramka idzie dalej). */
  grant(): boolean {
    this.waiting = false;
    if (this.disposed || this.bytes === 0) return false;
    const batch = this.take();
    this.writing = true;
    let called = false;
    this.sink(batch, () => {
      if (called || this.disposed) return; // callback woła się raz; po dispose bramka już zwolniona
      called = true;
      this.writing = false;
      this.gate.release(this);
      this.pump();
    });
    return true;
  }

  /** Do BATCH_BYTES z początku kolejki; za duży kawałek jest cięty (xterm skleja UTF-8 między zapisami). */
  private take(): Uint8Array {
    const first = this.chunks[0];
    if (first.length >= BATCH_BYTES) {
      const head = first.subarray(0, BATCH_BYTES);
      if (first.length === BATCH_BYTES) this.chunks.shift();
      else this.chunks[0] = first.subarray(BATCH_BYTES);
      this.bytes -= head.length;
      return head;
    }
    let size = 0;
    let n = 0;
    while (n < this.chunks.length && size + this.chunks[n].length <= BATCH_BYTES) size += this.chunks[n++].length;
    const room = BATCH_BYTES - size;
    const partial = n < this.chunks.length && room > 0 ? room : 0;
    const out = new Uint8Array(size + partial);
    let at = 0;
    for (let i = 0; i < n; i++) {
      out.set(this.chunks[i], at);
      at += this.chunks[i].length;
    }
    this.chunks.splice(0, n);
    if (partial > 0) {
      out.set(this.chunks[0].subarray(0, partial), at);
      this.chunks[0] = this.chunks[0].subarray(partial);
    }
    this.bytes -= out.length;
    return out;
  }
}
