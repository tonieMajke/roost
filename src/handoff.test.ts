import { describe, expect, it } from "vitest";
import { HANDOFF_MAX_CHARS, handoffText, type Handoff } from "./handoff";

const src = { agent: "Claude", project: "demo", projectPath: "~/demo", home: "/home/u" };
const empty: Handoff = { prompts: [], replies: [], files: [], commands: [] };

describe("handoffText", () => {
  it("sekcje, ścieżki względne, na końcu miejsce na polecenie", () => {
    const text = handoffText(
      {
        prompts: ["napraw testy", "a teraz\nlint"],
        replies: ["Gotowe."],
        files: ["/home/u/demo/src/a.ts", "/etc/hosts"],
        commands: ["pnpm test"],
      },
      src,
    );
    expect(text).toContain("(Claude · demo)");
    expect(text).toContain("## Ostatnie polecenia użytkownika\n- napraw testy\n- a teraz\n  lint");
    expect(text).toContain("## Zmienione pliki\n- src/a.ts\n- /etc/hosts");
    expect(text).toContain("## Polecenia powłoki\n- `pnpm test`");
    expect(text.endsWith("Moje polecenie: ")).toBe(true);
    expect(text).not.toContain("\r");
  });

  it("puste sekcje znikają", () => {
    const text = handoffText({ ...empty, prompts: ["hej"] }, src);
    expect(text).not.toContain("## Ostatnie odpowiedzi");
    expect(text).not.toContain("## Zmienione pliki");
  });

  it("za długi: najpierw odpadają stare odpowiedzi, potem stare prompty", () => {
    const long = "x".repeat(1500);
    const h: Handoff = { ...empty, prompts: ["p1", "p2", "p3"], replies: [long, long, long, "ostatnia"] };
    const text = handoffText({ ...h, replies: [...h.replies, long, long] }, src);
    expect(text.length).toBeLessThanOrEqual(HANDOFF_MAX_CHARS);
    expect(text).toContain("ostatnia");
    expect(text).toContain("- p1"); // prompty zostają, póki odpowiedzi wystarczy

    const huge = "y".repeat(3000);
    const t2 = handoffText({ ...empty, prompts: [huge, huge, huge, "najnowszy"] }, src);
    expect(t2.length).toBeLessThanOrEqual(HANDOFF_MAX_CHARS);
    expect(t2).toContain("najnowszy");
  });
});
