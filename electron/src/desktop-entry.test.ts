import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { applicationsDir, firstArg, isRoostEntry, repairDesktopEntries, repairEntry } from "./desktop-entry";

const OLD = "/home/majke/.local/bin/Roost-0.0.3.AppImage";
const NEW = "/home/majke/.local/bin/Roost-0.0.4.AppImage";

// Wpis z maszyny użytkownika po aktualizacji 0.0.3 → 0.0.4
const ENTRY = `[Desktop Entry]
Name=Roost
Exec="${OLD}" %U
TryExec=${OLD}
Terminal=false
Type=Application
Icon=roost-0.0.3
StartupWMClass=roost-app
X-AppImage-Version=0.0.3
Comment=Roost – rule the roost
Categories=Development;
`;

const gone = (p: string) => p !== OLD;

describe("repairEntry", () => {
  it("podmienia tylko ścieżkę w Exec/TryExec i wersję; reszta bez zmian", () => {
    expect(repairEntry(ENTRY, NEW, "0.0.4", gone)).toBe(`[Desktop Entry]
Name=Roost
Exec="${NEW}" %U
TryExec=${NEW}
Terminal=false
Type=Application
Icon=roost-0.0.3
StartupWMClass=roost-app
X-AppImage-Version=0.0.4
Comment=Roost – rule the roost
Categories=Development;
`);
  });

  it("nic nie robi, gdy stary plik istnieje albo wpis już wskazuje na bieżący", () => {
    expect(repairEntry(ENTRY, NEW, "0.0.4", () => true)).toBeNull();
    expect(repairEntry(ENTRY, OLD, "0.0.3", () => false)).toBeNull();
  });

  it("nie rusza cudzych wpisów ani Exec, które nie są AppImage", () => {
    const other = "[Desktop Entry]\nExec=/opt/Other-1.0.AppImage %U\nStartupWMClass=other\n";
    expect(repairEntry(other, NEW, "0.0.4", () => false)).toBeNull();
    const dev = "[Desktop Entry]\nExec=/usr/bin/electron . %U\nStartupWMClass=roost-app\n";
    expect(repairEntry(dev, NEW, "0.0.4", () => false)).toBeNull();
  });

  it("zachowuje brak cudzysłowu, CRLF i akcje; cytuje ścieżkę ze spacją", () => {
    const text = `[Desktop Entry]\r\nExec=${OLD} --x\r\n\r\n[Desktop Action new]\r\nExec=${OLD} --new\r\n`;
    expect(repairEntry(text, NEW, "0.0.4", gone)).toBe(`[Desktop Entry]\r\nExec=${NEW} --x\r\n\r\n[Desktop Action new]\r\nExec=${NEW} --new\r\n`);
    expect(repairEntry(text, "/home/a b/Roost.AppImage", "0.0.4", gone)).toContain('Exec="/home/a b/Roost.AppImage" --x\r\n');
  });

  it("odrzuca względną ścieżkę bieżącego AppImage", () => {
    expect(repairEntry(ENTRY, "Roost.AppImage", "0.0.4", gone)).toBeNull();
  });
});

it("firstArg: cudzysłów z ucieczkami, niezamknięty cudzysłów", () => {
  expect(firstArg(' "/a \\"b\\".AppImage" %U')).toEqual({ path: '/a "b".AppImage', start: 1, end: 20, quoted: true });
  expect(firstArg('"/a')).toBeNull();
  expect(firstArg("")).toBeNull();
});

it("isRoostEntry: po klasie okna albo nazwie pliku", () => {
  expect(isRoostEntry("Exec=/x/roost.appimage\n")).toBe(true);
  expect(isRoostEntry("StartupWMClass=roost-app\n")).toBe(true);
  expect(isRoostEntry("Exec=/x/Other.AppImage\nStartupWMClass=roost-appx\n")).toBe(false);
});

it("applicationsDir: XDG_DATA_HOME tylko bezwzględny", () => {
  expect(applicationsDir({ XDG_DATA_HOME: "/d" }, "/h")).toBe("/d/applications");
  expect(applicationsDir({ XDG_DATA_HOME: "rel" }, "/h")).toBe("/h/.local/share/applications");
  expect(applicationsDir({}, "/h")).toBe("/h/.local/share/applications");
});

// Prawdziwe pliki w katalogu tymczasowym – na Windows ścieżki nie są POSIX-owe, a moduł działa tylko na Linuksie.
describe.skipIf(process.platform === "win32")("repairDesktopEntries", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "aw-desktop-"));
  afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));
  const bin = path.join(dir, "bin");
  const apps = path.join(dir, "applications");
  fs.mkdirSync(bin);
  fs.mkdirSync(apps);
  const cur = path.join(bin, "Roost-0.0.4.AppImage");
  const stale = path.join(bin, "Roost-0.0.3.AppImage");
  fs.writeFileSync(cur, "");
  const entry = ENTRY.replaceAll(OLD, stale);

  it("naprawia wpis atomowo, z tymi samymi uprawnieniami; resztę zostawia", async () => {
    fs.writeFileSync(path.join(apps, "roost-0.0.3.desktop"), entry, { mode: 0o644 });
    fs.writeFileSync(path.join(apps, "other.desktop"), "[Desktop Entry]\nExec=/nope/Other.AppImage\n");
    fs.symlinkSync(path.join(apps, "roost-0.0.3.desktop"), path.join(apps, "link.desktop"));
    fs.writeFileSync(path.join(apps, "notes.txt"), entry);

    expect(await repairDesktopEntries(apps, cur, "0.0.4")).toEqual(["roost-0.0.3.desktop"]);
    const fixed = fs.readFileSync(path.join(apps, "roost-0.0.3.desktop"), "utf8");
    expect(fixed).toContain(`Exec="${cur}" %U\nTryExec=${cur}\n`);
    expect(fixed).toContain("X-AppImage-Version=0.0.4\n");
    expect(fixed).toContain("Icon=roost-0.0.3\n");
    expect(fs.statSync(path.join(apps, "roost-0.0.3.desktop")).mode & 0o777).toBe(0o644);
    expect(fs.lstatSync(path.join(apps, "link.desktop")).isSymbolicLink()).toBe(true);
    expect(fs.readFileSync(path.join(apps, "notes.txt"), "utf8")).toBe(entry);
    expect(fs.readdirSync(apps).sort()).toEqual(["link.desktop", "notes.txt", "other.desktop", "roost-0.0.3.desktop"]);

    // Drugi przebieg: nic do zrobienia
    expect(await repairDesktopEntries(apps, cur, "0.0.4")).toEqual([]);
  });

  it("brak katalogu: nic do zrobienia, bez błędu", async () => {
    expect(await repairDesktopEntries(path.join(dir, "brak"), cur, "0.0.4")).toEqual([]);
  });
});
