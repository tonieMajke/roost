import { describe, expect, it } from "vitest";
import { bridgeSocketPath, cmdEscapeArg, configBase, defaultShell, isPipePath, npmShimTarget, opensAsProgram, pathValue, posixShell, resolveCommand, spawnPlan, systemOpener } from "./platform";

const WIN_ENV = { Path: "C:\\Windows\\system32;C:\\Users\\ja\\AppData\\Roaming\\npm", PATHEXT: ".COM;.EXE;.BAT;.CMD", APPDATA: "C:\\Users\\ja\\AppData\\Roaming", ComSpec: "C:\\Windows\\system32\\cmd.exe" };
const winFs = (files: string[]) => (f: string) => files.some((x) => x.toLowerCase() === f.toLowerCase());

const SHIM = `@ECHO off
GOTO start
:find_dp0
SET dp0=%~dp0
EXIT /b
:start
SETLOCAL
CALL :find_dp0
IF EXIST "%dp0%\\node.exe" (
  SET "_prog=%dp0%\\node.exe"
) ELSE (
  SET "_prog=node"
  SET PATHEXT=%PATHEXT:;.JS;=;%
)
endLocal & goto #_undefined_# 2>NUL || title %COMSPEC% & "%_prog%"  "%dp0%\\node_modules\\@openai\\codex\\bin\\codex.js" %*
`;

describe("configBase", () => {
  it("Linux zostaje przy ~/.config, macOS i Windows mają swoje miejsca", () => {
    expect(configBase("linux", {}, "/home/ja")).toBe("/home/ja/.config");
    expect(configBase("darwin", {}, "/Users/ja")).toBe("/Users/ja/Library/Application Support");
    expect(configBase("win32", WIN_ENV, "C:\\Users\\ja")).toBe("C:\\Users\\ja\\AppData\\Roaming");
    expect(configBase("win32", {}, "C:\\Users\\ja")).toBe("C:\\Users\\ja\\AppData\\Roaming");
  });
});

describe("powłoki", () => {
  it("$SHELL, bez niego /bin/sh; Windows: PowerShell", () => {
    expect(defaultShell("linux", { SHELL: "/usr/bin/fish" })).toBe("/usr/bin/fish");
    expect(defaultShell("linux", {})).toBe("/bin/sh");
    expect(defaultShell("win32", WIN_ENV)).toBe("powershell.exe");
  });
  it("narzędzie bash bota tylko z /bin/sh", () => {
    expect(posixShell("linux")).toBe("/bin/sh");
    expect(posixShell("darwin")).toBe("/bin/sh");
    expect(posixShell("win32")).toBeNull();
  });
});

describe("pathValue", () => {
  it("na Windows klucz PATH w dowolnej wielkości liter", () => {
    expect(pathValue(WIN_ENV, "win32")).toBe(WIN_ENV.Path);
    expect(pathValue({ Path: "x" }, "linux")).toBe("");
  });
});

describe("resolveCommand", () => {
  it("Linux: goła nazwa w PATH, ścieżka wprost", () => {
    const exists = (f: string) => f === "/usr/bin/git";
    expect(resolveCommand("git", { platform: "linux", env: { PATH: "/bin:/usr/bin" }, exists })).toBe("/usr/bin/git");
    expect(resolveCommand("/usr/bin/git", { platform: "linux", env: {}, exists })).toBe("/usr/bin/git");
    expect(resolveCommand("rg", { platform: "linux", env: { PATH: "/usr/bin" }, exists })).toBeNull();
  });
  it("Windows: rozszerzenia z PATHEXT w kolejności, także dla ścieżki", () => {
    const exists = winFs(["C:\\Users\\ja\\AppData\\Roaming\\npm\\codex.cmd", "C:\\Windows\\system32\\where.exe", "C:\\tools\\piper.exe"]);
    const o = { platform: "win32" as const, env: WIN_ENV, exists };
    expect(resolveCommand("codex", o)).toBe("C:\\Users\\ja\\AppData\\Roaming\\npm\\codex.cmd");
    expect(resolveCommand("where", o)).toBe("C:\\Windows\\system32\\where.exe");
    expect(resolveCommand("where.exe", o)).toBe("C:\\Windows\\system32\\where.exe");
    expect(resolveCommand("C:\\tools\\piper", o)).toBe("C:\\tools\\piper.exe");
    expect(resolveCommand("claude", o)).toBeNull();
  });
});

describe("spawnPlan", () => {
  it("poza Windows bez zmian", () => {
    expect(spawnPlan("claude", ["-p"], { platform: "linux" })).toEqual({ command: "claude", args: ["-p"], verbatim: false });
  });
  it("Windows: .exe pełną ścieżką", () => {
    const exists = winFs(["C:\\Users\\ja\\.local\\bin\\claude.exe"]);
    const env = { ...WIN_ENV, Path: "C:\\Users\\ja\\.local\\bin" };
    expect(spawnPlan("claude", ["-p", "a\nb"], { platform: "win32", env, exists })).toEqual({ command: "C:\\Users\\ja\\.local\\bin\\claude.exe", args: ["-p", "a\nb"], verbatim: false });
  });
  it("Windows: shim npm → node ze skryptem, argumenty bez cytowania dla cmd", () => {
    const shim = "C:\\Users\\ja\\AppData\\Roaming\\npm\\codex.cmd";
    const exists = winFs([shim, "C:\\Program Files\\nodejs\\node.exe"]);
    const env = { ...WIN_ENV, Path: `${WIN_ENV.Path};C:\\Program Files\\nodejs` };
    expect(spawnPlan("codex", ["exec", "linia 1\nlinia 2"], { platform: "win32", env, exists, read: () => SHIM })).toEqual({
      command: "C:\\Program Files\\nodejs\\node.exe",
      args: ["C:\\Users\\ja\\AppData\\Roaming\\npm\\node_modules\\@openai\\codex\\bin\\codex.js", "exec", "linia 1\nlinia 2"],
      verbatim: false,
    });
  });
  it("Windows: node.exe obok shimu ma pierwszeństwo", () => {
    const shim = "C:\\Users\\ja\\AppData\\Roaming\\npm\\codex.cmd";
    const exists = winFs([shim, "C:\\Users\\ja\\AppData\\Roaming\\npm\\node.exe"]);
    expect(spawnPlan("codex", [], { platform: "win32", env: WIN_ENV, exists, read: () => SHIM }).command).toBe("C:\\Users\\ja\\AppData\\Roaming\\npm\\node.exe");
  });
  it("Windows: inny .cmd przez cmd.exe z cytowaniem; nowa linia to błąd", () => {
    const exists = winFs(["C:\\Program Files\\Code\\bin\\code.cmd"]);
    const env = { ...WIN_ENV, Path: "C:\\Program Files\\Code\\bin" };
    const read = () => "@echo off\r\nsetlocal\r\n\"%~dp0..\\Code.exe\" \"%~dp0..\\resources\\app\\out\\cli.js\" %*\r\n";
    const plan = spawnPlan("code", ["-g", "C:\\a b\\x&y.ts:3"], { platform: "win32", env, exists, read });
    expect(plan.verbatim).toBe(true);
    expect(plan.command).toBe("C:\\Windows\\system32\\cmd.exe");
    expect(plan.args).toEqual(["/d", "/s", "/c", '"^"C:\\Program^ Files\\Code\\bin\\code.cmd^" ^"-g^" ^"C:\\a^ b\\x^&y.ts:3^""']);
    expect(() => spawnPlan("code", ["a\nb"], { platform: "win32", env, exists, read })).toThrow(/cmd\.exe/);
  });
  it("Windows: nieznaleziony program zostaje, spawn zgłosi ENOENT", () => {
    expect(spawnPlan("brak", ["x"], { platform: "win32", env: WIN_ENV, exists: () => false })).toEqual({ command: "brak", args: ["x"], verbatim: false });
  });
});

describe("cmdEscapeArg", () => {
  it("cudzysłowy i ukośniki jak CreateProcess, metaznaki cmd z ^", () => {
    expect(cmdEscapeArg("abc")).toBe('^"abc^"');
    expect(cmdEscapeArg('a"b')).toBe('^"a\\^"b^"');
    expect(cmdEscapeArg("C:\\dir\\")).toBe('^"C:\\dir\\\\^"');
    expect(cmdEscapeArg("%PATH% & calc")).toBe('^"^%PATH^%^ ^&^ calc^"');
  });
});

describe("npmShimTarget", () => {
  it("skrypt JS z shimu npm (nowy i stary format)", () => {
    expect(npmShimTarget("C:\\npm\\codex.cmd", SHIM)).toBe("C:\\npm\\node_modules\\@openai\\codex\\bin\\codex.js");
    expect(npmShimTarget("C:\\npm\\pi.cmd", '@node  "%~dp0\\node_modules\\pi\\dist\\cli.mjs" %*')).toBe("C:\\npm\\node_modules\\pi\\dist\\cli.mjs");
  });
  it("skrypt uruchamiany innym programem (VS Code: Code.exe) to nie shim npm", () => {
    expect(npmShimTarget("C:\\x\\code.cmd", '"%~dp0..\\Code.exe" "%~dp0..\\resources\\app\\out\\cli.js" %*')).toBeNull();
  });
});

describe("most MCP", () => {
  it("Linux: plik gniazda w podanym katalogu; Windows: named pipe", () => {
    expect(bridgeSocketPath("/run/user/1000", "linux", {}, 42)).toBe("/run/user/1000/agents-bot-42.sock");
    expect(bridgeSocketPath(undefined, "linux", { XDG_RUNTIME_DIR: "/run/user/7" }, 42)).toBe("/run/user/7/agents-bot-42.sock");
    const pipe = bridgeSocketPath("/ignored", "win32", {}, 42);
    expect(pipe).toMatch(/^\\\\\.\\pipe\\roost-bot-42-[0-9a-f]{12}$/);
    expect(isPipePath(pipe)).toBe(true);
    expect(isPipePath("/run/user/7/agents-bot-42.sock")).toBe(false);
  });
});

it("opensAsProgram: pliki, które system by uruchomił, a nie otworzył", () => {
  expect(opensAsProgram("C:\\x\\run.BAT", "win32")).toBe(true);
  expect(opensAsProgram("C:\\x\\skrót.lnk", "win32")).toBe(true);
  expect(opensAsProgram("C:\\x\\main.ts", "win32")).toBe(false);
  expect(opensAsProgram("/x/start.command", "darwin")).toBe(true);
  expect(opensAsProgram("/x/run.bat", "linux")).toBe(false);
});

it("systemOpener", () => {
  expect(systemOpener("linux")).toBe("xdg-open");
  expect(systemOpener("darwin")).toBe("open");
  expect(systemOpener("win32")).toBeNull();
});
