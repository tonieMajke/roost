import { describe, expect, it } from "vitest";
import { setLang } from "./i18n";
import {
  NO_USAGE,
  compact,
  dailySeries,
  dayOf,
  filterRows,
  groupBy,
  mergeRows,
  normalizeModel,
  projectLabel,
  rangeStart,
  shiftDay,
  summarize,
  totalTokens,
  withProjectNames,
  type UsageRow,
} from "./usage";

const r = (extra: Partial<UsageRow> = {}): UsageRow => ({
  day: "2026-09-30",
  source: "pane",
  provider: "claude",
  model: "claude-opus-5-5",
  ...NO_USAGE,
  input: 100,
  output: 50,
  n: 1,
  ...extra,
});

describe("dni", () => {
  it("dayOf: czas lokalny, nie UTC", () => {
    expect(dayOf(new Date(2026, 8, 30, 23, 59).getTime())).toBe("2026-09-30");
    expect(dayOf(new Date(2026, 9, 1, 0, 1).getTime())).toBe("2026-10-01");
  });
  it("shiftDay: granice miesiąca i roku", () => {
    expect(shiftDay("2026-10-01", -1)).toBe("2026-09-30");
    expect(shiftDay("2026-12-31", 1)).toBe("2027-01-01");
    expect(shiftDay("2026-03-29", 1)).toBe("2026-03-30"); // zmiana czasu
  });
  it("rangeStart: 7 dni to dziś i 6 poprzednich", () => {
    expect(rangeStart("7d", "2026-10-01")).toBe("2026-09-25");
    expect(rangeStart("all", "2026-10-01")).toBeNull();
  });
});

describe("agregacja", () => {
  it("totalTokens nie liczy rozumowania drugi raz", () => {
    expect(totalTokens({ input: 1, output: 10, cacheRead: 100, cacheWrite: 1000, reasoning: 5 })).toBe(1111);
  });
  it("mergeRows sumuje ten sam klucz i zostawia różne", () => {
    const out = mergeRows([r({ costUsd: 0.5 }), r({ costUsd: 0.25, n: 2 }), r({ model: "x" })]);
    expect(out).toHaveLength(2);
    expect(out[0]).toMatchObject({ input: 200, output: 100, n: 3, costUsd: 0.75 });
  });
  it("mergeRows nie zmienia wejścia", () => {
    const a = r();
    mergeRows([a, r()]);
    expect(a.input).toBe(100);
  });
  it("groupBy: od największego, udziały sumują się do 1", () => {
    const g = groupBy([r({ model: "a", input: 10 }), r({ model: "b", input: 300 }), r({ model: "a", input: 10 })], "model");
    expect(g.map((x) => x.key)).toEqual(["b", "a"]);
    expect(g.reduce((s, x) => s + x.share, 0)).toBeCloseTo(1);
    expect(g[1]).toMatchObject({ total: 20 + 100, n: 2 });
  });
  it("groupBy projekt: brak projektu to pusty klucz", () => {
    expect(groupBy([r({ source: "chat" })], "project")[0].key).toBe("");
  });
  it("groupBy pustych danych nie dzieli przez zero", () => {
    expect(groupBy([r({ input: 0, output: 0 })], "model")[0].share).toBe(0);
  });
  it("summarize: najczęstszy model wg tokenów i wg wywołań", () => {
    const s = summarize([r({ model: "duzy", input: 1000, n: 1 }), r({ model: "maly", input: 10, n: 9 })]);
    expect(s.topModel).toBe("duzy");
    expect(s.topModelByCalls).toBe("maly");
    expect(s.n).toBe(10);
    expect(summarize([]).topModel).toBeNull();
  });
  it("summarize: dni z ruchem", () => {
    expect(summarize([r(), r({ day: "2026-09-29" }), r({ day: "2026-09-28", input: 0, output: 0 })]).days).toBe(2);
  });
});

describe("filtry i szereg", () => {
  const rows = [r({ day: "2026-09-01" }), r({ day: "2026-09-29", provider: "codex" }), r({ day: "2026-09-30", project: "/p" })];
  it("zakres i wymiary", () => {
    expect(filterRows(rows, { range: "7d" }, "2026-09-30")).toHaveLength(2);
    expect(filterRows(rows, { range: "all", provider: "codex" }, "2026-09-30")).toHaveLength(1);
    expect(filterRows(rows, { range: "all", project: "" }, "2026-09-30")).toHaveLength(2);
    expect(filterRows(rows, { range: "all", project: "/p" }, "2026-09-30")).toHaveLength(1);
  });
  it("dailySeries wypełnia dni bez ruchu zerami", () => {
    const s = dailySeries([r({ day: "2026-09-29" })], "2026-09-28", "2026-09-30");
    expect(s.map((p) => p.total)).toEqual([0, 150, 0]);
  });
});

describe("modele i liczby", () => {
  it("normalizeModel: alias i data w id", () => {
    expect(normalizeModel("haiku")).toBe("claude-haiku-4-5");
    expect(normalizeModel("claude-haiku-4-5-20251001")).toBe("claude-haiku-4-5");
    expect(normalizeModel("claude-opus-5-5[1m]")).toBe("claude-opus-5-5");
    expect(normalizeModel("gpt-5.6-luna")).toBe("gpt-5.6-luna");
  });
  it("compact", () => {
    expect(compact(999)).toBe("999");
    expect(compact(1500, "en-US")).toBe("1.5 tys.");
    expect(compact(3_400_000, "en-US")).toBe("3.4 mln");
  });
  it("compact po angielsku: K / M / B", () => {
    setLang("en");
    try {
      expect(compact(1500)).toBe("1.5K");
      expect(compact(3_400_000)).toBe("3.4M");
      expect(compact(2_000_000_000)).toBe("2B");
    } finally {
      setLang("pl");
    }
  });
});
