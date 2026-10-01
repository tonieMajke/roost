import { describe, expect, it } from "vitest";
import {
  applyEvent,
  buildChatConfig,
  linkCitations,
  greeting,
  extractSources,
  configJson,
  modelsCount,
  freeId,
  PROVIDER_TEMPLATES,
  chatTitle,
  cliPrompt,
  dayGroup,
  DEFAULT_PROVIDERS,
  domain,
  firstModel,
  groupChats,
  importPiProviders,
  mergeProviders,
  modelLabel,
  newChat,
  parseChat,
  parseChatConfig,
  withDiscovered,
  wireHistory,
  type Message,
} from "./chat";

const msg = (role: Message["role"], text: string, extra: Partial<Message> = {}): Message => ({
  id: Math.random().toString(36),
  role,
  text,
  at: 0,
  ...extra,
});

describe("parseChatConfig", () => {
  it("bez tablicy → domyślni z błędem", () => {
    const r = parseChatConfig({});
    expect(r.providers).toBe(DEFAULT_PROVIDERS);
    expect(r.errors).toHaveLength(1);
  });

  it("pomija złe wpisy i opisuje je", () => {
    const r = parseChatConfig({
      providers: [
        { id: "ok", kind: "openai", baseUrl: "http://x/v1/", models: ["a", { id: "b", name: "Bee" }] },
        { id: "ok", kind: "openai", baseUrl: "http://y", models: [] },
        { id: "zly kind", kind: "openai", baseUrl: "http://y" },
        { id: "k", kind: "magic" },
        { id: "nourl", kind: "anthropic" },
        { id: "c", kind: "claude-cli", models: [] },
      ],
    });
    expect(r.providers.map((p) => p.id)).toEqual(["ok", "c"]);
    expect(r.providers[0].baseUrl).toBe("http://x/v1");
    expect(r.providers[0].models).toEqual([
      { id: "a", name: "a" },
      { id: "b", name: "Bee" },
    ]);
    expect(r.providers[0].group).toBe("api");
    expect(r.providers[1].group).toBe("sub");
    expect(r.errors).toHaveLength(4);
  });

  it("pusta lista → domyślni", () => {
    expect(parseChatConfig({ providers: [] }).providers).toBe(DEFAULT_PROVIDERS);
  });
});

describe("importPiProviders", () => {
  it("bierze dostawców openai, lokalny adres = grupa local bez klucza", () => {
    const r = importPiProviders({
      providers: {
        freetoken: { baseUrl: "http://127.0.0.1:1919/v1", api: "openai-completions", models: [{ id: "M", name: "Em" }] },
        remote: { baseUrl: "https://api.example.com/v1", api: "openai-responses" },
        other: { baseUrl: "https://x", api: "google" },
      },
    });
    expect(r).toEqual([
      { id: "freetoken", name: "freetoken", kind: "openai", group: "local", baseUrl: "http://127.0.0.1:1919/v1", models: [{ id: "M", name: "Em" }], from: "pi" },
      { id: "remote", name: "remote", kind: "openai", group: "api", baseUrl: "https://api.example.com/v1", key: true, models: [], from: "pi" },
    ]);
  });

  it("zły plik → pusto", () => {
    expect(importPiProviders(null)).toEqual([]);
  });
});

describe("mergeProviders / withDiscovered", () => {
  it("plik wygrywa przy tym samym id albo adresie", () => {
    const own = parseChatConfig({ providers: [{ id: "a", kind: "openai", baseUrl: "http://h/v1", models: [] }] }).providers;
    const extra = importPiProviders({ providers: { a: { baseUrl: "http://z" }, b: { baseUrl: "http://h/v1" }, c: { baseUrl: "http://c" } } });
    expect(mergeProviders(own, extra).map((p) => p.id)).toEqual(["a", "c"]);
  });

  it("dopisuje nowe modele, nie dubluje", () => {
    const p = withDiscovered({ ...DEFAULT_PROVIDERS[2], models: [{ id: "x", name: "X" }] }, ["x", "y"]);
    expect(p.models).toEqual([
      { id: "x", name: "X" },
      { id: "y", name: "y" },
    ]);
  });
});

describe("modele", () => {
  it("firstModel: najpierw lokalne z modelami", () => {
    const local = withDiscovered(DEFAULT_PROVIDERS[2], ["qwen"]);
    expect(firstModel([DEFAULT_PROVIDERS[0], local])).toEqual({ provider: "llama", model: "qwen" });
    expect(firstModel(DEFAULT_PROVIDERS)).toEqual({ provider: "claude", model: "claude-opus-5-5" });
    expect(firstModel([])).toBeNull();
  });

  it("modelLabel: dostawca + model, lokalne samą nazwą, nieznany = id", () => {
    expect(modelLabel(DEFAULT_PROVIDERS, { provider: "claude", model: "haiku" })).toBe("Claude Haiku 4.5");
    const local = withDiscovered(DEFAULT_PROVIDERS[2], ["qwen"]);
    expect(modelLabel([local], { provider: "llama", model: "qwen" })).toBe("qwen");
    expect(modelLabel([], { provider: "x", model: "m1" })).toBe("m1");
  });
});

describe("chatTitle", () => {
  it("krótki bez zmian, białe znaki zwinięte", () => {
    expect(chatTitle("  Jak  działa\n SSE?  ")).toBe("Jak działa SSE?");
  });
  it("długi ucięty na słowie", () => {
    const t = chatTitle("Napisz mi proszę dokładne porównanie trzech bibliotek do wykresów w React, z przykładami");
    expect(t.length).toBeLessThanOrEqual(61);
    expect(t.endsWith("…")).toBe(true);
    expect(t).not.toMatch(/,…$/);
  });
});

describe("parseChat", () => {
  it("zapis i odczyt", () => {
    const c = newChat("id1", 5, { provider: "claude", model: "haiku" }, true);
    expect(parseChat(JSON.stringify(c))).toEqual(c);
  });
  it("zły plik → null", () => {
    expect(parseChat("{")).toBeNull();
    expect(parseChat(JSON.stringify({ version: 2, id: "x", messages: [] }))).toBeNull();
  });
});

describe("grupy dni", () => {
  const now = new Date(2026, 9, 1, 14, 0).getTime();
  const at = (d: number, h = 12) => new Date(2026, 9, 1 + d, h).getTime();
  it("dayGroup", () => {
    expect(dayGroup(at(0, 0), now)).toBe("Dziś");
    expect(dayGroup(at(-1, 23), now)).toBe("Wczoraj");
    expect(dayGroup(at(-1, 0), now)).toBe("Wczoraj");
    expect(dayGroup(at(-6), now)).toBe("Ostatnie 7 dni");
    expect(dayGroup(at(-7), now)).toBe("Ostatnie 30 dni");
    expect(dayGroup(at(-40), now)).toBe("Starsze");
  });
  it("groupChats: najnowsze pierwsze, kolejne grupy", () => {
    const g = groupChats(
      [
        { id: "a", title: "", updated: at(-1) },
        { id: "b", title: "", updated: at(0) },
        { id: "c", title: "", updated: at(0, 9) },
      ],
      now,
    );
    expect(g.map((x) => [x.group, x.chats.map((c) => c.id)])).toEqual([
      ["Dziś", ["b", "c"]],
      ["Wczoraj", ["a"]],
    ]);
  });
});

describe("wireHistory", () => {
  it("pomija błędy i puste odpowiedzi, skleja pytania pod rząd", () => {
    expect(
      wireHistory([
        msg("user", "a"),
        msg("assistant", "", { stopped: true }),
        msg("user", "b"),
        msg("assistant", "x", { error: "500" }),
        msg("user", "c"),
        msg("assistant", "ok"),
      ]),
    ).toEqual([
      { role: "user", content: "a\n\nb\n\nc" },
      { role: "assistant", content: "ok" },
    ]);
  });
});

describe("cliPrompt", () => {
  it("z sesją albo bez historii = sam tekst", () => {
    expect(cliPrompt([msg("user", "a"), msg("assistant", "b")], true, "q")).toBe("q");
    expect(cliPrompt([], false, "q")).toBe("q");
  });
  it("bez sesji: historia jako tło przed pytaniem", () => {
    const p = cliPrompt([msg("user", "a"), msg("assistant", "b")], false, "q");
    expect(p).toContain("Użytkownik: a\n\nAsystent: b");
    expect(p.endsWith("---\n\nq")).toBe(true);
  });
  it("limit: najstarsze wypadają, za długa ostatnia ucięta", () => {
    const long = "x".repeat(5000);
    const p = cliPrompt([msg("user", "stare"), msg("assistant", long), msg("user", long)], false, "q");
    expect(p).not.toContain("stare");
    const huge = cliPrompt([msg("user", "y".repeat(20000))], false, "q");
    expect(huge.length).toBeLessThan(8300);
  });
});

describe("applyEvent", () => {
  it("dopisuje tekst, myślenie, wyszukiwania, źródła bez powtórzeń", () => {
    let m = msg("assistant", "");
    const before = m;
    m = applyEvent(m, { type: "text", text: "Ala" });
    m = applyEvent(m, { type: "text", text: " ma" });
    m = applyEvent(m, { type: "thinking", text: "hm" });
    m = applyEvent(m, { type: "search", query: "kot" });
    m = applyEvent(m, { type: "source", url: "https://a.pl", title: "A" });
    m = applyEvent(m, { type: "source", url: "https://a.pl", title: "A2" });
    expect(before.text).toBe("");
    expect(m).toMatchObject({ text: "Ala ma", thinking: "hm", searches: ["kot"], sources: [{ url: "https://a.pl", title: "A" }] });
  });
});

it("domain", () => {
  expect(domain("https://www.wikipedia.org/wiki/X")).toBe("wikipedia.org");
  expect(domain("nie url")).toBe("nie url");
});

describe("buildChatConfig", () => {
  it("zły chat.json → domyślni + błąd; pi dopisany", () => {
    const r = buildChatConfig("{", JSON.stringify({ providers: { ft: { baseUrl: "http://127.0.0.1:1919/v1" } } }));
    expect(r.errors).toHaveLength(1);
    expect(r.providers.map((p) => p.id)).toEqual([...DEFAULT_PROVIDERS.map((p) => p.id), "ft"]);
  });
  it("zepsuty plik pi pomijany", () => {
    expect(buildChatConfig(JSON.stringify({ providers: DEFAULT_PROVIDERS }), "{").providers).toHaveLength(DEFAULT_PROVIDERS.length);
  });
});

describe("linkCitations", () => {
  const src = [
    { url: "https://a.pl/x", title: 'A "cytat"' },
    { url: "https://b.pl/(y)", title: "B" },
  ];
  it("przypisy na linki, poza kodem i istniejącymi linkami", () => {
    const t = linkCitations("Fakt [1] i [2], [3] nie ma. [1](https://x) zostaje.\n```\narr[1]\n```", src);
    expect(t).toContain('[\\[1\\]](https://a.pl/x "A cytat")');
    expect(t).toContain("[\\[2\\]](https://b.pl/%28y%29 \"B\")");
    expect(t).toContain("[3] nie ma");
    expect(t).toContain("[1](https://x) zostaje");
    expect(t).toContain("arr[1]");
  });
  it("bez źródeł bez zmian", () => {
    expect(linkCitations("a [1]", undefined)).toBe("a [1]");
  });
});

it("greeting", () => {
  expect(greeting(8)).toBe("Dzień dobry");
  expect(greeting(14)).toBe("Miłego popołudnia");
  expect(greeting(20)).toBe("Dobry wieczór");
  expect(greeting(2)).toBe("Nocna zmiana?");
});

describe("extractSources", () => {
  const m = (text: string) => msg("assistant", text);
  it("sekcja Źródła/Sources na końcu → sources, tekst bez niej", () => {
    const r = extractSources(m("Node 24 [1], Node 26 [2].\n\nSources:\n- [1] https://nodejs.org/en/blog\n- [2] Node 26 — https://x.pl/a\n"));
    expect(r.text).toBe("Node 24 [1], Node 26 [2].");
    expect(r.sources).toEqual([
      { url: "https://nodejs.org/en/blog", title: "" },
      { url: "https://x.pl/a", title: "Node 26" },
    ]);
  });
  it("markdown: nagłówek i linki [Tytuł](URL)", () => {
    const r = extractSources(m("Tekst [1].\n\n**Źródła:**\n1. [MDN](https://developer.mozilla.org/x)"));
    expect(r.sources).toEqual([{ url: "https://developer.mozilla.org/x", title: "MDN" }]);
  });
  it("tytuł z wyników wyszukiwania, gdy model podał sam adres", () => {
    const r = extractSources({ ...m("X [1].\n\nŹródła:\n[1] https://r.rs/"), found: [{ url: "https://r.rs/", title: "Releases" }] });
    expect(r.sources).toEqual([{ url: "https://r.rs/", title: "Releases" }]);
  });
  it("lista nie-źródeł albo brak sekcji = bez zmian", () => {
    const a = m("Źródła:\nnie mam żadnych");
    expect(extractSources(a)).toBe(a);
    const b = m("zwykły tekst");
    expect(extractSources(b)).toBe(b);
  });
});

describe("configJson / freeId", () => {
  it("bez dostawców z pi i bez wykrytych modeli, własne nazwy zostają", () => {
    const own = { ...DEFAULT_PROVIDERS[2], models: [{ id: "a", name: "a" }, { id: "b", name: "Bee" }, { id: "c", name: "c" }] };
    const pi = importPiProviders({ providers: { ft: { baseUrl: "http://127.0.0.1:1919/v1" } } });
    const j = JSON.parse(configJson([own, ...pi], { llama: ["a", "b"] }));
    expect(j.providers.map((p: { id: string }) => p.id)).toEqual(["llama"]);
    expect(j.providers[0].models).toEqual([{ id: "b", name: "Bee" }, { id: "c", name: "c" }]);
    expect(parseChatConfig(j).errors).toEqual([]);
  });
  it("freeId", () => {
    expect(freeId("openai", [])).toBe("openai");
    expect(freeId("openai", ["openai", "openai-2"])).toBe("openai-3");
  });
  it("PROVIDER_TEMPLATES przechodzą parseChatConfig", () => {
    expect(parseChatConfig({ providers: PROVIDER_TEMPLATES }).errors).toEqual([]);
  });
});

it("modelsCount", () => {
  expect([1, 2, 5, 12, 22, 25].map(modelsCount)).toEqual(["1 model", "2 modele", "5 modeli", "12 modeli", "22 modele", "25 modeli"]);
});
