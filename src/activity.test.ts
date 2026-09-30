import { describe, expect, it } from "vitest";
import {
  MIN_BURST_MS,
  QUIET_MS,
  RESIZE_QUIET_MS,
  dotClass,
  dotTitle,
  exitText,
  initialActivity,
  onOutput,
  onResize,
  projectState,
  rowState,
  tick,
} from "./activity";

const T0 = 1_000_000;

/** Output every `every` ms for `workSeconds`, then silence for `tailSeconds`, ticking once a second. */
function run(workSeconds: number, tailSeconds = 8, every = 500) {
  const stop = workSeconds * 1000;
  let a = initialActivity;
  let working = false;
  let finished = 0;
  for (let ms = 0; ms <= stop + tailSeconds * 1000; ms += 1000) {
    // outputs inside the second, then one tick per second (like App's setInterval)
    for (let t = ms; t < ms + 1000 && t < stop; t += every) a = onOutput(a, T0 + t);
    const r = tick(a, T0 + ms);
    a = r.activity;
    working = r.working;
    finished += r.finished ? 1 : 0;
  }
  return { finished, working };
}

describe("activity", () => {
  it("krótka seria (1 s) nie jest skończeniem pracy", () => {
    expect(run(1)).toEqual({ finished: 0, working: false }); // working == false: koniec serii + cisza
  });

  it("długa seria (5 s) daje dokładnie jedno finished", () => {
    // Seria kończy się, gdy minie QUIET_MS od ostatniego wyjścia – potem kropka gaśnie.
    const r = run(5);
    expect(r.finished).toBe(1);
    expect(r.working).toBe(false);
  });

  it("finished nie powtarza się przy dalszym milczeniu", () => {
    expect(run(5, 20).finished).toBe(1);
  });

  it("po nowym wyjściu praca zgłasza się znowu", () => {
    let a = initialActivity;
    for (let t = 0; t < 5000; t += 500) a = onOutput(a, T0 + t);
    let r = tick(a, T0 + 8000);
    expect(r.finished).toBe(true);
    a = r.activity;
    for (let t = 10000; t < 15000; t += 500) a = onOutput(a, T0 + t);
    r = tick(a, T0 + 15000);
    expect(r.working).toBe(true);
    expect(r.finished).toBe(false);
    expect(tick(a, T0 + 15000 + QUIET_MS).finished).toBe(true);
  });

  it("wyjście w oknie ciszy po onResize nie liczy się", () => {
    let a = onResize(initialActivity, T0);
    a = onOutput(a, T0 + 100); // w oknie przerysowania: pominięte
    expect(a).toEqual({ ...initialActivity, quietUntil: T0 + RESIZE_QUIET_MS });
    a = onOutput(a, T0 + RESIZE_QUIET_MS + 1); // po oknie: liczy się
    expect(a.lastOutput).toBe(T0 + RESIZE_QUIET_MS + 1);
    expect(a.burstStart).toBe(T0 + RESIZE_QUIET_MS + 1);
  });

  it("przerwa >= 2 s zaczyna nową serię", () => {
    let a = onOutput(initialActivity, T0);
    a = onOutput(a, T0 + 1000); // w środku serii
    expect(a.burstStart).toBe(T0);
    a = onOutput(a, T0 + 1000 + QUIET_MS); // po ciszy: nowa seria
    expect(a.burstStart).toBe(T0 + 1000 + QUIET_MS);
  });

  it("working gaśnie po 2 s ciszy", () => {
    let a = onOutput(initialActivity, T0);
    expect(tick(a, T0 + QUIET_MS - 1).working).toBe(true);
    expect(tick(a, T0 + QUIET_MS).working).toBe(false);
  });

  it("seria krótsza niż MIN_BURST_MS nigdy nie jest skończona", () => {
    let a = onOutput(initialActivity, T0);
    a = onOutput(a, T0 + MIN_BURST_MS - 1);
    expect(tick(a, T0 + QUIET_MS + MIN_BURST_MS).finished).toBe(false);
  });

  it("panel, który nigdy nic nie wypisał, nie pracuje i nie kończy", () => {
    const r = tick(initialActivity, T0);
    expect(r).toEqual({ activity: initialActivity, working: false, finished: false });
  });

  it("kropka: pracuje > nieprzeczytane > działa/zakończony", () => {
    expect(dotClass({})).toBe("dot--on");
    expect(dotClass({ exited: { code: 0, signal: null } })).toBe("dot--off");
    expect(dotClass({ unread: true })).toBe("dot--unread");
    expect(dotClass({ unread: true, exited: { code: 1, signal: null } })).toBe("dot--unread");
    expect(dotClass({ working: true, unread: true, exited: { code: 1, signal: null } })).toBe("dot--working");
  });

  it("title kropki mówi, co widać", () => {
    expect(dotTitle({}, "")).toBe("działa");
    expect(dotTitle({ exited: { code: 1, signal: null } }, "kod 1")).toBe("kod 1");
    expect(dotTitle({ unread: true }, "")).toBe("nowe wyjście – panel bez fokusu");
    expect(dotTitle({ working: true }, "kod 1")).toBe("pracuje");
  });

  it("wiersz panelu na szynie: klasa st-* i tekst stanu", () => {
    expect(rowState({})).toEqual({ cls: "st-idle", text: "czeka" });
    expect(rowState({ exited: { code: 0, signal: null } })).toEqual({ cls: "st-exited", text: "kod 0" });
    expect(rowState({ exited: { code: 0, signal: "15" } })).toEqual({ cls: "st-exited", text: "sygnał 15" });
    expect(rowState({ unread: true })).toEqual({ cls: "st-unread", text: "nowe wyjście" });
    expect(rowState({ working: true, unread: true })).toEqual({ cls: "st-working", text: "pracuje" });
  });

  it("kropka projektu: nieprzeczytane wygrywa z pracą", () => {
    expect(projectState([])).toBe("");
    expect(projectState([{}, {}])).toBe("");
    expect(projectState([{}, { working: true }])).toBe("has-work");
    expect(projectState([{ working: true }, { unread: true }])).toBe("has-unread");
  });

  it("exitText: kod albo sygnał", () => {
    expect(exitText({ code: 1, signal: null })).toBe("kod 1");
    expect(exitText({ code: 0, signal: "TERM" })).toBe("sygnał TERM");
  });
});
