import { describe, expect, it } from "vitest";
import { piSummaryArgs, run, summaryArgs } from "./summary";

const sh = (script: string) => ["-c", script];

describe("summary", () => {
  it("argumenty wyłączają narzędzia, ustawienia i zapis sesji", () => {
    const a = summaryArgs("streść");
    const has = (k: string, v: string) => a.some((x, i) => x === k && a[i + 1] === v);
    expect(has("--model", "haiku")).toBe(true);
    expect(has("--tools", "")).toBe(true);
    expect(has("--setting-sources", "")).toBe(true);
    expect(has("--system-prompt", "streść")).toBe(true);
    expect(a).toContain("--no-session-persistence");
  });

  it("pi: bez narzędzi, rozszerzeń i zapisu sesji, z poleceniem systemowym", () => {
    const a = piSummaryArgs("streść");
    for (const f of ["-p", "--no-session", "--no-tools", "--no-extensions"]) expect(a).toContain(f);
    expect(a[a.indexOf("--system-prompt") + 1]).toBe("streść");
  });

  it("stdin wchodzi, przycięte stdout wraca", async () => {
    await expect(run("sh", sh("cat; echo"), "  streszczenie\n", 5000)).resolves.toBe("streszczenie");
  });

  it("błąd zgłasza kod i pierwszą linię stderr", async () => {
    await expect(run("sh", sh("echo 'nie zalogowano' >&2; exit 3"), "", 5000)).rejects.toThrow("kod 3: nie zalogowano");
    await expect(run("sh", sh("true"), "", 5000)).rejects.toThrow("pusta odpowiedź");
    await expect(run("/nie/ma/takiego", [], "", 5000)).rejects.toThrow("nie uruchomiono");
  });

  it("przekroczony czas zabija proces", async () => {
    const started = Date.now();
    await expect(run("sh", sh("exec sleep 30"), "", 300)).rejects.toThrow("brak odpowiedzi");
    expect(Date.now() - started).toBeLessThan(5000);
  });
});
