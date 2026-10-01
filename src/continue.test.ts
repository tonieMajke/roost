import { describe, expect, it } from "vitest";
import { DEFAULT_AGENTS, type AgentDef } from "./agents";
import type { Accounts } from "./accounts";
import { continueTargets } from "./continue";
import type { Pane } from "./workspace";

const codex: AgentDef = { id: "codex", name: "Codex", command: "codex" };
const agents = [...DEFAULT_AGENTS, codex];
const accounts: Accounts = {
  accounts: [
    { id: "praca", name: "Praca", kind: "claude", dir: "~/.c1" },
    { id: "priv", name: "Prywatne", kind: "claude", dir: "~/.c2" },
    { id: "cx", name: "Codex 2", kind: "codex", dir: "~/.x" },
  ],
  defaults: { codex: "cx" },
};
const pane = (extra: Partial<Pane> = {}): Pane => ({ id: "p", agentId: "claude", run: 1, sessionId: "s", ...extra });

describe("continueTargets", () => {
  it("claude on its own folder: other claude accounts, then other agents, no shell", () => {
    expect(continueTargets(pane(), agents, accounts)).toEqual([
      { agentId: "claude", account: "praca", label: "Claude · Praca" },
      { agentId: "claude", account: "priv", label: "Claude · Prywatne" },
      { agentId: "pi", label: "pi" },
      { agentId: "codex", account: "cx", label: "Codex · Codex 2" },
    ]);
  });

  it("claude on an account: offers the default folder and the other account, not itself", () => {
    const labels = continueTargets(pane({ account: "praca" }), agents, accounts).map((t) => t.label);
    expect(labels.slice(0, 2)).toEqual(["Claude · domyślne konto", "Claude · Prywatne"]);
    expect(labels).not.toContain("Claude · Praca");
  });

  it("pi has no accounts, so only other agents", () => {
    expect(continueTargets(pane({ agentId: "pi" }), agents, accounts).map((t) => t.agentId)).toEqual(["claude", "codex"]);
  });

  it("without accounts it is just the other agents", () => {
    const none: Accounts = { accounts: [], defaults: {} };
    expect(continueTargets(pane(), agents, none).map((t) => t.label)).toEqual(["pi", "Codex"]);
  });
});
