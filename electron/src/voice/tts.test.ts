import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import type { AddressInfo } from "node:net";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { TtsProvider } from "../../../src/voice/voice";
import { defaultPiperCommand, MAX_TEXT, Piper, speakHttp, ttsConfigLoad, ttsConfigSave, TtsService, voiceConfigSave } from "./tts";

const FAKE_MJS = path.join(__dirname, "fixtures", "fake-piper.mjs");
/** Windows nie uruchomi `.mjs` z shebangiem: atrapa dostaje opakowanie `.cmd` (jak program z pip/npm). */
const FAKE = process.platform === "win32" ? winWrapper(FAKE_MJS) : FAKE_MJS;
function winWrapper(script: string): string {
  const cmd = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "aw-fake-piper-")), "piper.cmd");
  fs.writeFileSync(cmd, `@"${process.execPath}" "${script}" %*\r\n`);
  return cmd;
}
const text = (a: Uint8Array) => Buffer.from(a).toString("utf8");

let dir = "";
let model = "";
let server: http.Server | null = null;
const pipers: Piper[] = [];
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "aw-tts-"));
  model = path.join(dir, "pl.onnx");
  fs.writeFileSync(model, "");
});
afterEach(() => {
  server?.close();
  server = null;
  for (const p of pipers.splice(0)) p.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

const piper = (speaker = "") => {
  const p = new Piper(FAKE, model, speaker);
  pipers.push(p);
  return p;
};

type Seen = { url: string; auth: string | undefined; body: Record<string, unknown> };

async function serve(reply: (res: http.ServerResponse) => void, seen: Seen[] = []): Promise<TtsProvider> {
  server = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => {
      seen.push({ url: req.url ?? "", auth: req.headers.authorization, body: JSON.parse(Buffer.concat(chunks).toString("utf8")) as Record<string, unknown> });
      reply(res);
    });
  });
  await new Promise<void>((ok) => server!.listen(0, "127.0.0.1", ok));
  const { port } = server.address() as AddressInfo;
  return { id: "t", name: "Test", kind: "speech", baseUrl: `http://127.0.0.1:${port}/v1`, model: "tts-x", voice: "alloy", key: true };
}
const wav = (res: http.ServerResponse) => {
  res.writeHead(200, { "content-type": "audio/wav" });
  res.end("RIFFdane");
};

describe("pliki konfiguracji", () => {
  it("brak pliku = null, zapis odrzuca zły JSON", () => {
    expect(ttsConfigLoad(dir)).toBeNull();
    expect(() => ttsConfigSave(dir, "{ nie")).toThrow();
    ttsConfigSave(path.join(dir, "nowy"), '{"providers":[]}');
    expect(ttsConfigLoad(path.join(dir, "nowy"))).toBe('{"providers":[]}');
  });
});

describe("speakHttp", () => {
  it("wysyła JSON z modelem, głosem i formatem wav, zwraca bajty", async () => {
    const seen: Seen[] = [];
    const p = await serve(wav, seen);
    const audio = await speakHttp(p, "sk-1", "Cześć,\n  świecie.", "nova");
    expect(text(audio)).toBe("RIFFdane");
    expect(seen[0]).toEqual({ url: "/v1/audio/speech", auth: "Bearer sk-1", body: { model: "tts-x", input: "Cześć, świecie.", voice: "nova", response_format: "wav" } });
  });

  it("głos z silnika, gdy nie wybrano; pusty głos nie idzie wcale; lokalny bez klucza", async () => {
    const seen: Seen[] = [];
    const p = await serve(wav, seen);
    await speakHttp(p, "k", "a", "");
    await speakHttp({ ...p, voice: "", key: false }, null, "b", "");
    expect(seen[0].body.voice).toBe("alloy");
    expect(seen[1].body).not.toHaveProperty("voice");
    expect(seen[1].auth).toBeUndefined();
  });

  it("błędy przed siecią: brak klucza, pusty i za długi tekst", async () => {
    const seen: Seen[] = [];
    const p = await serve(wav, seen);
    await expect(speakHttp(p, null, "a", "")).rejects.toThrow(/brak klucza/);
    await expect(speakHttp(p, "k", "  \n", "")).rejects.toThrow(/pusty tekst/);
    await expect(speakHttp(p, "k", "a".repeat(MAX_TEXT + 1), "")).rejects.toThrow(/za długi/);
    expect(seen).toHaveLength(0);
  });

  it("401 i odpowiedź tekstowa zamiast dźwięku", async () => {
    let p = await serve((r) => {
      r.writeHead(401, { "content-type": "application/json" });
      r.end(JSON.stringify({ error: { message: "Invalid key" } }));
    });
    await expect(speakHttp(p, "zly", "a", "")).rejects.toThrow(/klucz API: Invalid key/);
    server!.close();
    p = await serve((r) => {
      r.writeHead(200, { "content-type": "application/json" });
      r.end("{}");
    });
    await expect(speakHttp(p, "k", "a", "")).rejects.toThrow(/tekst zamiast dźwięku/);
  });

  it("abort przerywa zapytanie", async () => {
    const p = await serve(() => undefined);
    const ac = new AbortController();
    const done = speakHttp(p, "k", "a", "", ac.signal);
    setTimeout(() => ac.abort(), 50);
    await expect(done).rejects.toMatchObject({ name: "AbortError" });
  });
});

describe("Piper", () => {
  it("zdania wracają w kolejności, także gdy pierwsze jest wolne; głos idzie jako --speaker", async () => {
    const p = piper("2");
    const out = await Promise.all([p.speak("WOLNO raz."), p.speak("dwa\nlinie"), p.speak("trzy")]);
    expect(out.map((a) => text(a).split("|").slice(1, 3).join("|"))).toEqual(["WOLNO raz.|2", "dwa linie|2", "trzy|2"]);
    // Plików nie zostawiamy w katalogu tymczasowym.
    await new Promise((r) => setTimeout(r, 50));
    expect(fs.readdirSync(p.dir)).toEqual([]);
  });

  it("głos niebędący liczbą nie trafia do argumentów", async () => {
    expect(text(await piper("gosia").speak("a")).split("|")[2]).toBe("-");
  });

  it("przerwane zdanie nie psuje kolejnych", async () => {
    const p = piper();
    const ac = new AbortController();
    const first = p.speak("WOLNO pierwsze", ac.signal);
    const second = p.speak("drugie");
    ac.abort();
    await expect(first).rejects.toMatchObject({ name: "AbortError" });
    expect(text(await second).split("|")[1]).toBe("drugie");
  });

  it("śmierć procesu odrzuca czekające zdania z powodem ze stderr", async () => {
    const p = piper();
    const a = p.speak("WOLNO a");
    const b = p.speak("PADNIJ");
    await expect(a).resolves.toBeDefined();
    await expect(b).rejects.toThrow(/Piper zakończył się \(3\): \[error\] model się wysypał/);
    expect(p.alive).toBe(false);
    await expect(p.speak("c")).rejects.toThrow(/Piper zakończył się/);
  });

  it("brak modelu i brak programu dają czytelny błąd", async () => {
    const bad = new Piper(FAKE, path.join(dir, "brak.onnx"), "");
    pipers.push(bad);
    await expect(bad.speak("a")).rejects.toThrow(/Model not found/);
    const none = new Piper(path.join(dir, "nie-ma-piper"), model, "");
    pipers.push(none);
    await expect(none.speak("a")).rejects.toThrow(/nie znaleziono programu/);
  });

  it("close kończy proces i odrzuca czekające", async () => {
    const p = piper();
    const pid = Number(text(await p.speak("a")).split("|")[3]);
    const pending = p.speak("WOLNO b");
    p.close();
    await expect(pending).rejects.toThrow(/zamknięty/);
    await new Promise((r) => setTimeout(r, 100));
    expect(() => process.kill(pid, 0)).toThrow();
  });
});

describe("TtsService", () => {
  const setup = (providers: TtsProvider[], tts: string | null, voice = "") => {
    ttsConfigSave(dir, JSON.stringify({ providers }));
    voiceConfigSave(dir, JSON.stringify({ tts, voice }));
  };

  it("bez wybranego silnika mówi, co ustawić", async () => {
    const s = new TtsService(() => dir, () => null);
    await expect(s.speak("r", "a")).rejects.toThrow(/nie wybrano silnika mowy/);
  });

  it("speech: klucz z sejfu pod `tts-<id>`, głos z voice.json", async () => {
    const seen: Seen[] = [];
    const p = await serve(wav, seen);
    setup([p], "t", "echo");
    const asked: string[] = [];
    const s = new TtsService(() => dir, (id) => (asked.push(id), "sk-9"));
    expect(text(await s.speak("r1", "Hej"))).toBe("RIFFdane");
    expect(asked).toEqual(["tts-t"]);
    expect(seen[0]).toMatchObject({ auth: "Bearer sk-9", body: { voice: "echo" } });
  });

  it("piper: jeden proces na kolejne zdania, nowy po zmianie głosu; end zamyka", async () => {
    const pp: TtsProvider = { id: "p", name: "P", kind: "piper", model, command: FAKE, voice: "", key: false };
    setup([pp], "p");
    const s = new TtsService(() => dir, () => null);
    const pid = (a: Uint8Array) => text(a).split("|")[3];
    const a = await s.speak("r1", "a");
    const b = await s.speak("r2", "b");
    expect(pid(a)).toBe(pid(b));
    setup([pp], "p", "1");
    const c = await s.speak("r3", "c");
    expect(pid(c)).not.toBe(pid(a));
    expect(text(c).split("|")[2]).toBe("1");
    s.end();
    await new Promise((r) => setTimeout(r, 100));
    expect(() => process.kill(Number(pid(c)), 0)).toThrow();
  });

  it("cancel przerywa tylko swoje zdanie", async () => {
    const pp: TtsProvider = { id: "p", name: "P", kind: "piper", model, command: FAKE, voice: "", key: false };
    setup([pp], "p");
    const s = new TtsService(() => dir, () => null);
    const slow = s.speak("r1", "WOLNO a");
    const next = s.speak("r2", "b");
    await new Promise((r) => setTimeout(r, 20));
    s.cancel("r1");
    await expect(slow).rejects.toMatchObject({ name: "AbortError" });
    expect(text(await next).split("|")[1]).toBe("b");
    s.end();
  });
});

describe("defaultPiperCommand", () => {
  const has = (...files: string[]) => (f: string) => files.includes(f);
  it.runIf(process.platform === "win32")("Windows: piper-tts.exe / piper.exe", () => {
    expect(defaultPiperCommand("C:\\a;C:\\b", has("C:\\b\\piper.exe", "C:\\b\\piper-tts.exe"))).toBe("piper-tts");
    expect(defaultPiperCommand("C:\\a;C:\\b", has("C:\\a\\piper.exe"))).toBe("piper");
    expect(defaultPiperCommand("C:\\a", has("C:\\a\\piper"))).toBe("piper");
  });
  it.skipIf(process.platform === "win32")("woli piper-tts (Arch/AUR), potem piper", () => {
    expect(defaultPiperCommand("/a:/b", has("/b/piper", "/b/piper-tts"))).toBe("piper-tts");
    expect(defaultPiperCommand("/a:/b", has("/a/piper"))).toBe("piper");
  });
  it("bez żadnego w PATH zostaje piper (komunikat ENOENT)", () => {
    expect(defaultPiperCommand("/a", has())).toBe("piper");
    expect(defaultPiperCommand("", has())).toBe("piper");
  });
});
