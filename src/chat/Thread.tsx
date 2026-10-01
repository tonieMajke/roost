import { memo, useState, type ReactNode } from "react";
import { AlertTriangle, ChevronRight, Globe, Pencil, RotateCcw } from "lucide-react";
import { domain, linkCitations, modelLabel, type Message, type ProviderDef } from "../chat";
import { backend } from "../backend";
import { CopyButton, Markdown } from "./Markdown";

const seconds = (ms: number) => (ms < 10_000 ? `${(ms / 1000).toFixed(1).replace(".", ",")} s` : `${Math.round(ms / 1000)} s`);

function Sources({ m }: { m: Message }) {
  if (!m.sources?.length) return null;
  return (
    <div className="chat-sources">
      {m.sources.map((s, i) => !s.url ? null : (
        <a
          key={s.url}
          className="chat-source"
          href={s.url}
          title={s.url}
          onClick={(e) => {
            e.preventDefault();
            void backend.openExternal(s.url).catch(() => undefined);
          }}
        >
          <span className="chat-source-n">{i + 1}</span>
          <span className="chat-source-text">
            <span className="chat-source-title">{s.title || domain(s.url)}</span>
            <span className="chat-source-domain">{domain(s.url)}</span>
          </span>
        </a>
      ))}
    </div>
  );
}

function Searches({ m, live }: { m: Message; live: boolean }) {
  const [open, setOpen] = useState(false);
  if (!m.searches?.length) return null;
  const n = m.found?.length || m.sources?.length || 0;
  const label = live && m.text === "" ? `Szukam: ${m.searches[m.searches.length - 1]}` : `Przeszukano ${n} ${n === 1 ? "stronę" : n >= 2 && n <= 4 ? "strony" : "stron"}`;
  return (
    <div className={`chat-fold${open ? " is-open" : ""}${live && m.text === "" ? " is-live" : ""}`}>
      <button type="button" className="chat-fold-head" onClick={() => setOpen((v) => !v)}>
        <Globe aria-hidden />
        <span>{label}</span>
        <ChevronRight className="chat-fold-chev" aria-hidden />
      </button>
      {open && (
        <div className="chat-fold-body">
          <ul>
            {m.searches.map((q, i) => (
              <li key={i}>{q}</li>
            ))}
          </ul>
          {m.found?.length ? (
            <div className="chat-found">
              {m.found.map((s) => (
                <a
                  key={s.url}
                  href={s.url}
                  title={s.url}
                  onClick={(e) => {
                    e.preventDefault();
                    void backend.openExternal(s.url).catch(() => undefined);
                  }}
                >
                  <span>{s.title || domain(s.url)}</span>
                  <span className="chat-source-domain">{domain(s.url)}</span>
                </a>
              ))}
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}

function Thinking({ m, live }: { m: Message; live: boolean }) {
  const [open, setOpen] = useState(false);
  if (!m.thinking) return null;
  const thinkingNow = live && m.text === "";
  return (
    <div className={`chat-fold${open ? " is-open" : ""}${thinkingNow ? " is-live" : ""}`}>
      <button type="button" className="chat-fold-head" onClick={() => setOpen((v) => !v)}>
        <span>{thinkingNow ? "Myśli…" : "Przemyślenia"}</span>
        <ChevronRight className="chat-fold-chev" aria-hidden />
      </button>
      {open && <div className="chat-fold-body chat-thinking">{m.thinking}</div>}
    </div>
  );
}

/** Własna treść odpowiedzi (zakładka Bot: tekst przeplatany kartami narzędzi); `null` = zwykły markdown. */
export type RenderBody = (m: Message, live: boolean) => ReactNode | null;

type Props = {
  messages: Message[];
  providers: ProviderDef[];
  liveId: string | null;
  onRetry(): void;
  onEdit(index: number): void;
  renderBody?: RenderBody;
};

const AssistantMessage = memo(function AssistantMessage({
  m,
  providers,
  live,
  last,
  onRetry,
  renderBody,
}: {
  m: Message;
  providers: ProviderDef[];
  live: boolean;
  last: boolean;
  onRetry(): void;
  renderBody?: RenderBody;
}) {
  const body = renderBody?.(m, live) ?? null;
  const waiting = live && m.text === "" && !m.thinking && !m.searches?.length && body === null;
  return (
    <div className={`chat-msg is-assistant${live ? " is-live" : ""}`}>
      <Searches m={m} live={live} />
      <Thinking m={m} live={live} />
      {waiting && (
        <div className="chat-wait" aria-label="Czekam na odpowiedź">
          <span />
          <span />
          <span />
        </div>
      )}
      {body ??
        (m.text !== "" && (
          <div className={`chat-md${live ? " is-live" : ""}`}>
            <Markdown text={linkCitations(m.text, m.sources)} />
          </div>
        ))}
      {m.stopped && <div className="chat-note">przerwano</div>}
      {m.error && (
        <div className="chat-error">
          <AlertTriangle aria-hidden />
          <span>{m.error}</span>
        </div>
      )}
      <Sources m={m} />
      {!live && (
        <div className="chat-actions">
          <span className="chat-meta">
            {modelLabel(providers, m.model)}
            {m.ms !== undefined && ` · ${seconds(m.ms)}`}
          </span>
          {m.text !== "" && <CopyButton text={m.text} />}
          {last && (
            <button type="button" className="chat-copy" onClick={onRetry} title="Odpowiedz jeszcze raz (wybranym modelem)">
              <RotateCcw aria-hidden />
              <span>Ponów</span>
            </button>
          )}
        </div>
      )}
    </div>
  );
});

export function Thread({ messages, providers, liveId, onRetry, onEdit, renderBody }: Props) {
  const lastUser = messages.map((m) => m.role).lastIndexOf("user");
  return (
    <div className="chat-thread">
      {messages.map((m, i) =>
        m.role === "user" ? (
          <div key={m.id} className="chat-msg is-user">
            <div className="chat-bubble">{m.text}</div>
            <div className="chat-actions is-user">
              <CopyButton text={m.text} />
              {i === lastUser && liveId === null && (
                <button type="button" className="chat-copy" onClick={() => onEdit(i)} title="Zmień pytanie i wyślij od nowa">
                  <Pencil aria-hidden />
                  <span>Edytuj</span>
                </button>
              )}
            </div>
          </div>
        ) : (
          <AssistantMessage key={m.id} m={m} providers={providers} live={m.id === liveId} last={i === messages.length - 1 && liveId === null} onRetry={onRetry} renderBody={renderBody} />
        ),
      )}
    </div>
  );
}
