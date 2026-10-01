//! Klucze API dostawców czatu: `<configDir>/chat-keys.json` z wartościami zaszyfrowanymi przez
//! `safeStorage` Electrona (KWallet / libsecret). Bez bezpiecznego magazynu nie zapisujemy nic.
//! Strona nigdy nie dostaje klucza z powrotem, tylko informację, że jest.

import fs from "node:fs";
import path from "node:path";
import { writeAtomic } from "../config";

export type Cipher = {
  /** false = brak sejfu systemowego (albo tylko „basic_text”, czyli prawie jawny tekst). */
  available(): boolean;
  encrypt(text: string): Buffer;
  decrypt(data: Buffer): string;
};

export class KeyStore {
  private file: string;
  private cache: Record<string, string> | null = null;

  constructor(
    dir: string,
    private cipher: Cipher,
    private env: Record<string, string | undefined> = process.env,
  ) {
    this.file = path.join(dir, "chat-keys.json");
  }

  private read(): Record<string, string> {
    if (this.cache) return this.cache;
    try {
      this.cache = JSON.parse(fs.readFileSync(this.file, "utf8")) as Record<string, string>;
    } catch {
      this.cache = {};
    }
    return this.cache;
  }

  /** `null` usuwa klucz. */
  set(providerId: string, key: string | null): void {
    const all = { ...this.read() };
    if (key === null || key.trim() === "") delete all[providerId];
    else {
      if (!this.cipher.available()) throw new Error("brak sejfu systemowego (KWallet / libsecret): klucz nie został zapisany");
      all[providerId] = this.cipher.encrypt(key.trim()).toString("base64");
    }
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    writeAtomic(this.file, JSON.stringify(all, null, 2));
    fs.chmodSync(this.file, 0o600);
    this.cache = all;
  }

  /** Klucz z magazynu, a bez niego ze zmiennej środowiskowej `keyEnv` (np. `OPENROUTER_API_KEY`). */
  get(providerId: string, keyEnv?: string): string | null {
    const stored = this.read()[providerId];
    if (stored) {
      try {
        return this.cipher.decrypt(Buffer.from(stored, "base64"));
      } catch {
        // inny sejf / inny użytkownik: jak brak klucza
      }
    }
    return (keyEnv && this.env[keyEnv]) || null;
  }

  /** Które dostawcy mają klucz (z magazynu albo ze zmiennej). */
  status(providers: { id: string; keyEnv?: string }[]): Record<string, "stored" | "env" | null> {
    const all = this.read();
    return Object.fromEntries(
      providers.map((p) => [p.id, all[p.id] ? "stored" : p.keyEnv && this.env[p.keyEnv] ? "env" : null]),
    );
  }
}

/** Sejf dla `--password-store`: na KDE Electron wybiera KWallet także wtedy, gdy portfel jest
 *  wyłączony (`[Wallet] Enabled=false` w kwalletrc) – wtedy szyfrowanie jest niedostępne,
 *  choć Secret Service (gnome-keyring) działa. `null` = zostaw wybór Electronowi. */
export function passwordStore(kwalletrc: string | null, env: Record<string, string | undefined>): string | null {
  if (!/KDE/i.test(env.XDG_CURRENT_DESKTOP ?? "") || kwalletrc === null) return null;
  const wallet = /^\[Wallet\]\s*$([\s\S]*?)(?=^\[|(?![\s\S]))/m.exec(kwalletrc)?.[1] ?? "";
  return /^Enabled\s*=\s*false\s*$/m.test(wallet) ? "gnome-libsecret" : null;
}
