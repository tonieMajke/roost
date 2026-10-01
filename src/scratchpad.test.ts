import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SAVE_DELAY_MS, createAutosave, type SaveState } from "./scratchpad";

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

const setup = (save: (t: string) => Promise<void>) => {
  const states: SaveState[] = [];
  const a = createAutosave(save, (s) => states.push(s));
  return { a, states };
};

describe("createAutosave", () => {
  it("zapisuje dopiero po ciszy, tylko ostatni tekst", async () => {
    const save = vi.fn(async (_t: string) => {});
    const { a, states } = setup(save);
    a.change("a");
    await vi.advanceTimersByTimeAsync(SAVE_DELAY_MS - 1);
    a.change("ab");
    await vi.advanceTimersByTimeAsync(SAVE_DELAY_MS - 1);
    expect(save).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(save).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenCalledWith("ab");
    expect(states.at(-1)).toBe("saved");
  });

  it("flush zapisuje od razu i nic nie robi, gdy nie ma zmian", async () => {
    const save = vi.fn(async (_t: string) => {});
    const { a } = setup(save);
    await a.flush();
    expect(save).not.toHaveBeenCalled();
    a.change("x");
    await a.flush();
    expect(save).toHaveBeenCalledWith("x");
    await vi.advanceTimersByTimeAsync(SAVE_DELAY_MS * 2);
    expect(save).toHaveBeenCalledTimes(1);
  });

  it("zapisy nie nakładają się; zmiana w trakcie zapisu trafia po nim", async () => {
    let release!: () => void;
    const calls: string[] = [];
    let active = 0;
    let maxActive = 0;
    const save = vi.fn(async (t: string) => {
      calls.push(t);
      active++;
      maxActive = Math.max(maxActive, active);
      if (calls.length === 1) await new Promise<void>((r) => (release = r));
      active--;
    });
    const { a } = setup(save);
    a.change("1");
    await vi.advanceTimersByTimeAsync(SAVE_DELAY_MS);
    a.change("2");
    await vi.advanceTimersByTimeAsync(SAVE_DELAY_MS);
    expect(calls).toEqual(["1"]);
    release();
    await a.flush();
    expect(calls).toEqual(["1", "2"]);
    expect(maxActive).toBe(1);
  });

  it("błąd zapisu zostawia tekst do ponowienia", async () => {
    const save = vi.fn<(t: string) => Promise<void>>().mockRejectedValueOnce(new Error("dysk pełny")).mockResolvedValue(undefined);
    const errors: (string | undefined)[] = [];
    const states: SaveState[] = [];
    const a = createAutosave(save, (s, e) => {
      states.push(s);
      errors.push(e);
    });
    a.change("tekst");
    await vi.advanceTimersByTimeAsync(SAVE_DELAY_MS);
    expect(states.at(-1)).toBe("error");
    expect(errors.at(-1)).toBe("dysk pełny");
    await a.flush();
    expect(save).toHaveBeenLastCalledWith("tekst");
    expect(states.at(-1)).toBe("saved");
  });

  it("dispose wyłącza timer bez zapisu", async () => {
    const save = vi.fn(async (_t: string) => {});
    const { a } = setup(save);
    a.change("x");
    a.dispose();
    await vi.advanceTimersByTimeAsync(SAVE_DELAY_MS * 2);
    expect(save).not.toHaveBeenCalled();
  });
});
