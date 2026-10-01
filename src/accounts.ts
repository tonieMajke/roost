/** Konta agentów (osobne foldery logowania Claude / Codex), `accounts.json`. Czyste, bez dostępu do dysku. */
import type { AgentDef } from "./agents";

export type AccountKind = "claude" | "codex";

/** `dir` to folder logowania agenta (`~/…` albo bezwzględny); aplikacja nie czyta z niego tokenów. */
export type AccountDef = { id: string; name: string; kind: AccountKind; dir: string };

/** `defaults`: id konta domyślnego dla rodzaju agenta; brak wpisu = konto domyślne samego agenta (bez zmiennej). */
export type Accounts = { accounts: AccountDef[]; defaults: Partial<Record<AccountKind, string>> };

export const NO_ACCOUNTS: Accounts = { accounts: [], defaults: {} };

/** Zmienna środowiskowa, którą agent czyta jako swój folder logowania. */
export const ACCOUNT_ENV: Record<AccountKind, string> = { claude: "CLAUDE_CONFIG_DIR", codex: "CODEX_HOME" };

const isKind = (v: unknown): v is AccountKind => v === "claude" || v === "codex";

/** Rodzaj agenta, który ma konta (po nazwie polecenia, jak `withClaudeSettings`); inne agenty: `null`. */
export function accountKind(agent: AgentDef | undefined): AccountKind | null {
  const cmd = agent?.command.split("/").pop();
  return isKind(cmd) ? cmd : null;
}

/** Parsuje `{accounts: [...], defaults: {...}}`; złe wpisy są pomijane i opisane w `errors`. */
export function parseAccounts(raw: unknown): { value: Accounts; errors: string[] } {
  const errors: string[] = [];
  const root = (typeof raw === "object" && raw !== null ? raw : {}) as { accounts?: unknown; defaults?: unknown };
  const list = Array.isArray(root.accounts) ? root.accounts : [];
  if (root.accounts !== undefined && !Array.isArray(root.accounts)) {
    errors.push("accounts.json: `accounts` must be a list, ignored");
  }

  const accounts: AccountDef[] = [];
  const seen = new Set<string>();
  list.forEach((entry, i) => {
    const where = `accounts[${i}]`;
    const e = (typeof entry === "object" && entry !== null ? entry : {}) as Record<string, unknown>;
    for (const field of ["id", "name", "dir"] as const) {
      if (typeof e[field] !== "string" || e[field] === "") {
        errors.push(`${where}: missing \`${field}\`, skipped`);
        return;
      }
    }
    if (!isKind(e.kind)) {
      errors.push(`${where}: \`kind\` must be "claude" or "codex", skipped`);
      return;
    }
    const id = e.id as string;
    if (seen.has(id)) {
      errors.push(`${where}: duplicate id \`${id}\`, skipped`);
      return;
    }
    seen.add(id);
    accounts.push({ id, name: e.name as string, kind: e.kind, dir: e.dir as string });
  });

  const defaults: Accounts["defaults"] = {};
  const d = (typeof root.defaults === "object" && root.defaults !== null ? root.defaults : {}) as Record<string, unknown>;
  for (const kind of ["claude", "codex"] as const) {
    const id = d[kind];
    if (id === undefined) continue;
    if (accounts.some((a) => a.id === id && a.kind === kind)) defaults[kind] = id as string;
    else errors.push(`defaults.${kind}: no such ${kind} account, ignored`);
  }
  return { value: { accounts, defaults }, errors };
}

/** Konta pasujące do rodzaju agenta (lista wyboru w „Nowy panel”). */
export function accountsFor(all: Accounts, kind: AccountKind | null): AccountDef[] {
  return kind === null ? [] : all.accounts.filter((a) => a.kind === kind);
}

/** Konto panelu: jego własne, inaczej projektu, inaczej domyślne rodzaju; `undefined` = konto domyślne agenta. */
export function resolveAccount(
  all: Accounts,
  kind: AccountKind | null,
  ids: { pane?: string; project?: string },
): AccountDef | undefined {
  if (kind === null) return undefined;
  for (const id of [ids.pane, ids.project, all.defaults[kind]]) {
    const hit = id === undefined ? undefined : all.accounts.find((a) => a.id === id && a.kind === kind);
    if (hit) return hit;
  }
  return undefined;
}

/** Zmienne dla `SpawnSpec.env`; bez konta nic, więc agent używa swojego domyślnego folderu. */
export function accountEnv(account: AccountDef | undefined): [string, string][] {
  return account ? [[ACCOUNT_ENV[account.kind], account.dir]] : [];
}
