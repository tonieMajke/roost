import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import * as nodePty from "node-pty";
import { directExec, execPlan, FD_GUARD_JS, guardFds } from "./fd-guard";
import { runProc } from "./bot/proc";
import { Ptys } from "./pty";

const LINUX = process.platform === "linux";
const ENV = { PATH: "/usr/bin:/bin", HOME: "/home/ja" };
const yes = () => true;

/** Deskryptory ≥ 3 tego procesu bez O_CLOEXEC: numer → cel. */
function leaky(): Map<number, string> {
  const out = new Map<number, string>();
  for (const name of fs.readdirSync("/proc/self/fd")) {
    const fd = Number(name);
    if (fd < 3) continue;
    try {
      const flags = /^flags:\s*([0-7]+)/m.exec(fs.readFileSync(`/proc/self/fdinfo/${fd}`, "latin1"))?.[1];
      if (flags !== undefined && (parseInt(flags, 8) & 0o2000000) === 0) out.set(fd, fs.readlinkSync(`/proc/self/fd/${fd}`));
    } catch {
      // zamknięty w międzyczasie
    }
  }
  return out;
}

/** Deskryptory ≥ 3 powłoki z wyjścia `ls -l /proc/$$/fd` (ls jako osobny proces, nie exec). */
const LIST_FDS = "ls -l /proc/$$/fd; echo END";
const fdsAbove2 = (out: string) =>
  [...out.replaceAll("\r", "").matchAll(/ (\d+) -> (.*)$/gm)].filter((m) => Number(m[1]) > 2).map((m) => `${m[1]} -> ${m[2]}`);

describe("guardFds", () => {
  it("poza Linuksem bez zmian (Windows: ConPTY i spawnPlan jak dotąd)", () => {
    for (const platform of ["win32", "darwin"] as const) {
      expect(guardFds("claude", ["-p"], ENV, { platform, exists: yes, direct: yes })).toEqual({ command: "claude", args: ["-p"], env: ENV });
    }
    const win = execPlan("cmd.exe", ["/c", "echo"], ENV, { platform: "win32" });
    expect(win.env).toBe(ENV);
  });

  it("Linux: program z PATH przez strażnika, argv[0] i argumenty bez zmian", () => {
    const g = guardFds("claude", ["--model", "a b", "-x"], ENV, {
      platform: "linux",
      execPath: "/opt/roost/roost-app",
      exists: (f) => f === "/usr/bin/claude",
      direct: yes,
    });
    expect(g.command).toBe("/opt/roost/roost-app");
    expect(g.args).toEqual(["--no-warnings", "-e", FD_GUARD_JS, "--", "/usr/bin/claude", "claude", "--model", "a b", "-x"]);
    expect(g.env).toEqual({ ...ENV, ELECTRON_RUN_AS_NODE: "1" });
    expect(ENV).not.toHaveProperty("ELECTRON_RUN_AS_NODE");
  });

  it("ścieżka względna względem katalogu dziecka", () => {
    const g = guardFds("./run.sh", [], ENV, { platform: "linux", cwd: "/proj", exists: (f) => f === "/proj/run.sh", direct: yes });
    expect(g.args.slice(4)).toEqual(["/proj/run.sh", "./run.sh"]);
  });

  it("bez strażnika: brak programu (ENOENT zgłasza spawn), plik nie do execve, ELECTRON_RUN_AS_NODE w env", () => {
    const same = (command: string, env: Record<string, string>, o: { exists?: (f: string) => boolean; direct?: (f: string) => boolean }) =>
      expect(guardFds(command, [], env, { platform: "linux", ...o })).toEqual({ command, args: [], env });
    same("nie-ma-takiego", ENV, { exists: () => false, direct: yes });
    same("skrypt", ENV, { exists: yes, direct: () => false });
    same("claude", { ...ENV, ELECTRON_RUN_AS_NODE: "1" }, { exists: yes, direct: yes });
  });
});

describe.skipIf(!LINUX)("directExec", () => {
  it("ELF i #! z istniejącym interpreterem tak, skrypt bez #! i brakujący interpreter nie", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "roost-fdg-"));
    try {
      const file = (name: string, text: string) => {
        const f = path.join(dir, name);
        fs.writeFileSync(f, text, { mode: 0o755 });
        return f;
      };
      expect(directExec(fs.realpathSync("/bin/sh"))).toBe(true);
      expect(directExec(file("ok", "#!/bin/sh\necho\n"))).toBe(true);
      expect(directExec(file("ok-space", "#! /bin/sh -e\n"))).toBe(true);
      expect(directExec(file("bare", "echo bez shebanga\n"))).toBe(false);
      expect(directExec(file("missing", "#!/nie/ma/interpretera\n"))).toBe(false);
      expect(directExec(file("relative", "#!python\n"))).toBe(false);
      expect(directExec(path.join(dir, "brak"))).toBe(false);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

/** Rodzic ma deskryptor bez O_CLOEXEC: master pseudoterminala z node-pty (openpty go nie oznacza), tak jak
 *  w aplikacji każdy otwarty panel i pliki Chromium z montowania AppImage. */
describe.skipIf(!LINUX)("dziecko nie dziedziczy deskryptorów (Linux)", () => {
  async function withOpenPane(test: (leaks: Map<number, string>) => Promise<void>) {
    const ptys = new Ptys();
    const id = ptys.spawn({ command: "/bin/sh", args: ["-c", "cat"], cols: 80, rows: 24 }, () => {}, () => {});
    try {
      const leaks = leaky();
      expect([...leaks.values()]).toContain("/dev/ptmx");
      await test(leaks);
    } finally {
      ptys.kill(id);
    }
  }

  it("bez strażnika node-pty i child_process przekazują deskryptor (przyczyna)", async () => {
    await withOpenPane(async () => {
      const direct = spawnSync("/bin/sh", ["-c", LIST_FDS], { encoding: "utf8" });
      expect(fdsAbove2(direct.stdout).join("\n")).toContain("/dev/ptmx");
      const out = await new Promise<string>((resolve) => {
        let text = "";
        const p = nodePty.spawn("/bin/sh", ["-c", LIST_FDS], { cols: 200, rows: 24, env: { PATH: "/usr/bin:/bin" } });
        p.onData((d) => (text += d));
        p.onExit(() => resolve(text));
      });
      expect(fdsAbove2(out).join("\n")).toContain("/dev/ptmx");
    });
  });

  it("panel (Ptys) widzi tylko 0–2", async () => {
    await withOpenPane(async () => {
      const ptys = new Ptys();
      let out = "";
      const dec = new TextDecoder();
      const code = await new Promise<number>((resolve) =>
        ptys.spawn({ command: "/bin/sh", args: ["-c", LIST_FDS], cols: 200, rows: 24 }, (c) => (out += dec.decode(c, { stream: true })), (e) => resolve(e.code)),
      );
      expect(code).toBe(0);
      expect(out).toContain("END");
      expect(fdsAbove2(out)).toEqual([]);
    });
  });

  it("polecenie bota (child_process) widzi tylko 0–2", async () => {
    await withOpenPane(async () => {
      const r = await runProc("/bin/sh", ["-c", LIST_FDS], { cwd: os.tmpdir(), timeoutMs: 5000, maxBytes: 1 << 16, signal: new AbortController().signal, env: { PATH: "/usr/bin:/bin" } });
      expect(r.code).toBe(0);
      expect(r.out).toContain("END");
      expect(fdsAbove2(r.out)).toEqual([]);
    });
  });

  it("strażnik zachowuje argv[0], argumenty, środowisko i katalog; brak ELECTRON_RUN_AS_NODE", () => {
    const env = { PATH: "/usr/bin:/bin", ROOST_X: "a b=c" };
    const plan = execPlan("sh", ["-c", 'printf "%s|" "$0" "$1" "$ROOST_X" "${ELECTRON_RUN_AS_NODE-brak}" "$(pwd -P)"', "zero", "jeden dwa"], env, { cwd: "/" });
    expect(plan.command).toBe(process.execPath);
    const r = spawnSync(plan.command, plan.args, { cwd: "/", env: plan.env, encoding: "utf8" });
    expect(r.stderr).toBe("");
    expect(r.stdout).toBe("zero|jeden dwa|a b=c|brak|/|");
  });
});
