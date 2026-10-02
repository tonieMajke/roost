/** Okno pierwszego uruchomienia: stan agentów i dobór presetu. Czyste funkcje, bez UI i bez backendu. */

import type { AgentDef } from "./agents";
import type { Preset } from "./workspace";

export type AgentRow = {
  id: string;
  name: string;
  command: string;
  ok: boolean;
  /** Komenda instalacji, gdy ją znamy; brak = tylko ogólna wskazówka w UI. */
  install?: string;
};

/** Znane programy; nieznanym agentom z `agents.json` nie podpowiadamy instalacji. */
const INSTALL: Record<string, string> = {
  claude: "npm install -g @anthropic-ai/claude-code",
  codex: "npm install -g @openai/codex",
};

/** Wiersz na agenta; `available` = wynik `backend.commandsAvailable` (brak klucza = nieznany, czyli niedostępny). */
export function agentRows(agents: AgentDef[], available: Record<string, boolean>): AgentRow[] {
  return agents.map((a) => ({
    id: a.id,
    name: a.name,
    command: a.command,
    ok: available[a.command] === true,
    ...(INSTALL[a.command] ? { install: INSTALL[a.command] } : {}),
  }));
}

/** Presety, które da się uruchomić w całości (każdy agent dostępny); kolejność jak na wejściu. */
export function usablePresets(presets: Preset[], rows: AgentRow[]): Preset[] {
  const ok = new Set(rows.filter((r) => r.ok).map((r) => r.id));
  return presets.filter((p) => p.agents.length > 0 && p.agents.every((id) => ok.has(id)));
}

/** Zawsze dostępny zapas: sama powłoka, gdy nie ma żadnego agenta CLI. */
export const SHELL_PRESET: Preset = { name: "Terminal", agents: ["shell"] };

/** Lista do wyboru: użyteczne wbudowane presety, a gdy żadnego nie ma i powłoka działa, sama powłoka. */
export function presetChoices(presets: Preset[], rows: AgentRow[]): Preset[] {
  const usable = usablePresets(presets, rows);
  if (usable.length > 0) return usable;
  return usablePresets([SHELL_PRESET], rows);
}
