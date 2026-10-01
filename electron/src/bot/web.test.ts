import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { decodeEntities, formatResults, htmlToText, parseDdg } from "./web";

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
