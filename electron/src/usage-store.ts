//! Dziennik zużycia z Czatu i Botów: `usage.jsonl` w `configDir()`, jedna linia na wywołanie modelu.
//! Dziennik przeżywa usunięcie czatu; do UI idą wiersze zsumowane do dni (`mergeRows`).

import fs from "node:fs";
import path from "node:path";
import type { ProviderDef } from "../../src/chat";
import { dayOf, isEmptyUsage, mergeRows, normalizeModel, tokenCount, type Usage, type UsageRow, type UsageSource } from "../../src/usage";

const FILE = "usage.jsonl";

export type LedgerEntry = {
  ts: number;
  source: Exclude<UsageSource, "pane">;
  provider: string;
  model: string;
  usage: Usage;
  costUsd?: number;
  /** Czat albo bot (id), do późniejszego rozbicia; nie trafia do wierszy. */
  ref?: string;
};

/** Czat z `claude-cli` i panel z Claude Code to ten sam „dostawca”: stąd wspólna nazwa programu. */
export function providerLabel(p: Pick<ProviderDef, "id" | "kind">): string {
  if (p.kind === "claude-cli") return "claude";
  if (p.kind === "codex-cli") return "codex";
  return p.id;
}

export class UsageLedger {
  private file: string;

  constructor(dir: string) {
    this.file = path.join(dir, FILE);
  }

  /** Dopisuje wywołanie; puste zużycie pomija. Błąd zapisu nie może przerwać odpowiedzi czatu. */
  record(e: LedgerEntry): void {
    if (isEmptyUsage(e.usage)) return;
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      fs.appendFileSync(this.file, `${JSON.stringify({ ...e, model: normalizeModel(e.model) })}\n`);
    } catch (err) {
      console.error(`usage: ${this.file}: ${String(err)}`);
    }
  }

  rows(): UsageRow[] {
    let text: string;
    try {
      text = fs.readFileSync(this.file, "utf8");
    } catch {
      return [];
    }
    return ledgerRows(text);
  }
}

/** Wiersze z treści dziennika; uszkodzone linie (np. urwana przy awarii) są pomijane. */
export function ledgerRows(text: string): UsageRow[] {
  const rows: UsageRow[] = [];
  for (const line of text.split("\n")) {
    if (!line) continue;
    let e: Partial<LedgerEntry>;
    try {
      e = JSON.parse(line) as Partial<LedgerEntry>;
    } catch {
      continue;
    }
    if (typeof e.ts !== "number" || !e.usage || typeof e.provider !== "string" || typeof e.model !== "string") continue;
    if (e.source !== "chat" && e.source !== "bot") continue;
    const u = e.usage;
    rows.push({
      day: dayOf(e.ts),
      source: e.source,
      provider: e.provider,
      model: e.model,
      input: tokenCount(u.input),
      output: tokenCount(u.output),
      cacheRead: tokenCount(u.cacheRead),
      cacheWrite: tokenCount(u.cacheWrite),
      reasoning: tokenCount(u.reasoning),
      ...(typeof e.costUsd === "number" && e.costUsd > 0 ? { costUsd: e.costUsd } : {}),
      n: 1,
    });
  }
  return mergeRows(rows);
}
