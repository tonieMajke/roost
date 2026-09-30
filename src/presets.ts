import type { Preset } from "./workspace";

/** Presety wbudowane: w kodzie, nie w pliku (własne są w `workspace.presets`). */
export const BUILT_IN_PRESETS: Preset[] = [
  { name: "Claude + pi", agents: ["claude", "pi"] },
  { name: "2× Claude + 2× pi", agents: ["claude", "claude", "pi", "pi"] },
  { name: "4× Claude", agents: ["claude", "claude", "claude", "claude"] },
];

export type PresetPlan = {
  /** Agenci z presetu, których da się uruchomić, w kolejności z presetu. */
  agents: string[];
  /** Agenci z presetu, których nie ma w konfiguracji (bez duplikatów) — do komunikatu. */
  skipped: string[];
  /** Ile paneli z presetu nie zmieściło się do limitu — do komunikatu. */
  dropped: number;
};

/** Co faktycznie dodamy: pomijamy nieznanych agentów, ucinali do wolnych miejsc. */
export function planPreset(preset: Preset, knownAgentIds: string[], slots: number): PresetPlan {
  const known = new Set(knownAgentIds);
  const agents: string[] = [];
  const skipped: string[] = [];
  let dropped = 0;
  const room = Math.max(0, Math.floor(slots));
  for (const id of preset.agents) {
    if (!known.has(id)) {
      if (!skipped.includes(id)) skipped.push(id);
      continue;
    }
    if (agents.length >= room) {
      dropped += 1;
      continue;
    }
    agents.push(id);
  }
  return { agents, skipped, dropped };
}
