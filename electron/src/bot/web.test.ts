import fs from "node:fs";
import path from "node:path";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { describe, expect, it } from "vitest";
import { decodeEntities, formatResults, htmlToText, parseDdg, pinnedLookup, webFetch, type FetchOpts } from "./web";

const fixture = (name: string) => fs.readFileSync(path.join(__dirname, "fixtures", name), "utf8");

describe("parseDdg", () => {
  it("wyniki z prawdziwej odpowiedzi DuckDuckGo", () => {
    const r = parseDdg(fixture("ddg.html"));
    expect(r.length).toBeGreaterThanOrEqual(5);
    expect(r[0]).toEqual({ title: "1.92.0 | Rust Changelogs - releases.rs", url: "https://releases.rs/docs/1.92.0/", snippet: expect.stringContaining("Released on") });
    expect(r.some((x) => x.url === "https://blog.rust-lang.org/2025/12/11/Rust-1.92.0/")).toBe(true);
    expect(r.every((x) => /^https?:\/\//.test(x.url) && !x.url.includes("duckduckgo.com"))).toBe(true);
    expect(new Set(r.map((x) => x.url)).size).toBe(r.length);
  });
  it("strona błędu = brak wyników", () => {
    expect(parseDdg(fixture("ddg-error.html"))).toEqual([]);
  });
  it("formatResults", () => {
    expect(formatResults("x", [])).toBe("Brak wyników dla „x”.");
    expect(formatResults("x", [{ title: "T", url: "https://a", snippet: "s" }])).toBe("[1] T\nhttps://a\ns");
  });
});

describe("htmlToText", () => {
  it("tytuł, nagłówki, listy, linki; bez skryptów i nawigacji", () => {
    const html = `<!doctype html><html><head><title>Rust &amp; ja</title><style>p{}</style></head><body>
      <nav><a href="/">Menu</a></nav><script>alert(1)</script>
      <h1>Wydanie&nbsp;1.92</h1><p>Nowe <b>async</b> closures. Zobacz <a href="https://blog.rust-lang.org/">blog</a>.</p>
      <ul><li>pierwszy</li><li>drugi &#8211; &#x1F980;</li></ul></body></html>`;
    const { title, text } = htmlToText(html);
    expect(title).toBe("Rust & ja");
    expect(text).toContain("# Wydanie 1.92");
    expect(text).toContain("Nowe async closures. Zobacz blog (https://blog.rust-lang.org/).");
    expect(text).toContain("- pierwszy\n- drugi – 🦀");
    expect(text).not.toMatch(/alert|Menu|p\{\}/);
  });
  it("tabela bez pustych ramek", () => {
    const { text } = htmlToText("<table><tr><td></td><td></td></tr><tr><td>1 paź</td><td></td><td>Rust 1.99</td></tr></table>");
    expect(text).toBe("1 paź | Rust 1.99");
  });
  it("encje spoza zakresu zostają", () => {
    expect(decodeEntities("&#99999999; &bogus; &lt;")).toBe("&#99999999; &bogus; <");
  });
});

describe("webFetch: przekierowania i DNS", () => {
  const sig = new AbortController().signal;
  const redirect = (to: string) => new Response(null, { status: 302, headers: { location: to } });
  const page = () => new Response("ok", { status: 200, headers: { "content-type": "text/plain" } });
  const pub = async () => ["93.184.216.34"];
  let transport: FetchOpts["transport"];
  const stub = (f: (url: string) => Response) => {
    const calls: string[] = [];
    transport = async (u) => {
      calls.push(u.href);
      return f(u.href);
    };
    return calls;
  };

  it("publiczny adres z przekierowaniem działa", async () => {
    stub((u) => (u === "https://a.com/" ? redirect("/b") : page()));
    expect(await webFetch("https://a.com/", sig, { transport, resolve: pub })).toContain("ok");
  });
  it("skok z publicznego na prywatny jest odrzucony i nie jest pobierany", async () => {
    const calls = stub((u) => (u.startsWith("https://a.com") ? redirect("http://169.254.169.254/latest") : page()));
    await expect(webFetch("https://a.com/", sig, { transport, resolve: pub })).rejects.toThrow(/przekierowanie|redirect/);
    expect(calls).toEqual(["https://a.com/"]);
  });
  it("nazwa wskazująca na 127.0.0.1 jest odrzucona (DNS)", async () => {
    const calls = stub(page);
    await expect(webFetch("https://evil.com/", sig, { transport, resolve: async () => ["127.0.0.1"] })).rejects.toThrow();
    expect(calls).toEqual([]);
  });
  it("rebinding na kolejnym skoku", async () => {
    stub((u) => (u.includes("a.com") ? redirect("https://b.com/") : page()));
    await expect(webFetch("https://a.com/", sig, { transport, resolve: async (h) => (h === "b.com" ? ["10.0.0.5"] : ["93.184.216.34"]) })).rejects.toThrow();
  });
  it("zatwierdzony host prywatny działa, inny prywatny po przekierowaniu nie", async () => {
    stub((u) => (u === "http://127.0.0.1:8080/" ? redirect("http://127.0.0.1:9999/") : page()));
    await expect(webFetch("http://127.0.0.1:8080/", sig, { transport, allowPrivate: "127.0.0.1:8080", resolve: pub })).rejects.toThrow();
    stub(page);
    expect(await webFetch("http://127.0.0.1:8080/", sig, { transport, allowPrivate: "127.0.0.1:8080", resolve: pub })).toContain("ok");
  });
  it("bez zgody adres prywatny jest odrzucony", async () => {
    stub(page);
    await expect(webFetch("http://localhost:3000/", sig, { transport, resolve: pub })).rejects.toThrow();
  });
  it("przekierowanie na host niedozwolony kończy się błędem z podpowiedzią; dozwolony przechodzi", async () => {
    const calls = stub((u) => (u.startsWith("https://a.com") ? redirect("https://b.com/x") : page()));
    await expect(webFetch("https://a.com/", sig, { transport, resolve: pub, allowHost: (h) => h === "a.com" })).rejects.toThrow(/b\.com\/x/);
    expect(calls).toEqual(["https://a.com/"]);
    expect(await webFetch("https://a.com/", sig, { transport, resolve: pub, allowHost: (h) => h === "a.com" || h === "b.com" })).toContain("ok");
  });
  it("pętla przekierowań: max 5 skoków", async () => {
    const calls = stub(() => redirect("https://a.com/x"));
    await expect(webFetch("https://a.com/", sig, { transport, resolve: pub })).rejects.toThrow(/5/);
    expect(calls.length).toBe(6);
  });
});

describe("webFetch: przypięcie adresu (DNS-rebinding)", () => {
  const sig = new AbortController().signal;
  const serve = async () => {
    const hosts: string[] = [];
    const server = http.createServer((req, res) => {
      hosts.push(req.headers.host ?? "");
      res.writeHead(200, { "content-type": "text/plain" }).end("z serwera");
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    return { server, port: (server.address() as AddressInfo).port, hosts };
  };

  it("połączenie idzie na adres z jednego rozwiązania nazwy", async () => {
    const { server, port, hosts } = await serve();
    let calls = 0;
    try {
      const host = `pin.invalid:${port}`;
      const out = await webFetch(`http://${host}/`, sig, { allowPrivate: host, resolve: async () => (calls++, ["127.0.0.1"]) });
      expect(out).toContain("z serwera");
      expect(hosts).toEqual([host]); // nagłówek Host zostaje nazwą, a połączenie poszło na 127.0.0.1
      expect(calls).toBe(1); // jedno rozwiązanie, w lookup (guardHost pomija zatwierdzony host)
    } finally {
      server.close();
    }
  });
  it("lookup odrzuca adres prywatny, nawet gdy wcześniejsze sprawdzenie widziało publiczny", async () => {
    const { server, port, hosts } = await serve();
    let n = 0;
    try {
      const resolve = async () => (n++ === 0 ? ["93.184.216.34"] : ["127.0.0.1"]); // 1. guardHost, 2. lookup
      await expect(webFetch(`http://rebind.invalid:${port}/`, sig, { resolve })).rejects.toThrow();
      expect(hosts).toEqual([]);
    } finally {
      server.close();
    }
  });
  it("pinnedLookup: tryb all i pojedynczy, prywatny odrzucony", async () => {
    const u = new URL("https://a.com/");
    const run = (opts: FetchOpts, o: object) =>
      new Promise<unknown>((res) => pinnedLookup(u, opts)("a.com", o, ((e: Error | null, a: unknown, f?: number) => res(e ? "błąd" : [a, f])) as never));
    expect(await run({ resolve: async () => ["93.184.216.34"] }, {})).toEqual(["93.184.216.34", 4]);
    expect(await run({ resolve: async () => ["93.184.216.34", "2606:2800::1"] }, { all: true })).toEqual([
      [{ address: "93.184.216.34", family: 4 }, { address: "2606:2800::1", family: 6 }],
      undefined,
    ]);
    expect(await run({ resolve: async () => ["93.184.216.34", "10.0.0.1"] }, {})).toBe("błąd");
  });
});
