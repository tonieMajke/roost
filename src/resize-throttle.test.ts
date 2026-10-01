import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MAX_WAIT_MS, QUIET_MS, ResizeThrottle } from "./resize-throttle";

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

function setup() {
  const run = vi.fn();
  const t = new ResizeThrottle(run, () => Date.now());
  return { run, t };
}

describe("ResizeThrottle", () => {
  it("pojedyncza zmiana po ciszy idzie od razu i tylko raz", () => {
    const { run, t } = setup();
    t.request();
    expect(run).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(QUIET_MS * 3);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("przeciąganie co klatkę: fit najwyżej co MAX_WAIT_MS i jeden końcowy po ciszy", () => {
    const { run, t } = setup();
    for (let i = 0; i < 60; i++) {
      t.request();
      vi.advanceTimersByTime(16); // ~1 s przeciągania
    }
    const during = run.mock.calls.length;
    expect(during).toBeGreaterThanOrEqual(Math.floor(960 / MAX_WAIT_MS));
    expect(during).toBeLessThanOrEqual(Math.ceil(960 / MAX_WAIT_MS) + 1);
    vi.advanceTimersByTime(QUIET_MS);
    expect(run).toHaveBeenCalledTimes(during + 1); // ostatni rozmiar zawsze dociera
  });

  it("bez zmiany po ostatnim fit nie ma końcowego fit", () => {
    const { run, t } = setup();
    t.request();
    vi.advanceTimersByTime(MAX_WAIT_MS);
    t.request(); // minęło MAX_WAIT_MS: idzie od razu
    expect(run).toHaveBeenCalledTimes(2);
    vi.advanceTimersByTime(QUIET_MS);
    expect(run).toHaveBeenCalledTimes(2);
  });

  it("dispose kasuje czekający fit", () => {
    const { run, t } = setup();
    t.request();
    t.request();
    t.dispose();
    vi.advanceTimersByTime(QUIET_MS * 2);
    expect(run).toHaveBeenCalledTimes(1);
  });
});
