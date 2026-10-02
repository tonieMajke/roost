import { describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { type ExitInfo, Ptys } from "./pty";

/** Czas na wyjście; PowerShell na maszynie CI z Windows startuje kilka sekund. */
const FIVE = process.platform === "win32" ? 20000 : 5000;
const sh = (script: string) => ({ command: "/bin/sh", args: ["-c", script], cols: 80, rows: 24 });
const WIN = process.platform === "win32";
const plain = (s: string) => s.replace(/\x1b\[[0-9;?]*[ -\/]*[@-~]|\x1b\][^\x07\x1b]*(\x07|\x1b\\)|\x1b[()][0-9A-Za-z]/g, "").replaceAll("\r", "");

function run(ptys: Ptys, spec: { command: string; args: string[]; cols: number; rows: number; cwd?: string }) {
  let out = "";
  const dec = new TextDecoder();
  let onOut: (() => void) | null = null;
  let exitInfo: ExitInfo | null = null;
  let resolveExit: (info: ExitInfo) => void = () => {};
  const exited = new Promise<ExitInfo>((resolve) => (resolveExit = resolve));
  const id = ptys.spawn(
    spec,
    (chunk) => {
      // Jak strona: `TextDecoder` przyjmuje tylko bajty (tekst z node-pty na Windows rzuca).
      out += dec.decode(chunk, { stream: true });
      onOut?.();
    },
    (info) => resolveExit((exitInfo = info)),
  );
  return {
    id,
    exited,
    /** Bez `\r` i sekwencji sterujących (ConPTY przerysowuje ekran kodami ANSI). */
    get out() {
      return plain(out);
    },
    get exit() {
      return exitInfo;
    },
    /** Czeka, aż wyjście pasuje do `re`. */
    waitFor(re: RegExp): Promise<RegExpMatchArray> {
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`brak ${re} w ${JSON.stringify(out)}`)), FIVE);
        const check = () => {
          const m = plain(out).match(re);
          if (m) {
            clearTimeout(timer);
            onOut = null;
            resolve(m);
          }
        };
        onOut = check;
        check();
      });
    },
  };
}

const alive = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

async function until(cond: () => boolean, what: string) {
  const deadline = Date.now() + FIVE;
  while (!cond()) {
    if (Date.now() > deadline) throw new Error(what);
    await new Promise((r) => setTimeout(r, 50));
  }
}

describe.skipIf(WIN)("pty", () => {
  it("kod wyjścia trafia do wywołania zwrotnego, wpis znika", async () => {
    const ptys = new Ptys();
    const p = run(ptys, sh("exit 7"));
    expect((await p.exited).code).toBe(7);
    expect(ptys.pid(p.id)).toBeUndefined();
  });

  it("cwd trafia do dziecka", async () => {
    const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "aw-cwd-")));
    try {
      const p = run(new Ptys(), { ...sh("pwd -P"), cwd: dir });
      expect((await p.exited).code).toBe(0);
      expect(p.out.trim()).toBe(dir);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("TERM i bez zmiennych Electrona", async () => {
    process.env.ELECTRON_RUN_AS_NODE = "1";
    try {
      const p = run(new Ptys(), sh('echo "T=$TERM C=$COLORTERM E=${ELECTRON_RUN_AS_NODE:-brak}"'));
      await p.exited;
      expect(p.out).toContain("T=xterm-256color C=truecolor E=brak");
    } finally {
      delete process.env.ELECTRON_RUN_AS_NODE;
    }
  });

  it("kill dociera do całej grupy procesów", async () => {
    const ptys = new Ptys();
    const p = run(ptys, sh("sleep 31 & echo MARKER-$!; wait"));
    const pid = Number((await p.waitFor(/MARKER-(\d+)/))[1]);
    expect(alive(pid)).toBe(true);
    expect(ptys.pid(p.id)).toBeDefined();
    ptys.kill(p.id);
    await until(() => !alive(pid), "sleep przeżył zabicie grupy");
  });

  it("killAllAsync zapomina panele od razu i zabija je później", async () => {
    // Kilka paneli naraz i zabicie od razu: część dzieci nie zdążyła jeszcze zrobić setsid.
    const ptys = new Ptys();
    const panes = Array.from({ length: 10 }, (_, i) => run(ptys, sh(`sleep ${32 + i}`)));
    const pids = panes.map((p) => ptys.pid(p.id)!);
    const started = Date.now();
    ptys.killAllAsync();
    expect(Date.now() - started).toBeLessThan(500);
    expect(panes.map((p) => ptys.pid(p.id))).toEqual(panes.map(() => undefined));
    await until(() => pids.every((p) => !alive(p)), "panel przeżył przeładowanie");
  });

  it("zapis trafia na stdin dziecka", async () => {
    const ptys = new Ptys();
    const p = run(ptys, sh("cat"));
    ptys.write(p.id, "hello-pipe\n");
    await p.waitFor(/hello-pipe/);
    ptys.kill(p.id);
  });

  it("sygnał zgłaszany nazwą", async () => {
    const p = run(new Ptys(), sh("kill -TERM $$"));
    expect((await p.exited).signal).toBe("SIGTERM");
  });
});

/** Windows (ConPTY): to samo zachowanie bez /bin/sh – kod wyjścia, stdin, zabicie drzewa. Przez cmd.exe:
 *  PowerShell pod ConPTY na maszynie CI potrafi nie wypisać nic przez dziesiątki sekund. */
describe.runIf(WIN)("pty (Windows)", () => {
  const cmd = (script: string) => ({ command: "cmd.exe", args: ["/d", "/c", script], cols: 80, rows: 24 });

  it("kod wyjścia; $SHELL bez zmiennej to PowerShell", async () => {
    const ptys = new Ptys();
    const p = run(ptys, cmd("exit 7"));
    expect((await p.exited).code).toBe(7);
    expect(ptys.pid(p.id)).toBeUndefined();
    const shell = run(ptys, { command: "$SHELL", args: ["-NoProfile", "-Command", "exit 3"], cols: 80, rows: 24 });
    expect((await shell.exited).code).toBe(3);
  }, 60000);

  it("zapis trafia na stdin dziecka", async () => {
    const ptys = new Ptys();
    const p = run(ptys, cmd("set /p L=& call echo ECHO-%L%"));
    ptys.write(p.id, "hello-pipe\r");
    await p.waitFor(/ECHO-hello-pipe/);
    await p.exited;
  }, 30000);

  it("kill kończy panel razem z dzieckiem (taskkill /T)", async () => {
    const ptys = new Ptys();
    const p = run(ptys, cmd("echo START& ping -n 31 127.0.0.1"));
    await p.waitFor(/START/);
    const pid = ptys.pid(p.id)!;
    ptys.kill(p.id);
    await p.exited;
    await until(() => !alive(pid), "cmd przeżył zabicie drzewa");
  }, 30000);
});
