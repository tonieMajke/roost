import { describe, expect, it } from "vitest";
import type { BotChat, BotDef } from "../bot";
import type { ChatEvent, ChatRequest, ProviderDef } from "../chat";
import { askBot } from "./askBot";

const provider = { id: "llama", name: "Lokalny", kind: "openai", group: "local", baseUrl: "http://x", models: [{ id: "qwen", name: "Qwen" }] } as unknown as ProviderDef;
const bot = { id: "bosman", name: "Bosman", model: null } as unknown as BotDef;

/** Udawane API: odpowiedź bota sterowana ręcznie, zapisy rozmów zbierane. */
function api() {
  const saved: BotChat[] = [];
  const reqs: ChatRequest[] = [];
  let emit: ((e: ChatEvent) => void) | null = null;
  let stopped = 0;
  return {
    saved,
    reqs,
    stopped: () => stopped,
    emit: (e: ChatEvent) => emit!(e),
    a: {
      botList: async () => ({ bots: [bot], errors: [] }),
      chatConfig: async () => ({ providers: [provider] }) as never,
      botSend: (_c: BotChat, req: ChatRequest, on: (e: ChatEvent) => void) => {
        reqs.push(req);
        emit = on;
        return () => void stopped++;
      },
      botChatSave: async (c: BotChat) => void saved.push(c),
    },
  };
}

const tick = () => new Promise((r) => setTimeout(r, 0));

describe("askBot", () => {
  it("nowa rozmowa bota z pierwszym modelem z Czatu; odpowiedź wraca, rozmowa zapisana", async () => {
    const x = api();
    const p = askBot(x.a, "bosman", "Co w Ruście?", new AbortController().signal);
    await tick();
    expect(x.reqs[0]).toMatchObject({ model: "qwen", prompt: "Co w Ruście?", messages: [{ role: "user", content: "Co w Ruście?" }] });
    x.emit({ type: "text", text: "Ahoj! Nowy Rust." });
    x.emit({ type: "done" });
    expect(await p).toBe("Ahoj! Nowy Rust.");
    const last = x.saved.at(-1)!;
    expect(last).toMatchObject({ bot: "bosman", title: "Co w Ruście?" });
    expect(last.messages.map((m) => m.text)).toEqual(["Co w Ruście?", "Ahoj! Nowy Rust."]);
  });

  it("błąd bota odrzuca, przerwanie zatrzymuje bota, po czasie wraca to, co jest", async () => {
    const x = api();
    const p = askBot(x.a, "bosman", "?", new AbortController().signal);
    await tick();
    x.emit({ type: "error", message: "401" });
    await expect(p).rejects.toThrow("401");

    const ac = new AbortController();
    const q = askBot(x.a, "bosman", "?", ac.signal);
    await tick();
    ac.abort();
    await expect(q).rejects.toThrow("przerwano");
    expect(x.stopped()).toBe(1);

    const slow = askBot(x.a, "bosman", "?", new AbortController().signal, 10);
    await tick();
    x.emit({ type: "text", text: "Szukam…" });
    expect(await slow).toMatch(/^Szukam…\n\n\(bot pracuje dalej/);
    await expect(askBot(x.a, "kot", "?", new AbortController().signal)).rejects.toThrow("nie ma bota „kot”");
  });
});
