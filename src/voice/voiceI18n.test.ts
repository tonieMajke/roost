import { afterEach, describe, expect, it } from "vitest";
import { setLang } from "../i18n";
import { fmtMs, parseTtsConfig, speakable } from "./voice";
import { finishedNote, voiceToolLabel } from "./tools";

afterEach(() => setLang("pl"));

describe("voice po angielsku", () => {
  it("komunikaty czyste", () => {
    setLang("en");
    expect(speakable("a\n```x\n1\n```\nb")).toBe("a (code omitted) b");
    expect(fmtMs(1400)).toBe("1.4 s");
    expect(parseTtsConfig("[]").errors).toEqual(["tts.json: is not an object"]);
    expect(finishedNote({ agent: "claude", title: "", project: "X" })).toBe("claude in project X has finished.");
  });
  it("etykiety z liczbą mnogą", () => {
    setLang("en");
    expect(voiceToolLabel("open_panes", { tasks: [1, 2] })).toBe("opening 2 panes");
    setLang("pl");
    expect(voiceToolLabel("open_panes", { tasks: [1] })).toBe("otwiera 1 panel");
  });
});
