import { describe, expect, it } from "vitest";
import { DEFAULT_AGENTS } from "./agents";
import { BUILT_IN_PRESETS } from "./presets";
import { SHELL_PRESET, agentRows, presetChoices, usablePresets } from "./firstrun";

const rows = (available: Record<string, boolean>) => agentRows(DEFAULT_AGENTS, available);

describe("agentRows", () => {
  it("oznacza dostępność po tekście komendy i dodaje komendę instalacji znanym programom", () => {
    const r = rows({ claude: true, pi: false, $SHELL: true });
    expect(r.map((x) => [x.id, x.ok])).toEqual([["claude", true], ["pi", false], ["shell", true]]);
    expect(r[0].install).toContain("claude-code");
    expect(r[1].install).toBeUndefined();
  });

  it("brak klucza w wyniku = niedostępny", () => {
    expect(rows({}).every((x) => !x.ok)).toBe(true);
  });
});

describe("presetChoices", () => {
  it("zostawia tylko presety, w których każdy agent jest dostępny", () => {
    const r = rows({ claude: true, pi: false, $SHELL: true });
    expect(usablePresets(BUILT_IN_PRESETS, r).map((p) => p.name)).toEqual(["4× Claude"]);
  });

  it("wszystko dostępne = wszystkie wbudowane, w tej samej kolejności", () => {
    const r = rows({ claude: true, pi: true, $SHELL: true });
    expect(presetChoices(BUILT_IN_PRESETS, r)).toEqual(BUILT_IN_PRESETS);
  });

  it("bez agentów CLI zostaje sama powłoka", () => {
    const r = rows({ $SHELL: true });
    expect(presetChoices(BUILT_IN_PRESETS, r)).toEqual([SHELL_PRESET]);
  });

  it("bez niczego lista jest pusta (projekt bez paneli)", () => {
    expect(presetChoices(BUILT_IN_PRESETS, rows({}))).toEqual([]);
  });
});
