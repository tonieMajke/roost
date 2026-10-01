import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { MessageSquarePlus, PanelLeft, Plug, Search, SlidersHorizontal, X } from "lucide-react";
import { backend } from "../backend";
import {
  applyEvent,
  extractSources,
  chatMeta,
  chatTitle,
  cliPrompt,
  DEFAULT_SYSTEM,
  displayTitle,
  findModel,
  firstModel,
  greeting,
  groupChats,
  isCli,
  modelKey,
  newChat,
  SEARCH_SYSTEM,
  sortChats,
  supportsSearch,
  withDiscovered,
  wireHistory,
  type Chat,
  type ChatMeta,
  type Message,
  type ModelRef,
  type ProviderDef,
  configJson,
} from "../chat";
import { CONFIRM_MS, confirmClick, isArmed, type Arm } from "../confirm";
import { IconButton } from "../IconButton";
import { Composer } from "./Composer";
import { Thread } from "./Thread";
import { ProvidersDialog } from "./ProvidersDialog";
import { ModeTabs, type Mode } from "./ModeTabs";
import "./chat.css";

const MODEL_KEY = "aw-chat-model";
const SEARCH_KEY = "aw-chat-search";

function stored<T>(key: string): T | null {
  try {
    const v = localStorage.getItem(key);
    return v === null ? null : (JSON.parse(v) as T);
  } catch {
    return null;
  }
}
function store(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // tryb prywatny: tylko bez zapamiętania
  }
}

type Live = { chat: Chat; msgId: string; stop: () => void; started: number };

type Props = {
  mode: Mode;
  onMode(m: Mode): void;
  /** Tytuł okna: temat otwartej rozmowy. */
  onTitle(title: string): void;
  railOpen: boolean;
  onToggleRail(): void;
  onOpenAppearance(): void;
};

export function ChatView({ mode, onMode, onTitle, railOpen, onToggleRail, onOpenAppearance }: Props) {
  const [providers, setProviders] = useState<ProviderDef[]>([]);
  const [offline, setOffline] = useState<Record<string, string>>({});
  const [errors, setErrors] = useState<string[]>([]);
  const [list, setList] = useState<ChatMeta[]>([]);
  const [chat, setChat] = useState<Chat | null>(null);
  const [model, setModel] = useState<ModelRef | null>(() => stored<ModelRef>(MODEL_KEY));
  const [search, setSearch] = useState(() => stored<boolean>(SEARCH_KEY) ?? false);
  const [live, setLive] = useState<Live | null>(null);
  const [inject, setInject] = useState<{ text: string; seq: number } | null>(null);
  const [filter, setFilter] = useState("");
  const [providersOpen, setProvidersOpen] = useState(false);
  const [editing, setEditing] = useState<{ id: string; value: string } | null>(null);
  const [armedId, setArmedId] = useState<string | null>(null);
  const armRef = useRef<Arm>(null);
  const liveRef = useRef<Live | null>(null);
  const chatRef = useRef<Chat | null>(null);
  chatRef.current = chat;
  const scroller = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  const frame = useRef(0);

  // Konfiguracja, potem wykrywanie modeli u każdego dostawcy z `discover` (równolegle).
  // `gen` odrzuca wyniki starszego wczytania (zapis w oknie „Dostawcy” wczytuje od nowa).
  const gen = useRef(0);
  const discovered = useRef<Record<string, string[]>>({});
  const loadConfig = useCallback(async () => {
    const my = ++gen.current;
    const cfg = await backend.chatConfig().catch((e: unknown) => ({ providers: [] as ProviderDef[], errors: [String(e)] }));
    if (my !== gen.current) return;
    setProviders(cfg.providers);
    setErrors(cfg.errors);
    setOffline({});
    discovered.current = {};
    for (const p of cfg.providers.filter((p) => p.discover)) {
      backend
        .chatModels(p)
        .then((ids) => {
          if (my !== gen.current) return;
          discovered.current[p.id] = ids;
          setProviders((prev) => prev.map((x) => (x.id === p.id ? withDiscovered(x, ids) : x)));
        })
        .catch((e: unknown) => my === gen.current && setOffline((prev) => ({ ...prev, [p.id]: e instanceof Error ? e.message : String(e) })));
    }
  }, []);

  useEffect(() => {
    let on = true;
    void loadConfig();
    void backend
      .chatList()
      .then((l) => on && setList(l))
      .catch(() => undefined);
    return () => {
      on = false;
      gen.current++;
    };
  }, [loadConfig]);

  // Brak zapamiętanego modelu (pierwszy start) → pierwszy dostępny, gdy lista się zapełni.
  useEffect(() => {
    if (model && providers.some((p) => p.id === model.provider)) return;
    const first = firstModel(providers);
    if (first) setModel(first);
  }, [providers, model]);

  useEffect(() => {
    onTitle(chat ? displayTitle(chat) : "Nowa rozmowa");
  }, [chat, onTitle]);

  useEffect(() => {
    if (armedId === null) return;
    const t = setTimeout(() => setArmedId(null), CONFIRM_MS);
    return () => clearTimeout(t);
  }, [armedId]);

  // Przewijanie: trzyma dół, dopóki użytkownik sam nie przewinie w górę.
  useLayoutEffect(() => {
    const el = scroller.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  });
  const onScroll = () => {
    const el = scroller.current;
    if (el) stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
  };

  const save = useCallback((c: Chat) => {
    setList((prev) => sortChats([...prev.filter((x) => x.id !== c.id), chatMeta(c)]));
    void backend.chatSave(c).catch((e: unknown) => setErrors((prev) => [...prev, `zapis rozmowy: ${String(e)}`]));
  }, []);

  const pickModel = (m: ModelRef) => {
    setModel(m);
    store(MODEL_KEY, m);
    if (chat && !live) setChat({ ...chat, model: m });
  };
  const pickSearch = (on: boolean) => {
    setSearch(on);
    store(SEARCH_KEY, on);
  };

  /** Odpowiedź na rozmowę `base`, której ostatnia wiadomość to pytanie użytkownika. */
  const respond = (base: Chat, ref: ModelRef) => {
    const found = findModel(providers, ref);
    if (!found) return;
    const { provider } = found;
    const prior = base.messages.slice(0, -1);
    const question = base.messages[base.messages.length - 1];
    const key = modelKey(ref);
    const session = base.cli[key];
    const withSearch = search && supportsSearch(provider);
    const reply: Message = { id: crypto.randomUUID(), role: "assistant", text: "", at: Date.now(), model: ref };
    let current: Chat = { ...base, model: ref, search: withSearch, updated: Date.now(), messages: [...base.messages, reply] };
    // claude dostaje własne id nowej sesji; codex podaje swoje w zdarzeniu `session`.
    const newSession = provider.kind === "claude-cli" ? crypto.randomUUID() : undefined;
    if (newSession && !session) current = { ...current, cli: { ...current.cli, [key]: newSession } };

    const started = performance.now();
    const flush = () => {
      frame.current = 0;
      const l = liveRef.current;
      if (l && chatRef.current?.id === l.chat.id) setChat(l.chat);
    };
    const update = (fn: (m: Message) => Message, extra?: (c: Chat) => Chat) => {
      const l = liveRef.current;
      if (!l) return;
      let c = { ...l.chat, messages: l.chat.messages.map((m) => (m.id === reply.id ? fn(m) : m)) };
      if (extra) c = extra(c);
      liveRef.current = { ...l, chat: c };
    };

    const stop = backend.chatSend(
      {
        provider,
        model: ref.model,
        system: DEFAULT_SYSTEM + (withSearch ? SEARCH_SYSTEM : ""),
        messages: wireHistory(base.messages),
        // Dostawcy HTTP biorą `messages`; `prompt` z historią czyta CLI i pi (wyszukiwanie).
        prompt: cliPrompt(prior, isCli(provider) && session !== undefined, question.text),
        session: session ? { id: session, resume: true } : newSession ? { id: newSession, resume: false } : undefined,
        search: withSearch,
      },
      (e) => {
        if (e.type === "session") {
          update((m) => m, (c) => ({ ...c, cli: { ...c.cli, [key]: e.id } }));
        } else if (e.type === "done" || e.type === "error") {
          cancelAnimationFrame(frame.current);
          frame.current = 0;
          if (!liveRef.current) return;
          update((m) => ({ ...extractSources(applyEvent(m, e)), ms: Math.round(performance.now() - started) }));
          const final = liveRef.current!.chat;
          liveRef.current = null;
          setLive(null);
          if (chatRef.current?.id === final.id) setChat(final);
          save(final);
          // Sesja CLI, która nie powstała (błąd na starcie, Stop przed zapisem przez claude)
          // albo zniknęła, nie może być wznawiana: następne pytanie zacznie nową z historią jako tłem.
          const lost = e.type === "error" && /No conversation found|no rollout found|thread not found/i.test(e.message);
          const last = final.messages[final.messages.length - 1];
          if (lost || (newSession && last?.text === "" && (e.type === "error" || last.stopped))) {
            const { [key]: _, ...rest } = final.cli;
            const fixed = { ...final, cli: rest };
            if (chatRef.current?.id === final.id) setChat(fixed);
            save(fixed);
          }
        } else {
          update((m) => applyEvent(m, e));
          frame.current ||= requestAnimationFrame(flush);
        }
      },
    );
    const l: Live = { chat: current, msgId: reply.id, stop, started };
    liveRef.current = l;
    setLive(l);
    setChat(current);
    stick.current = true;
    save(current);
  };

  const send = (text: string) => {
    if (!model || live) return;
    const now = Date.now();
    const base = chat ?? newChat(crypto.randomUUID(), now, model, search);
    const q: Message = { id: crypto.randomUUID(), role: "user", text, at: now };
    respond({ ...base, title: base.title || chatTitle(text), messages: [...base.messages, q] }, model);
  };

  const stopLive = () => {
    const l = liveRef.current;
    if (!l) return;
    // Stop: zapisujemy, że przerwano (zdarzenie `done` przyjdzie po zabiciu procesu / abort).
    liveRef.current = { ...l, chat: { ...l.chat, messages: l.chat.messages.map((m) => (m.id === l.msgId ? { ...m, stopped: true } : m)) } };
    l.stop();
  };

  const retry = () => {
    if (!chat || live || !model) return;
    const msgs = chat.messages;
    const lastUser = msgs.map((m) => m.role).lastIndexOf("user");
    if (lastUser < 0) return;
    respond({ ...chat, messages: msgs.slice(0, lastUser + 1) }, model);
  };

  const edit = (index: number) => {
    if (!chat || live) return;
    const text = chat.messages[index]?.text ?? "";
    // Sesje CLI znają starą wersję rozmowy: po obcięciu zaczynają od nowa (z historią jako tłem).
    const cut = { ...chat, messages: chat.messages.slice(0, index), cli: {} };
    setChat(cut);
    save(cut);
    setInject({ text, seq: Date.now() });
  };

  const open = async (id: string) => {
    if (chat?.id === id) return;
    const l = liveRef.current;
    if (l?.chat.id === id) return setChat(l.chat);
    const c = await backend.chatLoad(id).catch(() => null);
    if (!c) return setErrors((prev) => [...prev, "nie udało się otworzyć rozmowy"]);
    setChat(c);
    stick.current = true;
    if (findModel(providers, c.model)) setModel(c.model);
  };

  const newConversation = () => {
    setChat(null);
    setInject({ text: "", seq: Date.now() });
  };

  const rename = (id: string, title: string) => {
    void (async () => {
      const c = chat?.id === id ? chat : await backend.chatLoad(id).catch(() => null);
      if (!c) return;
      const next = { ...c, title };
      if (chat?.id === id) setChat(next);
      save(next);
    })();
  };

  const remove = (id: string) => {
    const r = confirmClick(armRef.current, `c:${id}`, Date.now());
    armRef.current = r.arm;
    setArmedId(r.fire ? null : isArmed(r.arm, `c:${id}`, Date.now()) ? id : null);
    if (!r.fire) return;
    if (liveRef.current?.chat.id === id) stopLive();
    if (chat?.id === id) setChat(null);
    setList((prev) => prev.filter((c) => c.id !== id));
    void backend.chatDelete(id).catch(() => undefined);
  };

  const groups = useMemo(() => {
    const f = filter.trim().toLowerCase();
    return groupChats(f ? list.filter((c) => displayTitle(c).toLowerCase().includes(f)) : list, Date.now());
  }, [list, filter]);

  const messages = chat?.messages ?? [];
  const empty = messages.length === 0;
  const composer = (
    <Composer
      providers={providers}
      offline={offline}
      model={model}
      onModel={pickModel}
      search={search}
      onSearch={pickSearch}
      busy={live !== null}
      onSend={send}
      onStop={stopLive}
      inject={inject}
      big={empty}
      onProviders={() => setProvidersOpen(true)}
    />
  );

  return (
    <div className="chat">
      <aside className={`chat-side${railOpen ? "" : " is-closed"}`}>
        <header className="rail-head chat-side-head">
          <ModeTabs mode={mode} onMode={onMode} />
          <IconButton icon={PanelLeft} label={railOpen ? "Zwiń listę" : "Rozwiń listę"} shortcut="Ctrl+Alt+B" onClick={onToggleRail} />
        </header>
        <button type="button" className="chat-new" onClick={newConversation} title="Nowa rozmowa">
          <MessageSquarePlus aria-hidden />
          <span>Nowa rozmowa</span>
        </button>
        <label className="chat-filter">
          <Search aria-hidden />
          <input value={filter} placeholder="Szukaj rozmów" onChange={(e) => setFilter(e.target.value)} spellCheck={false} />
        </label>
        <nav className="chat-list">
          {groups.map((g) => (
            <div key={g.group} className="chat-list-group">
              <div className="rail-label">{g.group}</div>
              {g.chats.map((c) => (
                <div
                  key={c.id}
                  className={`chat-item${c.id === chat?.id ? " is-active" : ""}${live?.chat.id === c.id ? " is-live" : ""}`}
                  onClick={() => void open(c.id)}
                  onDoubleClick={() => setEditing({ id: c.id, value: displayTitle(c) })}
                >
                  {editing?.id === c.id ? (
                    <input
                      className="proj-edit"
                      autoFocus
                      value={editing.value}
                      spellCheck={false}
                      onClick={(e) => e.stopPropagation()}
                      onChange={(e) => setEditing({ id: c.id, value: e.target.value })}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          const v = editing.value.trim();
                          if (v) rename(c.id, v);
                          setEditing(null);
                        } else if (e.key === "Escape") setEditing(null);
                      }}
                      onBlur={() => setEditing(null)}
                    />
                  ) : (
                    <>
                      <span className="chat-item-title" title={displayTitle(c)}>
                        {displayTitle(c)}
                      </span>
                      <IconButton
                        icon={X}
                        label={`Usuń rozmowę ${displayTitle(c)}`}
                        className={`proj-close${armedId === c.id ? " is-confirm" : ""}`}
                        title={armedId === c.id ? "Kliknij ponownie, aby usunąć" : "Usuń rozmowę"}
                        onClick={(e) => {
                          e.stopPropagation();
                          remove(c.id);
                        }}
                        onDoubleClick={(e) => e.stopPropagation()}
                      >
                        {armedId === c.id ? "Na pewno?" : undefined}
                      </IconButton>
                    </>
                  )}
                </div>
              ))}
            </div>
          ))}
          {list.length === 0 && <p className="chat-list-empty">Tu pojawią się Twoje rozmowy.</p>}
        </nav>
        <footer className="rail-foot">
          <IconButton icon={Plug} label="Dostawcy modeli" onClick={() => setProvidersOpen(true)} />
          <IconButton icon={SlidersHorizontal} label="Wygląd" onClick={onOpenAppearance} />
        </footer>
      </aside>
      <main className="chat-main">
        {errors.length > 0 && (
          <div className="config-errors">
            <span>{errors.join(" · ")}</span>
            <IconButton icon={X} label="Zamknij błędy" onClick={() => setErrors([])} />
          </div>
        )}
        {empty ? (
          <div className="chat-welcome">
            <h1 className="chat-hello">
              <span className="brand-mark" aria-hidden />
              {greeting(new Date().getHours())}
            </h1>
            {composer}
          </div>
        ) : (
          <>
            <div className="chat-scroll" ref={scroller} onScroll={onScroll}>
              <div className="chat-column">
                {chat && <h2 className="chat-title">{displayTitle(chat)}</h2>}
                <Thread messages={messages} providers={providers} liveId={live && live.chat.id === chat?.id ? live.msgId : null} onRetry={retry} onEdit={edit} />
              </div>
            </div>
            <div className="chat-dock">
              {composer}
              <p className="chat-hint">Modele się mylą. Sprawdzaj ważne informacje.</p>
            </div>
          </>
        )}
      </main>
      {providersOpen && (
        <ProvidersDialog
          providers={providers}
          offline={offline}
          onSave={async (next) => {
            await backend.chatSaveConfig(configJson(next, discovered.current));
            await loadConfig();
          }}
          onClose={() => setProvidersOpen(false)}
        />
      )}
    </div>
  );
}
