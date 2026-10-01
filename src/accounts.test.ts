import { describe, expect, it } from "vitest";
import { DEFAULT_AGENTS, type AgentDef } from "./agents";
import { accountById, accountEnv, pickAccountId, accountKind, accountsFor, parseAccounts, resolveAccount, type Accounts } from "./accounts";

const agent = (id: string) => DEFAULT_AGENTS.find((a) => a.id === id)!;

const sample: Accounts = {
  accounts: [
    { id: "a", name: "Praca", kind: "claude", dir: "~/.claude-praca" },
    { id: "b", name: "Prywatne", kind: "claude", dir: "~/.claude-priv" },
    { id: "c", name: "Codex 2", kind: "codex", dir: "~/.codex-2" },
  ],
  defaults: { claude: "a" },
};

describe("accountKind", () => {
  it("claude and codex, also by full path; others none", () => {
    expect(accountKind(agent("claude"))).toBe("claude");
    expect(accountKind({ ...agent("claude"), command: "/usr/bin/codex" } as AgentDef)).toBe("codex");
    expect(accountKind(agent("pi"))).toBeNull();
    expect(accountKind(undefined)).toBeNull();
  });
});

describe("parseAccounts", () => {
  it("reads accounts and defaults", () => {
    expect(parseAccounts(sample)).toEqual({ value: sample, errors: [] });
  });

  it("empty or wrong input gives no accounts", () => {
    expect(parseAccounts(null).value).toEqual({ accounts: [], defaults: {} });
    expect(parseAccounts({ accounts: 5 }).errors).toHaveLength(1);
  });

  it("skips bad entries and duplicates, drops defaults that point nowhere", () => {
    const { value, errors } = parseAccounts({
      accounts: [
        { id: "a", name: "A", kind: "claude", dir: "/x" },
        { id: "a", name: "A2", kind: "claude", dir: "/y" },
        { id: "z", name: "Z", kind: "gemini", dir: "/z" },
        { id: "n", kind: "claude", dir: "/n" },
        "text",
      ],
      defaults: { claude: "a", codex: "a" },
    });
    expect(value.accounts.map((a) => a.id)).toEqual(["a"]);
    expect(value.defaults).toEqual({ claude: "a" });
    expect(errors).toHaveLength(5);
  });
});

describe("resolveAccount", () => {
  it("pane beats project beats default", () => {
    expect(resolveAccount(sample, "claude", { pane: "b", project: "a" })?.id).toBe("b");
    expect(resolveAccount(sample, "claude", { project: "b" })?.id).toBe("b");
    expect(resolveAccount(sample, "claude", {})?.id).toBe("a");
  });

  it("ignores ids of another kind or of removed accounts", () => {
    expect(resolveAccount(sample, "claude", { pane: "c" })?.id).toBe("a");
    expect(resolveAccount(sample, "claude", { pane: "gone" })?.id).toBe("a");
    expect(resolveAccount(sample, "codex", { pane: "a" })).toBeUndefined();
  });

  it("agents without accounts get none", () => {
    expect(resolveAccount(sample, null, { pane: "a" })).toBeUndefined();
  });
});

describe("accountEnv", () => {
  it("sets the agent's own variable, nothing for the default account", () => {
    expect(accountEnv(sample.accounts[0])).toEqual([["CLAUDE_CONFIG_DIR", "~/.claude-praca"]]);
    expect(accountEnv(sample.accounts[2])).toEqual([["CODEX_HOME", "~/.codex-2"]]);
    expect(accountEnv(undefined)).toEqual([]);
  });
});

describe("accountsFor", () => {
  it("lists accounts of the kind", () => {
    expect(accountsFor(sample, "claude").map((a) => a.id)).toEqual(["a", "b"]);
    expect(accountsFor(sample, null)).toEqual([]);
  });
});

describe("pickAccountId", () => {
  it("untouched choice takes the default of the kind", () => {
    expect(pickAccountId(sample, "claude", null)).toBe("a");
    expect(pickAccountId(sample, "codex", null)).toBeUndefined();
  });

  it("empty choice is the agent's own folder, an id picks that account", () => {
    expect(pickAccountId(sample, "claude", "")).toBeUndefined();
    expect(pickAccountId(sample, "claude", "b")).toBe("b");
  });

  it("unknown ids, other kinds and agents without accounts give none", () => {
    expect(pickAccountId(sample, "claude", "gone")).toBeUndefined();
    expect(pickAccountId(sample, "claude", "c")).toBeUndefined();
    expect(pickAccountId(sample, null, "a")).toBeUndefined();
  });
});

describe("accountById", () => {
  it("finds by id", () => {
    expect(accountById(sample, "b")?.name).toBe("Prywatne");
    expect(accountById(sample, undefined)).toBeUndefined();
  });
});
