import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { decodeEntities, formatResults, htmlToText, parseDdg, webFetch } from "./web";

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
  afterEach(() => vi.unstubAllGlobals());
  const sig = new AbortController().signal;
  const redirect = (to: string) => new Response(null, { status: 302, headers: { location: to } });
  const page = () => new Response("ok", { status: 200, headers: { "content-type": "text/plain" } });
  const pub = async () => ["93.184.216.34"];
  const stub = (f: (url: string) => Response) => {
    const calls: string[] = [];
    vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
      expect(init.redirect).toBe("manual");
      calls.push(url);
      return f(url);
    });
    return calls;
  };

  it("publiczny adres z przekierowaniem działa", async () => {
    stub((u) => (u === "https://a.com/" ? redirect("/b") : page()));
    expect(await webFetch("https://a.com/", sig, { resolve: pub })).toContain("ok");
  });
  it("skok z publicznego na prywatny jest odrzucony i nie jest pobierany", async () => {
    const calls = stub((u) => (u.startsWith("https://a.com") ? redirect("http://169.254.169.254/latest") : page()));
    await expect(webFetch("https://a.com/", sig, { resolve: pub })).rejects.toThrow(/przekierowanie|redirect/);
    expect(calls).toEqual(["https://a.com/"]);
  });
  it("nazwa wskazująca na 127.0.0.1 jest odrzucona (DNS)", async () => {
    const calls = stub(page);
    await expect(webFetch("https://evil.com/", sig, { resolve: async () => ["127.0.0.1"] })).rejects.toThrow();
    expect(calls).toEqual([]);
  });
  it("rebinding na kolejnym skoku", async () => {
    stub((u) => (u.includes("a.com") ? redirect("https://b.com/") : page()));
    await expect(webFetch("https://a.com/", sig, { resolve: async (h) => (h === "b.com" ? ["10.0.0.5"] : ["93.184.216.34"]) })).rejects.toThrow();
  });
  it("zatwierdzony host prywatny działa, inny prywatny po przekierowaniu nie", async () => {
    stub((u) => (u === "http://127.0.0.1:8080/" ? redirect("http://127.0.0.1:9999/") : page()));
    await expect(webFetch("http://127.0.0.1:8080/", sig, { allowPrivate: "127.0.0.1:8080", resolve: pub })).rejects.toThrow();
    stub(page);
    expect(await webFetch("http://127.0.0.1:8080/", sig, { allowPrivate: "127.0.0.1:8080", resolve: pub })).toContain("ok");
  });
  it("bez zgody adres prywatny jest odrzucony", async () => {
    stub(page);
    await expect(webFetch("http://localhost:3000/", sig, { resolve: pub })).rejects.toThrow();
  });
  it("pętla przekierowań: max 5 skoków", async () => {
    const calls = stub(() => redirect("https://a.com/x"));
    await expect(webFetch("https://a.com/", sig, { resolve: pub })).rejects.toThrow(/5/);
    expect(calls.length).toBe(6);
  });
});
