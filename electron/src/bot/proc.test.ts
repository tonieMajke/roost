import { describe, expect, it } from "vitest";
import { botEnv, runProc, stripSecrets } from "./proc";

const opts = (extra: Partial<Parameters<typeof runProc>[2]> = {}) => ({ cwd: "/tmp", timeoutMs: 5000, maxBytes: 1024, signal: new AbortController().signal, ...extra });

describe("runProc", () => {
  it("stdout i stderr, kod wyjścia", async () => {
    const r = await runProc("/bin/sh", ["-c", "echo out; echo err >&2; exit 3"], opts());
    expect(r.out).toContain("out");
    expect(r.out).toContain("err");
    expect(r.code).toBe(3);
  });
  it("wyjście ucięte do limitu", async () => {
    const r = await runProc("/bin/sh", ["-c", "head -c 5000 /dev/zero | tr '\\0' a"], opts({ maxBytes: 100 }));
    expect(r.out).toHaveLength(100);
    expect(r.truncated).toBe(true);
  });
  it("limit czasu zabija całą grupę, też dziecko powłoki", async () => {
    const t = Date.now();
    const r = await runProc("/bin/sh", ["-c", "sleep 30 & echo $!; wait"], opts({ timeoutMs: 300 }));
    expect(r.timedOut).toBe(true);
    expect(Date.now() - t).toBeLessThan(3000);
    const child = Number(r.out.trim());
    expect(() => process.kill(child, 0)).toThrow();
  });
  it("Stop przerywa", async () => {
    const ctl = new AbortController();
    setTimeout(() => ctl.abort(), 100);
    const r = await runProc("/bin/sh", ["-c", "sleep 30"], opts({ signal: ctl.signal }));
    expect(r.signal).toBe("SIGTERM");
  });
  it("brak programu = odrzucenie", async () => {
    await expect(runProc("nie-ma-takiego-programu-xyz", [], opts())).rejects.toThrow("nie uruchomiono");
  });
});

describe("botEnv", () => {
  it("bez kluczy aplikacji i zmiennych Electrona", () => {
    const env = botEnv({ PATH: "/usr/bin", AW_CHAT_API_KEY: "sk", AW_BOT_TOKEN: "t", ELECTRON_RUN_AS_NODE: "1", HOME: "/h" });
    expect(env).toEqual({ PATH: "/usr/bin", HOME: "/h" });
  });
});

describe("stripSecrets", () => {
  it("usuwa sekrety i agenty kluczy", () => {
    const secrets = ["OPENROUTER_API_KEY", "ANTHROPIC_API_KEY", "OPENAI_API_KEY", "GEMINI_API_KEY", "GOOGLE_API_KEY", "GROQ_API_KEY", "MISTRAL_API_KEY", "DEEPSEEK_API_KEY", "XAI_API_KEY", "GITHUB_TOKEN", "GH_TOKEN", "AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY", "AWS_PROFILE", "AZURE_CLIENT_ID", "GOOGLE_APPLICATION_CREDENTIALS", "SSH_AUTH_SOCK", "GPG_AGENT_INFO", "DB_PASSWORD", "npm_config_token"];
    const base = Object.fromEntries(secrets.map((k) => [k, "x"]));
    expect(stripSecrets(base)).toEqual({});
  });
  it("zostawia niesekretne, też podobne z nazwy", () => {
    const keep = { PATH: "/usr/bin", HOME: "/h", LANG: "pl", TERM: "xterm", DISPLAY: ":0", WAYLAND_DISPLAY: "w", XDG_RUNTIME_DIR: "/r", USER: "u", SHELL: "/bin/fish", TMPDIR: "/t", KUBECONFIG: "/k", TOKENIZERS_PARALLELISM: "false", KEYBOARD_LAYOUT: "pl", SECRETARY: "x", MONKEY: "1" };
    expect(stripSecrets(keep)).toEqual(keep);
  });
  it("extraHidden: własny keyEnv spoza wzorca", () => {
    expect(stripSecrets({ MYPROVIDER_PASS: "x", PATH: "/p" }, ["MYPROVIDER_PASS"])).toEqual({ PATH: "/p" });
  });
  it("botEnv usuwa domyślne keyEnv dostawców", () => {
    expect(botEnv({ PATH: "/p", CORTECS_API_KEY: "k", OPENAI_API_KEY: "k" })).toEqual({ PATH: "/p" });
  });
});
