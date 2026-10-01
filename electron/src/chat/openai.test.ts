import http from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { ChatEvent, ChatRequest } from "../../../src/chat";
import { openaiEvents, openaiModels, streamOpenAI } from "./openai";
import { ChatService } from "./service";
import { SseParser } from "./sse";

const enc = (s: string) => new TextEncoder().encode(s);

describe("SseParser", () => {
  it("linie i znaki UTF-8 przecięte między kawałkami, CRLF, komentarze", () => {
    const p = new SseParser();
    const bytes = enc(': ping\r\ndata: {"a":"żółw"}\r\n\r\nevent: x\ndata: 1\ndata: 2\n\n');
    const out = [];
    for (let i = 0; i < bytes.length; i += 3) out.push(...p.push(bytes.slice(i, i + 3)));
    out.push(...p.end());
    expect(out).toEqual([
      { event: "message", data: '{"a":"żółw"}' },
      { event: "x", data: "1\n2" },
    ]);
  });
  it("ostatnie zdarzenie bez pustej linii", () => {
    const p = new SseParser();
    expect(p.push(enc("data: [DONE]"))).toEqual([]);
    expect(p.end()).toEqual([{ event: "message", data: "[DONE]" }]);
  });
});

describe("openaiEvents", () => {
  it("tekst, myślenie, błąd, DONE", () => {
    expect(openaiEvents('{"choices":[{"delta":{"content":"Hej"}}]}')).toEqual([{ type: "text", text: "Hej" }]);
    expect(openaiEvents('{"choices":[{"delta":{"reasoning_content":"hm","content":null}}]}')).toEqual([{ type: "thinking", text: "hm" }]);
    expect(openaiEvents('{"error":{"message":"za długi kontekst"}}')).toEqual([{ type: "error", message: "za długi kontekst" }]);
    expect(openaiEvents("[DONE]")).toEqual([]);
    expect(openaiEvents('{"choices":[]}')).toEqual([]);
  });
});

// Atrapa serwera: zachowanie wybiera model w żądaniu.
let server: http.Server;
let base = "";
let lastBody: Record<string, unknown> = {};
let lastAuth: string | undefined;

beforeAll(async () => {
  server = http.createServer((req, res) => {
    if (req.url === "/v1/models") {
      res.writeHead(200, { "content-type": "application/json" });
      return res.end(JSON.stringify({ data: [{ id: "qwen" }, { id: "llama" }] }));
    }
    let body = "";
    req.on("data", (d) => (body += d));
    req.on("end", () => {
      lastBody = JSON.parse(body);
      lastAuth = req.headers.authorization;
      const model = lastBody.model;
      if (model === "e500") {
        res.writeHead(500, { "content-type": "application/json" });
        return res.end(JSON.stringify({ error: { message: "model nie załadowany" } }));
      }
      res.writeHead(200, { "content-type": "text/event-stream" });
      const chunk = (c: string) => `data: ${JSON.stringify({ choices: [{ delta: { content: c } }] })}\n\n`;
      if (model === "cut") {
        res.write(chunk("pół"));
        return setTimeout(() => res.destroy(), 20);
      }
      if (model === "slow") {
        res.write(chunk("a"));
        const t = setInterval(() => res.write(chunk("b")), 10);
        return res.on("close", () => clearInterval(t));
      }
      res.write(chunk("Dzień "));
      res.write(chunk("dobry"));
      res.end("data: [DONE]\n\n");
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`;
});
afterAll(() => {
  server.closeAllConnections();
  server.close();
});

const request = (model: string, baseUrl = base): ChatRequest => ({
  provider: { id: "t", name: "t", kind: "openai", group: "local", baseUrl, models: [] },
  model,
  system: "sys",
  messages: [{ role: "user", content: "hej" }],
  prompt: "hej",
  search: false,
});

const collect = async (req: ChatRequest, key: string | null = null) => {
  const out: ChatEvent[] = [];
  await streamOpenAI(req, key, new AbortController().signal, (e) => out.push(e));
  return out;
};

describe("streamOpenAI", () => {
  it("strumień tekstu, system jako pierwsza wiadomość, klucz w nagłówku", async () => {
    const out = await collect(request("ok"), "sk-1");
    expect(out.map((e) => (e.type === "text" ? e.text : "")).join("")).toBe("Dzień dobry");
    expect(lastBody.stream).toBe(true);
    expect((lastBody.messages as { role: string }[])[0]).toEqual({ role: "system", content: "sys" });
    expect(lastAuth).toBe("Bearer sk-1");
  });
  it("błąd HTTP po polsku z treścią", async () => {
    await expect(collect(request("e500"))).rejects.toThrow("błąd serwera 500: model nie załadowany");
  });
  it("serwer nie działa", async () => {
    // Wolny port: otwarty i od razu zamknięty.
    const s = http.createServer();
    await new Promise<void>((r) => s.listen(0, "127.0.0.1", r));
    const port = (s.address() as AddressInfo).port;
    await new Promise((r) => s.close(r));
    await expect(collect(request("ok", `http://127.0.0.1:${port}/v1`))).rejects.toThrow(/nie odpowiada/);
  });
  it("zerwane połączenie w środku = błąd", async () => {
    await expect(collect(request("cut"))).rejects.toThrow();
  });
});

describe("ChatService", () => {
  const service = () =>
    new ChatService({ openai: (req, signal, emit) => streamOpenAI(req, null, signal, emit) }, { openai: (p) => openaiModels(p.baseUrl!, null) });

  it("kończy `done`, błąd jako `error`, nieznany dostawca = error", async () => {
    const s = service();
    const ok: ChatEvent[] = [];
    await s.send("1", request("ok"), (e) => ok.push(e));
    expect(ok.at(-1)).toEqual({ type: "done" });
    const bad: ChatEvent[] = [];
    await s.send("2", request("e500"), (e) => bad.push(e));
    expect(bad.at(-1)?.type).toBe("error");
    const none: ChatEvent[] = [];
    await s.send("3", { ...request("ok"), provider: { ...request("ok").provider, kind: "anthropic" } }, (e) => none.push(e));
    expect(none).toEqual([{ type: "error", message: expect.stringContaining("anthropic") }]);
  });

  it("Stop: przerwany strumień kończy się `done`, bez zdarzeń po przerwaniu", async () => {
    const s = service();
    const out: ChatEvent[] = [];
    const p = s.send("x", request("slow"), (e) => {
      out.push(e);
      if (out.length === 3) s.abort("x");
    });
    await p;
    expect(out.at(-1)).toEqual({ type: "done" });
    expect(out.filter((e) => e.type === "text").length).toBe(3);
  });

  it("wykrywanie modeli", async () => {
    expect(await service().models(request("ok").provider)).toEqual(["qwen", "llama"]);
  });
});
