/** „Kontynuuj gdzie indziej” (konta, etap 5): dokąd można przenieść rozmowę panelu. Czyste. */
import { accountById, accountKind, accountsFor, pickAccountId, type Accounts } from "./accounts";
import type { AgentDef } from "./agents";
import type { Pane } from "./workspace";

/** `account`: id konta nowego panelu; `undefined` = własny folder agenta. */
export type ContinueTarget = { agentId: string; account?: string; label: string };

const withAccount = (agent: AgentDef, accounts: Accounts, id: string | undefined) => {
  const name = accountById(accounts, id)?.name;
  return name ? `${agent.name} · ${name}` : agent.name;
};

/**
 * Cele dla panelu `src`: najpierw ten sam agent na innym koncie (w tym na „domyślnym”, gdy panel jest
 * na koncie), potem inni agenci, którzy prowadzą rozmowę (mają `session` albo konta). Powłoka odpada.
 * Inny agent dostaje swoje konto domyślne, tak jak w „Nowy panel”.
 */
export function continueTargets(src: Pane, agents: AgentDef[], accounts: Accounts): ContinueTarget[] {
  const own = agents.find((a) => a.id === src.agentId);
  const out: ContinueTarget[] = [];
  const kind = accountKind(own);
  if (own && kind !== null) {
    const choices: (string | undefined)[] = [undefined, ...accountsFor(accounts, kind).map((a) => a.id)];
    for (const id of choices) {
      if (id === src.account) continue;
      const label = id === undefined ? `${own.name} · domyślne konto` : withAccount(own, accounts, id);
      out.push({ agentId: own.id, ...(id !== undefined && { account: id }), label });
    }
  }
  for (const agent of agents) {
    if (agent.id === src.agentId || (!agent.session && accountKind(agent) === null)) continue;
    const id = pickAccountId(accounts, accountKind(agent), null);
    out.push({ agentId: agent.id, ...(id !== undefined && { account: id }), label: withAccount(agent, accounts, id) });
  }
  return out;
}
