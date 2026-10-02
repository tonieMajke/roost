// Test dymny zainstalowanego Roost na Windows (CI): prawdziwy instalator, prawdziwe okno,
// panele z PowerShellem, claude i codex w folderze ze spacją i polskimi znakami.
// Steruje stroną przez port debugowania Chromium (Playwright `connectOverCDP`): bezpiecznik
// `enableNodeCliInspectArguments` wyłącza `--inspect`, którego używa `_electron.launch`.
//
// node smoke/windows.mjs <ścieżka do Roost.exe> <katalog na wyniki>

import { spawn, spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright-core";

const [exe, outDir] = process.argv.slice(2);
if (!exe || !outDir) throw new Error("użycie: node smoke/windows.mjs <Roost.exe> <katalog wyników>");
fs.mkdirSync(outDir, { recursive: true });

const PORT = 9333;
const root = path.join(process.env.RUNNER_TEMP ?? process.env.TEMP, "rs");
const configDir = path.join(root, "config");
const project = path.join(root, "Zażółć gęślą", "projekt x");
const note = path.join(project, "notatka ł.txt");
fs.rmSync(root, { recursive: true, force: true });
fs.mkdirSync(configDir, { recursive: true });
fs.mkdirSync(project, { recursive: true });
fs.writeFileSync(note, "test\n");

fs.writeFileSync(
  path.join(configDir, "agents.json"),
  JSON.stringify({
    agents: [
      { id: "shell", name: "Terminal", command: "$SHELL" },
      {
        id: "claude", name: "Claude", command: "claude",
        session: { new: ["--session-id", "{session}"], resume: ["--resume", "{session}"], check: "claude" },
      },
      // CI działa jako administrator: codex odmawia wtedy serwera w tle
      { id: "codex", name: "Codex", command: "codex", args: ["--no-daemon"] },
    ],
  }),
);
const pane = (agentId, extra = {}) => ({ id: randomUUID(), agentId, run: 0, ...extra });
const panes = [pane("shell"), pane("claude", { sessionId: randomUUID() }), pane("codex")];
const projectId = randomUUID();
fs.writeFileSync(
  path.join(configDir, "workspace.json"),
  JSON.stringify({
    version: 1,
    projects: [{ id: projectId, name: "projekt x", path: project, panes, focused: panes[0].id, maximized: null }],
    active: projectId,
    presets: [],
  }),
);

const results = [];
let failed = false;
function report(name, ok, detail = "") {
  results.push(`${ok ? "OK  " : "BŁĄD"} ${name}${detail ? `\n       ${detail.replace(/\n/g, "\n       ")}` : ""}`);
  if (!ok) failed = true;
  console.log(results.at(-1));
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(what, fn, ms) {
  const end = Date.now() + ms;
  let last;
  while (Date.now() < end) {
    try {
      last = await fn();
      if (last) return last;
    } catch (e) {
      last = e;
    }
    await sleep(250);
  }
  throw new Error(`${what}: nie doczekano się w ${ms / 1000} s${last instanceof Error ? ` (${last.message})` : ""}`);
}

const appLog = fs.openSync(path.join(outDir, "roost.log"), "w");
const app = spawn(exe, [`--remote-debugging-port=${PORT}`], {
  env: { ...process.env, ROOST_CONFIG_DIR: configDir },
  stdio: ["ignore", appLog, appLog],
});
let appExit = null;
app.on("exit", (code, signal) => (appExit = { code, signal }));

let browser;
let page;
try {
  await until("port debugowania", async () => (await fetch(`http://127.0.0.1:${PORT}/json/version`)).ok, 60_000);
  browser = await chromium.connectOverCDP(`http://127.0.0.1:${PORT}`);
  page = await until(
    "okno aplikacji",
    () => browser.contexts().flatMap((c) => c.pages()).find((p) => p.url().startsWith("file:")),
    30_000,
  );
  const pageErrors = [];
  page.on("pageerror", (e) => pageErrors.push(String(e)));
  page.on("console", (m) => m.type() === "error" && pageErrors.push(m.text()));
  report("aplikacja startuje", true, page.url());

  const rows = (agent) => page.locator(`section.pane[data-ag="${agent}"] .xterm-rows`);
  const text = async (agent) => (await rows(agent).innerText()).replace(/ /g, " ");
  const exited = async (agent) =>
    (await page.locator(`section.pane[data-ag="${agent}"] .pane-exit`).count()) > 0
      ? await page.locator(`section.pane[data-ag="${agent}"] .pane-exit`).first().innerText()
      : null;
  // Wąski panel zawija linie (spacja na końcu wiersza znika): porównania bez białych znaków.
  const flat = (t) => t.replace(/\s+/g, "");
  const has = (t, s) => flat(t).includes(flat(s));

  await until("trzy panele", async () => (await page.locator("section.pane .xterm-rows").count()) === 3, 30_000);
  await page.screenshot({ path: path.join(outDir, "1-start.png") });

  // 1. Terminal: PowerShell pod ConPTY, polecenie z klawiatury, katalog z polskimi znakami.
  try {
    await until("prompt PowerShella", async () => /PS.+>/.test(flat(await text("shell"))), 60_000);
    await rows("shell").click();
    await page.keyboard.type(`Write-Output ("ROOST-" + (6*7)); (Get-Location).Path`);
    await page.keyboard.press("Enter");
    const out = await until("wynik polecenia", async () => {
      const t = await text("shell");
      return /^ROOST-42\s*$/m.test(t) && has(t, project) ? t : null;
    }, 30_000);
    report("Terminal: PowerShell, wpisane polecenie, cwd z polskimi znakami", true, out.trim().split("\n").slice(-4).join("\n"));
  } catch (e) {
    report("Terminal: PowerShell, wpisane polecenie, cwd z polskimi znakami", false, `${e.message}\n--- panel ---\n${await text("shell").catch(() => "")}\n--- koniec: ${await exited("shell")}`);
  }

  // 2. claude i codex z npm (shimy .cmd): proces żyje i coś rysuje (bez logowania: ekran powitalny).
  for (const agent of ["claude", "codex"]) {
    try {
      const t = await until(`${agent}: wyjście`, async () => {
        const end = await exited(agent);
        if (end) throw new Error(`proces zakończony: ${end}`);
        const t = (await text(agent)).trim();
        return t.length > 20 ? t : null;
      }, 60_000);
      await sleep(3000);
      const end = await exited(agent);
      if (end) throw new Error(`proces zakończony po starcie: ${end}`);
      if (/not recognized|nie jest rozpoznawane|ENOENT|Cannot find module/i.test(t)) throw new Error("błąd uruchomienia");
      report(`${agent}: panel uruchamia program z npm`, true, t.split("\n").filter((l) => l.trim()).slice(0, 4).join("\n"));
    } catch (e) {
      report(`${agent}: panel uruchamia program z npm`, false, `${e.message}\n--- panel ---\n${await text(agent).catch(() => "")}`);
    }
  }
  await page.screenshot({ path: path.join(outDir, "2-panele.png") });

  // 3. Wywołania procesu głównego tak, jak robi to strona.
  const invoke = (name, ...args) => page.evaluate(([n, a]) => window.agentsElectron.invoke(n, ...a), [name, args]);
  try {
    const found = await invoke("commands_available", ["claude", "codex", "git", "rg", "brak-takiego-programu"]);
    const ok = found.claude && found.codex && found.git && found.rg && !found["brak-takiego-programu"];
    report("wykrywanie programów (PATH + PATHEXT)", ok, JSON.stringify(found));
  } catch (e) {
    report("wykrywanie programów (PATH + PATHEXT)", false, e.message);
  }
  try {
    const got = await invoke("resolve_files", project, ["notatka ł.txt", note, note.toUpperCase(), "brak.txt"]);
    const ok = got[0] === note && got[1] === note && got[2] !== null && got[3] === null;
    report("ścieżki plików z terminala (Ctrl+klik)", ok, JSON.stringify(got));
  } catch (e) {
    report("ścieżki plików z terminala (Ctrl+klik)", false, e.message);
  }
  try {
    await invoke("notify", "Roost", "test dymny");
    report("powiadomienie", true);
  } catch (e) {
    report("powiadomienie", false, e.message);
  }
  // cmd.exe przez ConPTY w katalogu z polskimi znakami: polecenie `cd` wypisuje cwd.
  try {
    const out = await page.evaluate(
      (cwd) =>
        new Promise((resolve, reject) => {
          const dec = new TextDecoder();
          let buf = "";
          setTimeout(() => reject(new Error(`brak końca procesu; wyjście: ${buf}`)), 30_000);
          window.agentsElectron.spawnPty(
            { command: "cmd.exe", args: ["/d", "/c", "cd"], cwd, cols: 200, rows: 10 },
            (chunk) => (buf += dec.decode(chunk, { stream: true })),
            (info) => resolve({ buf, info }),
          );
        }),
      project,
    );
    report("cmd.exe w panelu, cwd z polskimi znakami", out.info.code === 0 && out.buf.includes(project), JSON.stringify(out));
  } catch (e) {
    report("cmd.exe w panelu, cwd z polskimi znakami", false, e.message);
  }

  const relevant = pageErrors.filter((e) => !/Autofill\./.test(e));
  report("bez błędów w konsoli strony", relevant.length === 0, relevant.join("\n"));

  // 4. Zamknięcie okna kończy aplikację i procesy paneli.
  const before = spawnSync("tasklist", ["/FO", "CSV", "/NH"], { encoding: "utf8" }).stdout;
  const count = (list, name) => list.split("\n").filter((l) => l.toLowerCase().startsWith(`"${name}`)).length;
  await page.evaluate(() => window.agentsElectron.invoke("win_close")).catch(() => {});
  try {
    await until("koniec aplikacji", () => appExit, 20_000);
    await sleep(2000);
    const after = spawnSync("tasklist", ["/FO", "CSV", "/NH"], { encoding: "utf8" }).stdout;
    const left = ["roost.exe", "powershell.exe", "claude.exe", "codex.exe", "conpty", "openconsole.exe"]
      .map((n) => [n, count(before, n), count(after, n)])
      .filter(([, , a]) => a > 0);
    report("zamknięcie okna kończy aplikację i panele", !left.some(([n]) => n === "roost.exe"), `po zamknięciu wciąż działa (przed/po): ${JSON.stringify(left)}`);
  } catch (e) {
    report("zamknięcie okna kończy aplikację i panele", false, e.message);
  }
} catch (e) {
  report("przebieg testu", false, e.stack ?? String(e));
  await page?.screenshot({ path: path.join(outDir, "blad.png") }).catch(() => {});
} finally {
  await browser?.close().catch(() => {});
  if (!appExit) spawnSync("taskkill", ["/PID", String(app.pid), "/T", "/F"]);
  fs.writeFileSync(path.join(outDir, "wyniki.txt"), `${results.join("\n")}\n`);
}

process.exit(failed ? 1 : 0);
