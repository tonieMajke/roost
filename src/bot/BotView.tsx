import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import { Clock, MessageSquarePlus, PanelLeft, Plug, Plus, Settings2, ShieldAlert, SlidersHorizontal, Wand2, X } from "lucide-react";
import { backend, type BotChatKind } from "../backend";
import { useT } from "../i18n";
import {
  applyBotEvent,
  botGreeting,
  botId,
  createdBot,
  CREATOR_ID,
  displayName,
  messageSegments,
  newBot,
  newBotChat,
  type ApprovalDecision,
  type ApprovalRequest,
  type BotChat,
  type BotDef,
  type RunInfo,
} from "../bot";
import {
  applyEvent,
  chatMeta,
  chatTitle,
  cliPrompt,
  configJson,
  displayTitle,
  extractSources,
  findModel,
  firstModel,
  isCli,
  modelKey,
  sortChats,
  wireHistory,
  type ChatMeta,
  type Message,
  type ModelRef,
} from "../chat";
import { CONFIRM_MS, confirmClick, isArmed, type Arm } from "../confirm";
import { IconButton } from "../IconButton";
import { Composer } from "../chat/Composer";
import { Markdown } from "../chat/Markdown";
import { ModeTabs, type Mode } from "../chat/ModeTabs";
import { ProvidersDialog } from "../chat/ProvidersDialog";
import { Thread, type RenderBody } from "../chat/Thread";
import { useProviders } from "../chat/useProviders";
import { Avatar } from "./Avatar";
import { BotCard, type CardTab } from "./BotCard";
import { ApprovalCard, ToolCard } from "./Cards";
import "../chat/chat.css";
import "./bot.css";

const SELECTED_KEY = "aw-bot-selected";

type Live = { chat: BotChat; msgId: string; stop: () => void; started: number };
/** Rozmowa albo przebieg z harmonogramu na liście pod botem. */
type Entry = ChatMeta & { kind: BotChatKind };
const kindOf = (c: BotChat): BotChatKind => (c.routine ? "runs" : "chats");

type Props = {
  mode: Mode;
  onMode(m: Mode): void;
  /** Zakładka widoczna: tylko wtedy Enter/Esc rozstrzygają zgodę. */
  active: boolean;
  onTitle(title: string): void;
  railOpen: boolean;
  onToggleRail(): void;
  onOpenAppearance(): void;
  /** Kliknięte powiadomienie o przebiegu (`seq` – kolejne kliknięcie tego samego też działa). */
  openRun?: { bot: string; chat: string; seq: number } | null;
};

export function BotView({ mode, onMode, active, onTitle, railOpen, onToggleRail, onOpenAppearance, openRun }: Props) {
  const { t } = useT();
  const { providers, offline, errors, setErrors, discovered, reload } = useProviders();
  const [bots, setBots] = useState<BotDef[]>([]);
  const [selected, setSelected] = useState<string | null>(() => {
    try {
      return localStorage.getItem(SELECTED_KEY);
    } catch {
      return null;
    }
  });
  const [list, setList] = useState<Entry[]>([]);
  // Przebiegi harmonogramu w toku (proces główny): kropka przy bocie i na liście.
  const [runs, setRuns] = useState<RunInfo[]>([]);
  const [chat, setChat] = useState<BotChat | null>(null);
  const [approvals, setApprovals] = useState<ApprovalRequest[]>([]);
  const [providersOpen, setProvidersOpen] = useState(false);
  const [card, setCard] = useState<CardTab | null>(null);
  const [inject, setInject] = useState<{ text: string; seq: number } | null>(null);
  const [armedId, setArmedId] = useState<string | null>(null);
  const armRef = useRef<Arm>(null);
  // Kilka botów może pracować naraz: trwające odpowiedzi po id rozmowy.
  const lives = useRef(new Map<string, Live>());
  const [, setTick] = useState(0);
  const rerender = () => setTick((n) => n + 1);
  const chatRef = useRef<BotChat | null>(null);
  chatRef.current = chat;
  const scroller = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  const frame = useRef(0);

  const bot = bots.find((b) => b.id === selected) ?? bots[0] ?? null;
  const model: ModelRef | null = bot?.model && findModel(providers, bot.model) ? bot.model : firstModel(providers);

  const loadBots = () =>
    void backend
      .botList()
      .then((r) => {
        setBots(r.bots);
        if (r.errors.length) setErrors((prev) => [...prev, ...r.errors]);
      })
      .catch((e: unknown) => setErrors((prev) => [...prev, t("bot.view.errBots", { e: String(e) })]));

  useEffect(() => {
    loadBots();
    void backend.botApprovals().then(setApprovals).catch(() => undefined);
    void backend.botRuns().then(setRuns).catch(() => undefined);
    return backend.onBotApproval((e) =>
      setApprovals((prev) => (e.type === "request" ? [...prev, e.req] : prev.filter((a) => a.id !== e.id))),
    );
  }, [setErrors]); // eslint-disable-line react-hooks/exhaustive-deps

  const loadList = (id: string, alive: () => boolean = () => true) =>
    void Promise.all([backend.botChatList(id, "chats"), backend.botChatList(id, "runs")])
      .then(([chats, runList]) => {
        if (!alive()) return;
        const all: Entry[] = [...chats.map((c) => ({ ...c, kind: "chats" as const })), ...runList.map((c) => ({ ...c, kind: "runs" as const }))];
        setList(all.sort((a, b) => b.updated - a.updated));
      })
      .catch(() => undefined);

  useEffect(() => {
    if (!bot) return;
    try {
      localStorage.setItem(SELECTED_KEY, bot.id);
    } catch {
      // tryb prywatny
    }
    let on = true;
    loadList(bot.id, () => on);
    return () => {
      on = false;
    };
  }, [bot?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Przebieg z harmonogramu zmienił stan: lista z dysku, otwarty przebieg też (pisze go proces główny).
  useEffect(
    () =>
      backend.onBotRun((r) => {
        setRuns((prev) => [...prev.filter((x) => x.chat !== r.chat), ...(r.state === "done" || r.state === "error" ? [] : [r])]);
        if (shownBot.current === r.bot) loadList(r.bot);
        if (chatRef.current?.id === r.chat && !lives.current.has(r.chat))
          void backend.botChatLoad(r.bot, "runs", r.chat).then((c) => c && chatRef.current?.id === c.id && setChat(c), () => undefined);
      }),
    [], // eslint-disable-line react-hooks/exhaustive-deps
  );

  useEffect(() => {
    onTitle(bot ? (chat ? `${displayName(bot)}: ${displayTitle(chat)}` : displayName(bot)) : t("bot.view.title"));
  }, [bot, chat, onTitle, t]);

  useEffect(() => {
    if (armedId === null) return;
    const t = setTimeout(() => setArmedId(null), CONFIRM_MS);
    return () => clearTimeout(t);
  }, [armedId]);

  useLayoutEffect(() => {
    const el = scroller.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  });
  const onScroll = () => {
    const el = scroller.current;
    if (el) stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
  };

  // Lista rozmów należy do wybranego bota; odpowiedź innego bota kończy się w tle.
  const shownBot = useRef<string | null>(null);
  shownBot.current = bot?.id ?? null;
  const save = (c: BotChat) => {
    if (shownBot.current === c.bot) setList((prev) => sortChats([...prev.filter((x) => x.id !== c.id), { ...chatMeta(c), kind: kindOf(c) }]));
    void backend.botChatSave(c).catch((e: unknown) => setErrors((prev) => [...prev, t("bot.view.errSaveChat", { e: String(e) })]));
  };

  const pickBot = (id: string) => {
    if (id === bot?.id) return;
    setSelected(id);
    setList([]);
    const live = [...lives.current.values()].find((l) => l.chat.bot === id);
    setChat(live ? live.chat : null);
    stick.current = true;
  };

  const pickModel = (m: ModelRef) => {
    if (!bot) return;
    const next = { ...bot, model: m };
    setBots((prev) => prev.map((b) => (b.id === bot.id ? next : b)));
    void backend.botSave(next).catch((e: unknown) => setErrors((prev) => [...prev, t("bot.view.errSaveBot", { e: String(e) })]));
  };

  /** Odpowiedź na `base`, której ostatnia wiadomość to pytanie użytkownika. */
  const respond = (base: BotChat, ref: ModelRef) => {
    const found = findModel(providers, ref);
    if (!found) return;
    const { provider } = found;
    const prior = base.messages.slice(0, -1);
    const question = base.messages[base.messages.length - 1];
    const key = modelKey(ref);
    const session = base.cli[key];
    const reply: Message = { id: crypto.randomUUID(), role: "assistant", text: "", at: Date.now(), model: ref };
    let current: BotChat = { ...base, model: ref, updated: Date.now(), messages: [...base.messages, reply] };
    const newSession = provider.kind === "claude-cli" ? crypto.randomUUID() : undefined;
    if (newSession && !session) current = { ...current, cli: { ...current.cli, [key]: newSession } };

    const started = performance.now();
    const flush = () => {
      frame.current = 0;
      const l = lives.current.get(current.id);
      if (l && chatRef.current?.id === l.chat.id) setChat(l.chat);
    };
    const update = (fn: (c: BotChat) => BotChat) => {
      const l = lives.current.get(current.id);
      if (l) lives.current.set(current.id, { ...l, chat: fn(l.chat) });
    };

    const stop = backend.botSend(
      current,
      {
        provider,
        model: ref.model,
        system: "", // proces główny składa prompt bota
        messages: wireHistory(base.messages),
        prompt: cliPrompt(prior, isCli(provider) && session !== undefined, question.text),
        session: session ? { id: session, resume: true } : newSession ? { id: newSession, resume: false } : undefined,
        search: false,
      },
      (e) => {
        if (e.type === "session") {
          update((c) => ({ ...c, cli: { ...c.cli, [key]: e.id } }));
        } else if (e.type === "done" || e.type === "error") {
          cancelAnimationFrame(frame.current);
          frame.current = 0;
          const l = lives.current.get(current.id);
          if (!l) return;
          const ms = Math.round(performance.now() - started);
          let final: BotChat = {
            ...l.chat,
            messages: l.chat.messages.map((m) => (m.id === reply.id ? { ...extractSources(applyEvent(m, e)), ms } : m)),
          };
          // Sesja CLI, która nie powstała albo zniknęła, nie może być wznawiana (jak w Czacie).
          const lost = e.type === "error" && /No conversation found|no rollout found|thread not found/i.test(e.message);
          const last = final.messages[final.messages.length - 1];
          if (lost || (newSession && last?.text === "" && (e.type === "error" || last.stopped))) {
            const { [key]: _, ...rest } = final.cli;
            final = { ...final, cli: rest };
          }
          lives.current.delete(current.id);
          if (chatRef.current?.id === final.id) setChat(final);
          save(final);
          rerender();
        } else {
          update((c) => applyBotEvent(c, reply.id, e));
          frame.current ||= requestAnimationFrame(flush);
          // Kreator utworzył albo zmienił bota: lista od razu z dysku.
          if (e.type === "tool_result" && !e.error) {
            const name = lives.current.get(current.id)?.chat.calls.find((c) => c.id === e.id)?.name;
            if (name === "bot_create" || name === "bot_update") loadBots();
          }
        }
      },
    );
    lives.current.set(current.id, { chat: current, msgId: reply.id, stop, started });
    setChat(current);
    stick.current = true;
    save(current);
    rerender();
  };

  const send = (text: string) => {
    if (!bot || !model) return;
    if (chat && lives.current.has(chat.id)) return;
    const now = Date.now();
    const base = chat ?? newBotChat(crypto.randomUUID(), bot.id, now, model);
    const q: Message = { id: crypto.randomUUID(), role: "user", text, at: now };
    respond({ ...base, title: base.title || chatTitle(text), messages: [...base.messages, q] }, model);
  };

  const stopLive = () => {
    const l = chat ? lives.current.get(chat.id) : undefined;
    if (!l) return;
    lives.current.set(l.chat.id, { ...l, chat: { ...l.chat, messages: l.chat.messages.map((m) => (m.id === l.msgId ? { ...m, stopped: true } : m)) } });
    l.stop();
  };

  /** Rozmowa obcięta przed wiadomością `index`: bez późniejszych wywołań, sesje CLI od nowa. */
  const cut = (c: BotChat, index: number): BotChat => {
    const kept = c.messages.slice(0, index);
    const ids = new Set(kept.map((m) => m.id));
    return { ...c, messages: kept, calls: c.calls.filter((x) => ids.has(x.message)), cli: {} };
  };

  const retry = () => {
    if (!chat || lives.current.has(chat.id) || !model) return;
    const lastUser = chat.messages.map((m) => m.role).lastIndexOf("user");
    if (lastUser < 0) return;
    const c = cut(chat, lastUser + 1);
    respond({ ...c, cli: chat.cli }, model);
  };

  const edit = (index: number) => {
    if (!chat || lives.current.has(chat.id)) return;
    const text = chat.messages[index]?.text ?? "";
    const c = cut(chat, index);
    setChat(c);
    save(c);
    setInject({ text, seq: Date.now() });
  };

  const open = async (id: string, kind: BotChatKind, botId = bot?.id) => {
    if (!botId || chat?.id === id) return;
    const l = lives.current.get(id);
    if (l) return setChat(l.chat);
    const c = await backend.botChatLoad(botId, kind, id).catch(() => null);
    if (!c) return setErrors((prev) => [...prev, t("bot.view.errOpen")]);
    setChat(c);
    stick.current = true;
  };

  // Kliknięte powiadomienie: bot i jego przebieg (karta zgody na dole wątku, przewinięta do niej).
  useEffect(() => {
    if (!openRun) return;
    setCard(null);
    pickBot(openRun.bot);
    void open(openRun.chat, "runs", openRun.bot);
  }, [openRun?.seq]); // eslint-disable-line react-hooks/exhaustive-deps

  const newConversation = () => {
    setChat(null);
    setInject({ text: "", seq: Date.now() });
  };

  const remove = (id: string, kind: BotChatKind) => {
    if (!bot) return;
    const r = confirmClick(armRef.current, `b:${id}`, Date.now());
    armRef.current = r.arm;
    setArmedId(r.fire ? null : isArmed(r.arm, `b:${id}`, Date.now()) ? id : null);
    if (!r.fire) return;
    lives.current.get(id)?.stop();
    if (chat?.id === id) setChat(null);
    setList((prev) => prev.filter((c) => c.id !== id));
    void backend.botChatDelete(bot.id, kind, id).catch(() => undefined);
  };

  const addBot = () => {
    const def = newBot(botId(t("bot.newName"), bots.map((b) => b.id)), Date.now(), { model });
    void backend
      .botCreate(def)
      .then((created) => {
        setBots((prev) => [...prev.filter((b) => !b.builtin), created, ...prev.filter((b) => b.builtin)]);
        pickBot(created.id);
        setCard("persona");
      })
      .catch((e: unknown) => setErrors((prev) => [...prev, t("bot.view.errNewBot", { e: String(e) })]));
  };

  const decide = (id: string, d: ApprovalDecision) => {
    setApprovals((prev) => prev.filter((a) => a.id !== id));
    void backend.botApprove(id, d).catch((e: unknown) => setErrors((prev) => [...prev, t("bot.view.errApprove", { e: String(e) })]));
  };

  const working = (id: string) => [...lives.current.values()].some((l) => l.chat.bot === id) || runs.some((r) => r.bot === id && r.state === "running");
  const waiting = (id: string) => approvals.some((a) => a.bot === id);

  const renderBody: RenderBody = (m, isLive) => {
    const calls = chat?.calls.filter((c) => c.message === m.id) ?? [];
    if (calls.length === 0) return null;
    return (
      <div className="bot-body">
        {messageSegments(m.text, calls).map((s, i) =>
          s.kind === "text" ? (
            <div key={i} className={`chat-md${isLive ? " is-live" : ""}`}>
              <Markdown text={s.text.trim()} />
            </div>
          ) : (
            <div key={i} className="bot-tools">
              {s.calls.map((c) => {
                const made = createdBot(c);
                const target = made && bots.find((b) => b.id === made.id);
                return <ToolCard key={c.id} call={c} live={isLive} talk={target ? { name: target.name, onClick: () => pickBot(target.id) } : undefined} />;
              })}
            </div>
          ),
        )}
      </div>
    );
  };

  const live = chat ? lives.current.get(chat.id) : undefined;
  const messages = chat?.messages ?? [];
  const empty = messages.length === 0;
  const pending = chat ? approvals.filter((a) => a.chat === chat.id) : [];
  const composer = (
    <Composer
      providers={providers}
      offline={offline}
      model={model}
      onModel={pickModel}
      search={false}
      onSearch={() => undefined}
      searchToggle={false}
      busy={live !== undefined}
      onSend={send}
      onStop={stopLive}
      inject={inject}
      big={empty}
      onProviders={() => setProvidersOpen(true)}
      placeholder={bot ? t("bot.view.placeholder", { name: displayName(bot) }) : undefined}
    />
  );
  const regular = bots.filter((b) => !b.builtin);
  const creator = bots.find((b) => b.id === CREATOR_ID);

  return (
    <div className="chat bot-view">
      <aside className={`chat-side${railOpen ? "" : " is-closed"}`}>
        <header className="rail-head chat-side-head">
          <ModeTabs mode={mode} onMode={onMode} />
          <IconButton icon={PanelLeft} label={railOpen ? t("bot.view.listClose") : t("bot.view.listOpen")} shortcut="Ctrl+Alt+B" onClick={onToggleRail} />
        </header>
        <nav className="chat-list bot-list">
          <div className="rail-label">{t("bot.view.yours")}</div>
          {regular.length === 0 && <p className="chat-list-empty">{t("bot.view.empty")}</p>}
          {regular.map((b) => (
            <div key={b.id} className="bot-entry">
              <button type="button" className={`bot-item${b.id === bot?.id ? " is-active" : ""}`} onClick={() => pickBot(b.id)}>
                <Avatar bot={b} />
                <span className="bot-item-name">{b.name}</span>
                {waiting(b.id) ? (
                  <span className="bot-dot is-approval" title={t("bot.view.waitingTitle")} />
                ) : working(b.id) ? (
                  <span className="bot-dot is-working" title={t("bot.view.workingTitle")} />
                ) : null}
              </button>
              {b.id === bot?.id && (
                <div className="bot-chats">
                  <button type="button" className="bot-chat-new" onClick={newConversation}>
                    <MessageSquarePlus aria-hidden />
                    <span>{t("bot.view.newChat")}</span>
                  </button>
                  {list.map((c) => {
                    const run = runs.find((r) => r.chat === c.id);
                    const waitingRun = run?.state === "waiting_approval";
                    return (
                    <div
                      key={c.id}
                      className={`chat-item${c.id === chat?.id ? " is-active" : ""}${lives.current.has(c.id) || run ? " is-live" : ""}${c.kind === "runs" ? " is-run" : ""}`}
                      onClick={() => void open(c.id, c.kind)}
                    >
                      {c.kind === "runs" &&
                        (waitingRun ? <ShieldAlert className="bot-run-icon is-approval" aria-label={t("bot.view.waitingAria")} /> : <Clock className="bot-run-icon" aria-label={t("bot.view.scheduled")} />)}
                      <span className="chat-item-title" title={displayTitle(c)}>
                        {displayTitle(c)}
                      </span>
                      {!run && <IconButton
                        icon={X}
                        label={t("bot.view.deleteChat", { title: displayTitle(c) })}
                        className={`proj-close${armedId === c.id ? " is-confirm" : ""}`}
                        title={armedId === c.id ? t("bot.view.deleteChatConfirm") : t("bot.view.deleteChatTitle")}
                        onClick={(e) => {
                          e.stopPropagation();
                          remove(c.id, c.kind);
                        }}
                      >
                        {armedId === c.id ? t("bot.sure") : undefined}
                      </IconButton>}
                    </div>
                    );
                  })}
                </div>
              )}
            </div>
          ))}
        </nav>
        <div className="bot-side-actions">
          <button type="button" className="bot-side-btn" onClick={addBot}>
            <Plus aria-hidden />
            <span>{t("bot.view.newBot")}</span>
          </button>
          {creator && (
            <button type="button" className={`bot-side-btn${creator.id === bot?.id ? " is-active" : ""}`} onClick={() => pickBot(creator.id)} title={t("bot.view.creatorTitle")}>
              <Wand2 aria-hidden />
              <span>{t("bot.creator.name")}</span>
              {waiting(creator.id) ? <span className="bot-dot is-approval" /> : working(creator.id) ? <span className="bot-dot is-working" /> : null}
            </button>
          )}
        </div>
        <footer className="rail-foot">
          <IconButton icon={Plug} label={t("bot.view.providers")} onClick={() => setProvidersOpen(true)} />
          <IconButton icon={SlidersHorizontal} label={t("bot.view.appearance")} onClick={onOpenAppearance} />
        </footer>
      </aside>
      <main className="chat-main" style={bot ? ({ "--bot": bot.color } as CSSProperties) : undefined}>
        {errors.length > 0 && (
          <div className="config-errors">
            <span>{errors.join(" · ")}</span>
            <IconButton icon={X} label={t("bot.view.closeErrors")} onClick={() => setErrors([])} />
          </div>
        )}
        {bot && (
          <header className="bot-head">
            <Avatar bot={bot} />
            <span className="bot-head-name">{displayName(bot)}</span>
            <span className="bot-head-title">{chat && !empty ? displayTitle(chat) : ""}</span>
            {chat?.toolsUnsupported && <span className="bot-note">{t("bot.view.noTools")}</span>}
            <button type="button" className="bot-head-card" onClick={() => setCard("persona")} title={t("bot.view.cardTitle")}>
              <Settings2 aria-hidden />
              <span>{t("bot.view.cardBtn")}</span>
            </button>
          </header>
        )}
        {!bot ? (
          <div className="chat-welcome">
            <p className="chat-list-empty">{t("bot.view.loadingBots")}</p>
          </div>
        ) : empty ? (
          <div className="chat-welcome">
            <div className="bot-hello">
              <Avatar bot={bot} size="lg" />
              <h1 className="bot-hello-name">{displayName(bot)}</h1>
              <p className="bot-hello-text">{botGreeting(bot)}</p>
              {chat?.toolsUnsupported && <p className="bot-note">{t("bot.view.noToolsNote")}</p>}
            </div>
            {composer}
          </div>
        ) : (
          <>
            <div className="chat-scroll" ref={scroller} onScroll={onScroll}>
              <div className="chat-column">
                <Thread messages={messages} providers={providers} liveId={live ? live.msgId : null} onRetry={retry} onEdit={edit} renderBody={renderBody} />
                {pending.map((a) => (
                  <ApprovalCard key={a.id} req={a} botName={displayName(bot)} active={active && a.id === pending[0].id} onDecide={(d) => decide(a.id, d)} />
                ))}
              </div>
            </div>
            <div className="chat-dock">
              {composer}
              <p className="chat-hint">{t("bot.view.hint")}</p>
            </div>
          </>
        )}
      </main>
      {card && bot && (
        <BotCard
          key={bot.id}
          bot={bot}
          providers={providers}
          offline={offline}
          tab={card}
          onSaved={(b) => setBots((prev) => prev.map((x) => (x.id === b.id ? b : x)))}
          onOpenRun={(id) => {
            setCard(null);
            void open(id, "runs");
          }}
          onDeleted={(id) => {
            for (const l of lives.current.values()) if (l.chat.bot === id) l.stop();
            setCard(null);
            setChat(null);
            setBots((prev) => prev.filter((b) => b.id !== id));
            setSelected(null);
          }}
          onProviders={() => setProvidersOpen(true)}
          onClose={() => setCard(null)}
        />
      )}
      {providersOpen && (
        <ProvidersDialog
          providers={providers}
          offline={offline}
          onSave={async (next) => {
            await backend.chatSaveConfig(configJson(next, discovered.current));
            await reload();
          }}
          onClose={() => setProvidersOpen(false)}
        />
      )}
    </div>
  );
}
