import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BATCH_BYTES, HIDDEN_INTERVAL_MS, PEAK_WARN_BYTES, WriteGate, WriteQueue, peakQueueBytes } from "./write-queue";

const bytes = (n: number, fill = 1) => new Uint8Array(n).fill(fill);

/** Odbiorca jak xterm: pamięta paczki, `done` woła test (albo od razu przy `auto`). */
function sink(auto = false) {
  const writes: Uint8Array[] = [];
  const pending: (() => void)[] = [];
  const fn = (data: Uint8Array, done: () => void) => {
    writes.push(data);
    if (auto) done();
    else pending.push(done);
  };
  return { fn, writes, finish: () => pending.shift()?.() };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("WriteQueue", () => {
  it("pierwszy kawałek idzie od razu, kolejne czekają na callback i łączą się w paczkę", () => {
    const s = sink();
    const q = new WriteQueue(s.fn, () => false, undefined, new WriteGate());
    q.push(bytes(10, 1));
    q.push(bytes(20, 2));
    q.push(bytes(30, 3));
    expect(s.writes.map((w) => w.length)).toEqual([10]);
    expect(q.queued).toBe(50);
    s.finish();
    expect(s.writes.map((w) => w.length)).toEqual([10, 50]);
    expect(Array.from(s.writes[1].slice(18, 22))).toEqual([2, 2, 3, 3]);
    expect(q.queued).toBe(0);
  });

  it("paczki najwyżej BATCH_BYTES, duży kawałek cięty, kolejność i suma bajtów zachowane", () => {
    const s = sink();
    const q = new WriteQueue(s.fn, () => false, undefined, new WriteGate());
    const big = new Uint8Array(BATCH_BYTES * 2 + 100).map((_, i) => i % 251);
    q.push(bytes(5, 9)); // leci od razu
    q.push(big);
    q.push(bytes(7, 8));
    while (q.queued > 0) s.finish();
    expect(s.writes.every((w) => w.length <= BATCH_BYTES)).toBe(true);
    const all = new Uint8Array(s.writes.reduce((n, w) => n + w.length, 0));
    let at = 0;
    for (const w of s.writes) {
      all.set(w, at);
      at += w.length;
    }
    expect(all.length).toBe(5 + big.length + 7);
    expect(Array.from(all.subarray(5, 5 + big.length))).toEqual(Array.from(big));
    expect(Array.from(all.subarray(all.length - 7))).toEqual(Array(7).fill(8));
  });

  it("drobne kawałki dopełniają paczkę do BATCH_BYTES (reszta ostatniego czeka)", () => {
    const s = sink();
    const q = new WriteQueue(s.fn, () => false, undefined, new WriteGate());
    q.push(bytes(1));
    for (let i = 0; i < 3; i++) q.push(bytes(BATCH_BYTES / 2));
    s.finish();
    expect(s.writes[1].length).toBe(BATCH_BYTES);
    expect(q.queued).toBe(BATCH_BYTES / 2);
  });

  it("ukryty panel: zapis dopiero po HIDDEN_INTERVAL_MS, nic nie ginie", () => {
    const s = sink(true);
    let hidden = true;
    const q = new WriteQueue(s.fn, () => hidden, undefined, new WriteGate());
    q.push(bytes(BATCH_BYTES + 10));
    expect(s.writes).toHaveLength(0);
    vi.advanceTimersByTime(HIDDEN_INTERVAL_MS - 1);
    expect(s.writes).toHaveLength(0);
    vi.advanceTimersByTime(1);
    expect(s.writes.map((w) => w.length)).toEqual([BATCH_BYTES]);
    vi.advanceTimersByTime(HIDDEN_INTERVAL_MS);
    expect(s.writes.map((w) => w.length)).toEqual([BATCH_BYTES, 10]);
    // panel znów widoczny: od razu
    hidden = false;
    q.push(bytes(3));
    expect(s.writes).toHaveLength(3);
  });

  it("panel pokazany w trakcie czekania: reszta leci bez dalszego dławienia", () => {
    const s = sink(true);
    let hidden = true;
    const q = new WriteQueue(s.fn, () => hidden, undefined, new WriteGate());
    q.push(bytes(BATCH_BYTES * 3));
    hidden = false;
    vi.advanceTimersByTime(HIDDEN_INTERVAL_MS);
    expect(s.writes).toHaveLength(3);
    expect(q.queued).toBe(0);
  });

  it("podwójny callback odbiorcy nie dubluje zapisu", () => {
    const writes: number[] = [];
    let last: () => void = () => {};
    const q = new WriteQueue((d, done) => {
      writes.push(d.length);
      last = done;
    }, () => false, undefined, new WriteGate());
    q.push(bytes(1));
    q.push(bytes(2));
    const first = last;
    first();
    first();
    expect(writes).toEqual([1, 2]);
  });

  it("dispose: czekające bajty i timer znikają, nowe kawałki są ignorowane", () => {
    const s = sink();
    const q = new WriteQueue(s.fn, () => true, undefined, new WriteGate());
    q.push(bytes(10));
    q.dispose();
    vi.advanceTimersByTime(HIDDEN_INTERVAL_MS * 4);
    q.push(bytes(10));
    expect(s.writes).toHaveLength(0);
    expect(q.queued).toBe(0);
  });

  it("szczyt kolejki i jednorazowe ostrzeżenie powyżej PEAK_WARN_BYTES", () => {
    const s = sink();
    const warn = vi.fn();
    const q = new WriteQueue(s.fn, () => false, warn, new WriteGate());
    q.push(bytes(1)); // w zapisie, callback nie przychodzi
    const mb = bytes(1024 * 1024);
    for (let i = 0; i < 51; i++) q.push(mb);
    q.push(mb);
    expect(q.peak).toBe(52 * 1024 * 1024);
    expect(peakQueueBytes()).toBeGreaterThanOrEqual(q.peak);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toBeGreaterThan(PEAK_WARN_BYTES);
  });
});

describe("WriteGate", () => {
  it("jedna paczka naraz dla wszystkich paneli, po kolei", () => {
    const gate = new WriteGate();
    const a = sink();
    const b = sink();
    const qa = new WriteQueue(a.fn, () => false, undefined, gate);
    const qb = new WriteQueue(b.fn, () => false, undefined, gate);
    qa.push(bytes(BATCH_BYTES * 2));
    qb.push(bytes(10));
    expect([a.writes.length, b.writes.length]).toEqual([1, 0]);
    a.finish(); // kolej b, a wraca na koniec
    expect([a.writes.length, b.writes.length]).toEqual([1, 1]);
    b.finish();
    expect([a.writes.length, b.writes.length]).toEqual([2, 1]);
    a.finish();
    expect(qa.queued + qb.queued).toBe(0);
  });

  it("dispose panelu w trakcie zapisu zwalnia bramkę (zamknięty xterm nie woła callbacku)", () => {
    const gate = new WriteGate();
    const a = sink();
    const b = sink();
    const qa = new WriteQueue(a.fn, () => false, undefined, gate);
    const qb = new WriteQueue(b.fn, () => false, undefined, gate);
    qa.push(bytes(10));
    qb.push(bytes(10));
    expect(b.writes).toHaveLength(0);
    qa.dispose();
    expect(b.writes).toHaveLength(1);
    a.finish(); // spóźniony callback zamkniętego nie rusza bramki
    qb.push(bytes(5));
    expect(b.writes).toHaveLength(1); // b nadal w zapisie
  });

  it("dispose panelu czekającego w kolejce bramki: kolejka idzie dalej bez niego", () => {
    const gate = new WriteGate();
    const a = sink();
    const b = sink();
    const c = sink();
    const qa = new WriteQueue(a.fn, () => false, undefined, gate);
    const qb = new WriteQueue(b.fn, () => false, undefined, gate);
    const qc = new WriteQueue(c.fn, () => false, undefined, gate);
    qa.push(bytes(1));
    qb.push(bytes(1));
    qc.push(bytes(1));
    qb.dispose();
    a.finish();
    expect([b.writes.length, c.writes.length]).toEqual([0, 1]);
    expect(qc.queued).toBe(0);
  });
});
