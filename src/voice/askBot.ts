// Pytanie do bota z zakładki Bot zadane z rozmowy głosowej (narzędzie `ask_bot`): nowa rozmowa
// bota, zapisana jak z zakładki, a do rozmówcy wraca tekst odpowiedzi.

import { applyBotEvent, newBotChat, type BotChat } from "../bot";
import { chatTitle, findModel, firstModel, isCli, type ChatEvent, type ChatRequest, type Message } from "../chat";
import type { Backend } from "../backend";

/** Po tym czasie rozmówca dostaje to, co już jest; bot pracuje dalej, wynik zostaje w zakładce Bot. */
export const BOT_WAIT_MS = 120_000;
const ANSWER_LIMIT = 6000;

type BotBackend = Pick<Backend, "botList" | "chatConfig" | "botSend" | "botChatSave">;

export async function askBot(api: BotBackend, botId: string, question: string, signal: AbortSignal, waitMs = BOT_WAIT_MS): Promise<string> {
  const [{ bots }, config] = await Promise.all([api.botList(), api.chatConfig()]);
  const bot = bots.find((b) => b.id === botId);
  if (!bot) throw new Error(`nie ma bota „${botId}”`);
  // Jak w zakładce Bot: model bota, a gdy go nie ma w Czacie – pierwszy z listy.
  const ref = bot.model && findModel(config.providers, bot.model) ? bot.model : firstModel(config.providers);
  const found = ref ? findModel(config.providers, ref) : null;
  if (!ref || !found) throw new Error("nie ma modelu dla bota – dodaj dostawcę w zakładce Czat");
  const m = { ref, provider: found.provider };
  const now = Date.now();
  const q: Message = { id: crypto.randomUUID(), role: "user", text: question, at: now };
  const reply: Message = { id: crypto.randomUUID(), role: "assistant", text: "", at: now, model: m.ref };
  const session = m.provider.kind === "claude-cli" ? crypto.randomUUID() : undefined;
  let chat: BotChat = { ...newBotChat(crypto.randomUUID(), bot.id, now, m.ref), title: chatTitle(question), messages: [q, reply] };
  if (session) chat = { ...chat, cli: { [`${m.ref.provider}/${m.ref.model}`]: session } };
  const req: ChatRequest = {
    provider: m.provider,
    model: m.ref.model,
    system: "", // proces główny składa prompt bota
    messages: [{ role: "user", content: question }],
    prompt: question,
    ...(session && isCli(m.provider) ? { session: { id: session, resume: false } } : {}),
    search: false,
  };
  const save = (c: BotChat) => void api.botChatSave(c).catch(() => undefined);
  save(chat);

  return new Promise<string>((resolve, reject) => {
    let settled = false;
    const text = () => chat.messages.find((x) => x.id === reply.id)?.text.trim() ?? "";
    const finish = (f: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal.removeEventListener("abort", onAbort);
      f();
    };
    const stop = api.botSend(chat, req, (e: ChatEvent) => {
      chat = applyBotEvent(chat, reply.id, e);
      if (e.type !== "done" && e.type !== "error") return;
      save(chat);
      if (e.type === "error") finish(() => reject(new Error(e.message)));
      else finish(() => resolve(clip(text()) || "(bot nic nie odpowiedział)"));
    });
    // Przerwana odpowiedź rozmówcy zatrzymuje też bota (zapis zostaje z tym, co zdążył).
    const onAbort = () => {
      stop();
      finish(() => reject(new Error("przerwano")));
    };
    signal.addEventListener("abort", onAbort, { once: true });
    const timer = setTimeout(
      () => finish(() => resolve(`${clip(text()) || "(jeszcze nic)"}\n\n(bot pracuje dalej – pełna odpowiedź będzie w zakładce Bot; może czekać tam na zgodę)`)),
      waitMs,
    );
  });
}

const clip = (t: string) => (t.length > ANSWER_LIMIT ? `${t.slice(0, ANSWER_LIMIT)}…` : t);
