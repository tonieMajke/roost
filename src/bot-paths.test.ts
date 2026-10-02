import { describe, expect, it } from "vitest";
import { containsSensitiveRoot, isAbsolutePath, isInside, isSensitivePath, parseBot, type SensitiveEnv } from "./bot";

/** Ścieżki z Windows sprawdzane na każdym systemie: polityka zgód to czyste funkcje na tekście. */
describe("ścieżki Windows w polityce bota", () => {
  const env: SensitiveEnv = {
    home: "C:\\Users\\Ja",
    configDirs: ["C:\\Users\\Ja\\AppData\\Roaming\\dev.majke.roost"],
    exempt: ["C:\\Users\\Ja\\AppData\\Roaming\\dev.majke.roost\\bots\\b\\work"],
  };

  it("isInside: bez względu na wielkość liter i rodzaj ukośnika, bez fałszywego prefiksu", () => {
    expect(isInside("C:\\Users\\Ja\\proj\\a.ts", "C:\\Users\\Ja\\proj")).toBe(true);
    expect(isInside("c:/users/ja/PROJ/a.ts", "C:\\Users\\Ja\\proj")).toBe(true);
    expect(isInside("C:\\Users\\Ja\\proj", "C:\\Users\\Ja\\proj\\")).toBe(true);
    expect(isInside("C:\\Users\\Ja\\proj2\\a.ts", "C:\\Users\\Ja\\proj")).toBe(false);
    expect(isInside("D:\\Users\\Ja\\proj\\a.ts", "C:\\Users\\Ja\\proj")).toBe(false);
    // uniksowe ścieżki dalej rozróżniają wielkość liter
    expect(isInside("/home/ja/Proj/a", "/home/ja/proj")).toBe(false);
  });

  it("klucze, tokeny i profile przeglądarek są wrażliwe także pisane inaczej", () => {
    for (const p of [
      "C:\\Users\\Ja\\.ssh\\id_ed25519",
      "C:\\Users\\Ja\\.SSH\\config",
      "c:/users/ja/.aws/credentials",
      "C:\\Users\\Ja\\AppData\\Roaming\\Microsoft\\Protect\\S-1-5-21\\klucz",
      "C:\\Users\\Ja\\AppData\\Local\\Google\\Chrome\\User Data\\Default\\Cookies",
      "C:\\Users\\Ja\\AppData\\Roaming\\Microsoft\\Windows\\PowerShell\\PSReadLine\\ConsoleHost_history.txt",
      "C:\\Users\\Ja\\AppData\\Roaming\\dev.majke.roost\\chat-keys.json",
      "D:\\proj\\.env",
      "D:\\proj\\certs\\serwer.PEM",
    ]) expect(isSensitivePath(p, env), p).toBe(true);
  });

  it("zwykłe pliki i katalog roboczy bota nie są wrażliwe", () => {
    expect(isSensitivePath("C:\\Users\\Ja\\proj\\main.rs", env)).toBe(false);
    expect(isSensitivePath("C:\\Users\\Ja\\proj\\.env.example", env)).toBe(false);
    expect(isSensitivePath("C:\\Users\\Ja\\AppData\\Roaming\\dev.majke.roost\\bots\\b\\work\\notatki.md", env)).toBe(false);
  });

  it("grep po całym domu wchodzi do wrażliwych katalogów, po projekcie nie", () => {
    expect(containsSensitiveRoot("C:\\Users\\Ja", env)).toBe(true);
    expect(containsSensitiveRoot("c:\\users\\ja\\", env)).toBe(true);
    expect(containsSensitiveRoot("C:\\Users\\Ja\\proj", env)).toBe(false);
  });

  it("foldery bota: ścieżki bezwzględne uniksowe i Windows", () => {
    expect(isAbsolutePath("/home/ja")).toBe(true);
    expect(isAbsolutePath("C:\\kod")).toBe(true);
    expect(isAbsolutePath("c:/kod")).toBe(true);
    expect(isAbsolutePath("kod")).toBe(false);
    expect(isAbsolutePath("C:kod")).toBe(false);
    const r = parseBot({ id: "b", name: "B", folders: ["C:\\kod", "/home/ja/x", "względna"] });
    expect(r.bot?.folders).toEqual(["C:\\kod", "/home/ja/x"]);
  });
});
