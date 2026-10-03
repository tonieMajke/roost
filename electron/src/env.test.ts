import { describe, expect, it } from "vitest";
import os from "node:os";
import { childEnv, childEnvFixes, expand } from "./env";

describe("childEnvFixes", () => {
  it("poza AppImage nic nie zmienia", () => {
    expect(childEnvFixes({ PATH: "/usr/bin", GTK_THEME: "Breeze" })).toEqual({ remove: [], set: [] });
    // samo APPDIR (np. inny program) to jeszcze nie AppImage
    expect(childEnvFixes({ APPDIR: "/tmp/.mount_x", PATH: "/tmp/.mount_x/usr/bin:/usr/bin" })).toEqual({ remove: [], set: [] });
  });

  it("usuwa wpisy z $APPDIR i zmienne AppImage", () => {
    const d = "/tmp/.mount_AgentsX";
    const { remove, set } = childEnvFixes({
      APPDIR: d,
      APPIMAGE: "/home/u/.local/bin/Agents.AppImage",
      OWD: "/home/u",
      GTK_THEME: "Adwaita:dark",
      PYTHONDONTWRITEBYTECODE: "1",
      PATH: `${d}/usr/bin/:${d}/bin/:/home/u/.cargo/bin:/usr/bin`,
      LD_LIBRARY_PATH: `${d}/usr/lib/:${d}/usr/lib64`,
      PYTHONHOME: `${d}/usr/`,
      PYTHONPATH: `${d}/usr/share/pyshared/:`,
      XDG_DATA_DIRS: `${d}/usr/share/:/usr/share:/usr/local/share`,
      HOME: "/home/u",
      GTK_RC_FILES: "/etc/gtk/gtkrc",
    });
    expect(remove.sort()).toEqual([
      "APPDIR", "APPIMAGE", "GTK_THEME", "LD_LIBRARY_PATH", "OWD", "PYTHONDONTWRITEBYTECODE", "PYTHONHOME", "PYTHONPATH",
    ]);
    expect(set.sort()).toEqual([
      ["PATH", "/home/u/.cargo/bin:/usr/bin"],
      ["XDG_DATA_DIRS", "/usr/share:/usr/local/share"],
    ]);
  });
  it("usuwa też ścieżki montowania poprzedniej wersji (po aktualizacji) i zmienne electron-updatera", () => {
    const { remove, set } = childEnvFixes({
      APPDIR: "/tmp/.mount_Roost-new",
      APPIMAGE: "/home/u/Roost-0.0.5.AppImage",
      APPIMAGE_SILENT_INSTALL: "true",
      PATH: "/tmp/.mount_Roost-new:/tmp/.mount_Roost-old:/tmp/.mount_Roost-old/usr/sbin:/usr/bin",
      LD_LIBRARY_PATH: "/tmp/.mount_Roost-new/usr/lib:/tmp/.mount_Roost-old/usr/lib",
      GSETTINGS_SCHEMA_DIR: "/tmp/.mount_Roost-old/usr/share/glib-2.0/schemas",
      XDG_DATA_DIRS: "/tmp/.mount_Roost-old/usr/share/:/usr/share",
      NOTES: "/home/u/x.mount_y/z",
    });
    expect(remove.sort()).toEqual(["APPDIR", "APPIMAGE", "APPIMAGE_SILENT_INSTALL", "GSETTINGS_SCHEMA_DIR", "LD_LIBRARY_PATH"]);
    expect(set.sort()).toEqual([
      ["PATH", "/usr/bin"],
      ["XDG_DATA_DIRS", "/usr/share"],
    ]);
  });
});

describe("childEnv", () => {
  it("bez zmiennych Electrona, z poprawkami AppImage i dodatkami na końcu", () => {
    const env = childEnv(
      { TERM: "xterm-256color" },
      { ELECTRON_RUN_AS_NODE: "1", CHROME_DESKTOP: "x.desktop", HOME: "/h", TERM: "dumb", APPDIR: "/m", APPIMAGE: "/a", PATH: "/m/bin:/usr/bin" },
    );
    expect(env).toEqual({ HOME: "/h", TERM: "xterm-256color", PATH: "/usr/bin" });
  });
});

it("expand rozwija dom i zmienne", () => {
  const home = os.homedir();
  expect(expand("~")).toBe(home);
  expect(expand("~/x")).toBe(`${home}/x`);
  process.env.ROOST_TEST_EXPAND = "wartość";
  expect(expand("$ROOST_TEST_EXPAND")).toBe("wartość");
  delete process.env.ROOST_TEST_EXPAND;
  expect(expand("claude")).toBe("claude");
  expect(expand("a~b")).toBe("a~b");
});
