import { afterEach, expect, test } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { installAndRelaunch, type Installer, readyOptions, replaceEnv, updatable } from "./updater";
import { setMainLang } from "./i18n";

afterEach(() => setMainLang("pl"));

test("Linux: tylko spakowany AppImage", () => {
  const o = { packaged: true, platform: "linux" as const, env: { APPIMAGE: "/home/x/Roost-0.0.2.AppImage" }, exePath: "/tmp/.mount_x/roost-app" };
  expect(updatable(o)).toBe(true);
  expect(updatable({ ...o, packaged: false })).toBe(false);
  expect(updatable({ ...o, env: {} })).toBe(false);
  expect(updatable({ ...o, env: { ...o.env, ROOST_NO_UPDATE: "1" } })).toBe(false);
});

test("Windows: instalacja NSIS tak, zip przenośny nie", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "roost-up-"));
  const o = { packaged: true, platform: "win32" as const, env: {}, exePath: path.join(dir, "Roost.exe") };
  expect(updatable(o)).toBe(false);
  fs.writeFileSync(path.join(dir, "Uninstall Roost.exe"), "");
  expect(updatable(o)).toBe(true);
  expect(updatable({ ...o, platform: "darwin" })).toBe(false);
});

test("okno gotowej aktualizacji w obu językach, przycisk 0 uruchamia ponownie", () => {
  expect(readyOptions("0.0.3").message).toBe("Roost 0.0.3 jest gotowy");
  setMainLang("en");
  const o = readyOptions("0.0.3");
  expect(o.buttons).toEqual(["Restart", "Later"]);
  expect(o.defaultId).toBe(0);
});

/** Udawany autoUpdater: `quitAndInstall` podmienia plik (inny i-węzeł), opcjonalnie pod nową nazwą. */
function fakeUpdater(inodes: Map<string, number>, install: { ok: boolean; renameTo?: string }) {
  const listeners: ((file: string) => void)[] = [];
  const up: Installer & { calls: boolean[]; listeners: typeof listeners } = {
    autoRunAppAfterInstall: true,
    calls: [],
    listeners,
    quitAndInstall() {
      up.calls.push(up.autoRunAppAfterInstall);
      if (!install.ok) return;
      inodes.delete("/home/u/Roost-0.0.4.AppImage");
      const dest = install.renameTo ?? "/home/u/Roost-0.0.4.AppImage";
      inodes.set(dest, 2);
      if (install.renameTo) for (const fn of [...listeners]) fn(dest);
    },
    once: (_e, fn) => listeners.push(fn),
    removeListener: (_e, fn) => void listeners.splice(listeners.indexOf(fn) >>> 0, 1),
  };
  return up;
}

const APP_ENV = () => ({
  APPIMAGE: "/home/u/Roost-0.0.4.AppImage",
  APPDIR: "/tmp/.mount_Roost-new",
  ARGV0: "/home/u/Roost-0.0.4.AppImage",
  OWD: "/home/u",
  APPIMAGE_SILENT_INSTALL: "true",
  CHROME_DESKTOP: "roost-app.desktop",
  HOME: "/home/u",
  PATH: "/tmp/.mount_Roost-new:/tmp/.mount_Roost-new/usr/sbin:/tmp/.mount_Roost-old:/home/u/.local/bin:/usr/bin",
  LD_LIBRARY_PATH: "/tmp/.mount_Roost-new/usr/lib:/tmp/.mount_Roost-old/usr/lib",
}) as NodeJS.ProcessEnv;

test("AppImage: instalacja bez uruchamiania przez updater, potem relaunch z czystym środowiskiem", () => {
  const inodes = new Map([["/home/u/Roost-0.0.4.AppImage", 1]]);
  const up = fakeUpdater(inodes, { ok: true, renameTo: "/home/u/Roost-0.0.5.AppImage" });
  const env = APP_ENV();
  const seen: string[] = [];
  const ok = installAndRelaunch(up, { env, ino: (f) => inodes.get(f) ?? null, relaunch: (p) => seen.push(`relaunch ${p}`), quit: () => seen.push("quit") });
  expect(ok).toBe(true);
  expect(up.calls).toEqual([false]);
  expect(up.listeners).toEqual([]);
  expect(seen).toEqual(["relaunch /home/u/Roost-0.0.5.AppImage", "quit"]);
  expect(env).toEqual({ HOME: "/home/u", PATH: "/home/u/.local/bin:/usr/bin" });
});

test("AppImage bez wersji w nazwie: ten sam plik, nowy i-węzeł", () => {
  const inodes = new Map([["/home/u/Roost-0.0.4.AppImage", 1]]);
  const seen: string[] = [];
  const ok = installAndRelaunch(fakeUpdater(inodes, { ok: true }), { env: APP_ENV(), ino: (f) => inodes.get(f) ?? null, relaunch: (p) => seen.push(p), quit: () => {} });
  expect(ok).toBe(true);
  expect(seen).toEqual(["/home/u/Roost-0.0.4.AppImage"]);
});

test("nieudana instalacja: bez relaunch, bez quit, środowisko nietknięte", () => {
  const inodes = new Map([["/home/u/Roost-0.0.4.AppImage", 1]]);
  const up = fakeUpdater(inodes, { ok: false });
  const env = APP_ENV();
  const seen: string[] = [];
  expect(installAndRelaunch(up, { env, ino: (f) => inodes.get(f) ?? null, relaunch: () => seen.push("relaunch"), quit: () => seen.push("quit") })).toBe(false);
  expect(seen).toEqual([]);
  expect(env).toEqual(APP_ENV());
  expect(up.listeners).toEqual([]);
});

test("replaceEnv usuwa brakujące klucze i ustawia nowe", () => {
  const env: NodeJS.ProcessEnv = { A: "1", B: "2" };
  replaceEnv(env, { B: "3", C: "4" });
  expect(env).toEqual({ B: "3", C: "4" });
});
