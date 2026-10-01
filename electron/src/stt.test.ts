import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import type { AddressInfo } from "node:net";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { SttProvider } from "../../src/stt";
import { sttConfigLoad, sttConfigSave, transcribe } from "./stt";

let dir = "";
let server: http.Server | null = null;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "aw-stt-"));
});
afterEach(() => {
  server?.close();
  server = null;
  fs.rmSync(dir, { recursive: true, force: true });
});

type Seen = { url: string; auth: string | undefined; type: string | undefined; body: string };

/** Serwer-atrapa: zapamiętuje zapytanie i odpowiada `reply`. */
async function serve(reply: (res: http.ServerResponse) => void, seen: Seen[] = []): Promise<SttProvider> {
  server = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => {
      seen.push({ url: req.url ?? "", auth: req.headers.authorization, type: req.headers["content-type"], body: Buffer.concat(chunks).toString("latin1") });
      reply(res);
    });
  });
  await new Promise<void>((ok) => server!.listen(0, "127.0.0.1", ok));
  const { port } = server.address() as AddressInfo;
  return { id: "t", name: "Test", baseUrl: `http://127.0.0.1:${port}/v1`, model: "whisper-x", key: true };
}

const json = (res: http.ServerResponse, status: number, body: unknown) => {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
};
const audio = new Uint8Array([1, 2, 3, 4]);

describe("transcribe", () => {
  it("wysyła multipart z kluczem, modelem i językiem, zwraca text", async () => {
    const seen: Seen[] = [];
    const p = await serve((r) => json(r, 200, { text: "Cześć świecie" }), seen);
    await expect(transcribe(p, "sk-1", audio, "audio/webm;codecs=opus", "pl")).resolves.toBe("Cześć świecie");
    expect(seen[0].url).toBe("/v1/audio/transcriptions");
    expect(seen[0].auth).toBe("Bearer sk-1");
    expect(seen[0].type).toMatch(/^multipart\/form-data/);
    expect(seen[0].body).toContain('name="model"');
    expect(seen[0].body).toContain("whisper-x");
    expect(seen[0].body).toContain('filename="nagranie.webm"');
    expect(seen[0].body).toMatch(/name="language"\r\n\r\npl/);
  });

  it("language=auto nie wysyła pola, a serwer lokalny działa bez klucza", async () => {
    const seen: Seen[] = [];
    const p = { ...(await serve((r) => json(r, 200, { text: "ok" }), seen)), key: false };
    await transcribe(p, null, audio, "audio/webm", "auto");
    expect(seen[0].auth).toBeUndefined();
    expect(seen[0].body).not.toContain('name="language"');
  });

  it("brak klucza = błąd bez wysyłania w sieć", async () => {
    const seen: Seen[] = [];
    const p = await serve((r) => json(r, 200, { text: "x" }), seen);
    await expect(transcribe(p, null, audio, "audio/webm", "auto")).rejects.toThrow(/brak klucza/);
    expect(seen).toHaveLength(0);
  });

  it("401 i komunikat serwera wracają po polsku", async () => {
    const p = await serve((r) => json(r, 401, { error: { message: "Invalid key" } }));
    await expect(transcribe(p, "zly", audio, "audio/webm", "auto")).rejects.toThrow(/zły albo brakujący klucz API: Invalid key/);
  });

  it("klucz z niedozwolonymi znakami odrzuca z wyjaśnieniem", async () => {
    const seen: Seen[] = [];
    const p = await serve((r) => json(r, 200, { text: "x" }), seen);
    await expect(transcribe(p, "sk-1 zły", audio, "audio/webm", "auto")).rejects.toThrow(/niedozwolone znaki/);
    expect(seen).toHaveLength(0);
  });

  it("odpowiedź bez `text` i nie-JSON dają czytelny błąd", async () => {
    const a = await serve((r) => json(r, 200, { foo: 1 }));
    await expect(transcribe(a, "k", audio, "audio/webm", "auto")).rejects.toThrow(/bez pola `text`/);
    server?.close();
    const b = await serve((r) => {
      r.writeHead(200, { "content-type": "text/html" });
      r.end("<html>");
    });
    await expect(transcribe(b, "k", audio, "audio/webm", "auto")).rejects.toThrow(/nie jest JSON/);
  });

  it("serwer, który nie działa, to komunikat o braku odpowiedzi", async () => {
    const p = await serve((r) => json(r, 200, { text: "x" }));
    server?.close();
    server = null;
    await expect(transcribe(p, "k", audio, "audio/webm", "auto")).rejects.toThrow(/nie odpowiada/);
  });

  it("puste i zbyt duże nagranie odrzuca przed siecią", async () => {
    const p = await serve((r) => json(r, 200, { text: "x" }));
    await expect(transcribe(p, "k", new Uint8Array(0), "audio/webm", "auto")).rejects.toThrow(/puste/);
    await expect(transcribe(p, "k", new Uint8Array(26 * 1024 * 1024), "audio/webm", "auto")).rejects.toThrow(/za duże/);
  });
});

describe("stt.json", () => {
  it("brak pliku = null, zapis i odczyt, zepsuty JSON nie jest zapisywany", () => {
    expect(sttConfigLoad(dir)).toBeNull();
    sttConfigSave(dir, '{"active":null}');
    expect(sttConfigLoad(dir)).toBe('{"active":null}');
    expect(() => sttConfigSave(dir, "{ nie json")).toThrow();
    expect(sttConfigLoad(dir)).toBe('{"active":null}');
  });
});
