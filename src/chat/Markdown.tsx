// Markdown odpowiedzi i bloki kodu. Na podstawie `src/lib/code-block.tsx` z Pi Code (fd9dedf):
// shiki ładowany leniwie, podświetlenie z opóźnieniem (strumień nie dławi shiki), przycisk kopiuj.

import { memo, useEffect, useState, type ComponentProps } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkBreaks from "remark-breaks";
import { Check, Copy } from "lucide-react";
import type { Highlighter } from "shiki";
import { backend } from "../backend";

const THEMES = { light: "github-light", dark: "github-dark" } as const;
const LANGS = ["typescript", "tsx", "javascript", "jsx", "bash", "shell", "python", "rust", "json", "css", "html", "sql", "yaml", "toml", "go", "c", "cpp", "java", "diff", "markdown"];
const ALIASES: Record<string, string> = { ts: "typescript", js: "javascript", sh: "bash", zsh: "bash", fish: "bash", py: "python", rs: "rust", yml: "yaml", md: "markdown" };

let highlighterPromise: Promise<Highlighter> | null = null;
function getHighlighter(): Promise<Highlighter> {
  if (!highlighterPromise) {
    highlighterPromise = import("shiki")
      .then(({ createHighlighter }) => createHighlighter({ themes: Object.values(THEMES), langs: LANGS }))
      .catch((err: unknown) => {
        highlighterPromise = null; // następna próba po błędzie ładowania
        throw err;
      });
  }
  return highlighterPromise;
}

export function CopyButton({ text, label = "Kopiuj" }: { text: string; label?: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      className="chat-copy"
      title={label}
      onClick={() => {
        void backend.copyText(text).then(() => {
          setDone(true);
          setTimeout(() => setDone(false), 1400);
        });
      }}
    >
      {done ? <Check aria-hidden /> : <Copy aria-hidden />}
      <span>{done ? "Skopiowano" : label}</span>
    </button>
  );
}

function CodeBlock({ code, lang }: { code: string; lang: string }) {
  const [html, setHtml] = useState<string | null>(null);
  const l = ALIASES[lang] ?? lang;

  useEffect(() => {
    let on = true;
    const t = setTimeout(() => {
      void getHighlighter()
        .then((hl) => {
          if (!on) return;
          const known = (hl.getLoadedLanguages() as readonly string[]).includes(l) ? l : "text";
          // Dwa motywy naraz: kolory ciemne w `--shiki-dark`, wybiera CSS po `data-tone`.
          setHtml(hl.codeToHtml(code, { lang: known, themes: THEMES, defaultColor: false })); // wynik shiki, zaufany
        })
        .catch(() => undefined);
    }, 120);
    return () => {
      on = false;
      clearTimeout(t);
    };
  }, [code, l]);

  return (
    <div className="chat-code">
      <div className="chat-code-head">
        <span>{lang === "text" ? "" : lang}</span>
        <CopyButton text={code} />
      </div>
      {html ? (
        <div className="chat-code-body" dangerouslySetInnerHTML={{ __html: html }} />
      ) : (
        <pre className="chat-code-body">
          <code>{code}</code>
        </pre>
      )}
    </div>
  );
}

const code = (props: ComponentProps<"code">) => {
  const { className, children } = props;
  const match = /language-([\w+-]+)/.exec(className ?? "");
  const text = String(children ?? "").replace(/\n$/, "");
  if (!match && !text.includes("\n")) return <code className={className}>{children}</code>;
  return <CodeBlock code={text} lang={match?.[1] ?? "text"} />;
};

const pre = (props: ComponentProps<"pre">) => <>{props.children}</>;

/** Linki otwiera przeglądarka systemowa; przypis `[n]` dostaje wygląd znaczka. */
const a = ({ node: _node, children, ...props }: ComponentProps<"a"> & { node?: unknown }) => {
  const cite = typeof children === "string" && /^\[\d+\]$/.test(children);
  return (
    <a
      {...props}
      className={cite ? "chat-cite" : undefined}
      title={props.title ?? props.href}
      onClick={(e) => {
        e.preventDefault();
        if (props.href && /^https?:\/\//i.test(props.href)) void backend.openExternal(props.href).catch(() => undefined);
      }}
    >
      {cite ? String(children).slice(1, -1) : children}
    </a>
  );
};

const table = (props: ComponentProps<"table">) => (
  <div className="chat-table">
    <table {...props} />
  </div>
);

const COMPONENTS = { code, pre, a, table };
const REMARK = [remarkGfm, remarkBreaks];

export const Markdown = memo(function Markdown({ text }: { text: string }) {
  return (
    <ReactMarkdown remarkPlugins={REMARK} components={COMPONENTS}>
      {text}
    </ReactMarkdown>
  );
});
