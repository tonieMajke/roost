import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import type { AddressInfo } from "node:net";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ChatEvent, ChatRequest } from "../../../src/chat";
import { anthropicEvents, streamAnthropic } from "./anthropic";
import { KeyStore, passwordStore, type Cipher } from "./keys";

// Atrapa sejfu: odwraca bajty (wystarczy, żeby sprawdzić, że w pliku nie ma jawnego klucza).
const fake = (available = true): Cipher => ({
  available: () => available,
  encrypt: (s) => Buffer.from(s, "utf8").reverse(),
  decrypt: (b) => Buffer.from(b).reverse().toString("utf8"),
});

let dir = "";
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "aw-keys-"));
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

describe("KeyStore", () => {
  it("zapis zaszyfrowany, plik 600, odczyt, usunięcie", () => {
    const k = new KeyStore(dir, fake(), {});
    k.set("openai", "  sk-tajny  ");
    const raw = fs.readFileSync(path.join(dir, "chat-keys.json"), "utf8");
    expect(raw).not.toContain("sk-tajny");
    expect(fs.statSync(path.join(dir, "chat-keys.json")).mode & 0o777).toBe(0o600);
    expect(new KeyStore(dir, fake(), {}).get("openai")).toBe("sk-tajny");
    k.set("openai", null);
    expect(k.get("openai")).toBeNull();
  });

  it("bez sejfu: odmowa, nic nie zapisane", () => {
    const k = new KeyStore(dir, fake(false), {});
    expect(() => k.set("openai", "sk-1")).toThrow(/sejfu/);
    expect(fs.existsSync(path.join(dir, "chat-keys.json"))).toBe(false);
  });

  it("zmienna środowiskowa jako zapas, status", () => {
    const k = new KeyStore(dir, fake(), { OPENROUTER_API_KEY: "or-1" });
    k.set("a", "x");
    expect(k.get("or", "OPENROUTER_API_KEY")).toBe("or-1");
    expect(k.status([{ id: "a" }, { id: "or", keyEnv: "OPENROUTER_API_KEY" }, { id: "none" }])).toEqual({ a: "stored", or: "env", none: null });
  });
});

describe("anthropic", () => {
  it("anthropicEvents: tekst, myślenie, błąd, reszta pominięta", () => {
    expect(anthropicEvents('{"type":"content_block_delta","delta":{"type":"text_delta","text":"Hej"}}')).toEqual([{ type: "text", text: "Hej" }]);
    expect(anthropicEvents('{"type":"content_block_delta","delta":{"type":"thinking_delta","thinking":"hm"}}')).toEqual([{ type: "thinking", text: "hm" }]);
    expect(anthropicEvents('{"type":"error","error":{"type":"overloaded_error","message":"Overloaded"}}')).toEqual([{ type: "error", message: "Overloaded" }]);
    expect(anthropicEvents('{"type":"message_start","message":{}}')).toEqual([]);
  });

  it("strumień z atrapy serwera: nagłówki, system osobno, tekst", async () => {
    let seen: { headers: http.IncomingHttpHeaders; body: Record<string, unknown> } | null = null;
    const server = http.createServer((req, res) => {
      let body = "";
      req.on("data", (d) => (body += d));
      req.on("end", () => {
        seen = { headers: req.headers, body: JSON.parse(body) };
        res.writeHead(200, { "content-type": "text/event-stream" });
        res.write('event: message_start\ndata: {"type":"message_start","message":{}}\n\n');
        res.write('event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Dzień dobry"}}\n\n');
        res.end('event: message_stop\ndata: {"type":"message_stop"}\n\n');
      });
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    const baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`;
    const req: ChatRequest = {
      provider: { id: "anthropic", name: "A", kind: "anthropic", group: "api", baseUrl, models: [] },
      model: "claude-haiku-4-5-20251001",
      system: "sys",
      messages: [{ role: "user", content: "hej" }],
      prompt: "hej",
      search: false,
    };
    const out: ChatEvent[] = [];
    await streamAnthropic(req, "sk-ant", new AbortController().signal, (e) => out.push(e));
    server.close();
    expect(out).toEqual([{ type: "text", text: "Dzień dobry" }]);
    expect(seen!.headers["x-api-key"]).toBe("sk-ant");
    expect(seen!.headers["anthropic-version"]).toBe("2023-06-01");
    expect(seen!.body).toMatchObject({ system: "sys", stream: true, messages: [{ role: "user", content: "hej" }] });
    await expect(streamAnthropic(req, null, new AbortController().signal, () => {})).rejects.toThrow(/brak klucza/);
  });
});

describe("passwordStore", () => {
  const kde = { XDG_CURRENT_DESKTOP: "KDE" };
  it("wyłączony KWallet na KDE → libsecret", () => {
    expect(passwordStore("[Migration]\nalreadyMigrated=true\n\n[Wallet]\nEnabled=false\nFirst Use=false\n", kde)).toBe("gnome-libsecret");
  });
  it("włączony, brak pliku, inny pulpit, Enabled w innej sekcji = bez zmian", () => {
    expect(passwordStore("[Wallet]\nEnabled=true\n", kde)).toBeNull();
    expect(passwordStore(null, kde)).toBeNull();
    expect(passwordStore("[Wallet]\nEnabled=false\n", { XDG_CURRENT_DESKTOP: "GNOME" })).toBeNull();
    expect(passwordStore("[Wallet]\nFirst Use=false\n[Other]\nEnabled=false\n", kde)).toBeNull();
  });
});
