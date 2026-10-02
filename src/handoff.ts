import { t } from "./i18n";
import { tildify } from "./paths";

/** Wyciąg rozmowy z pliku sesji (Rust `session_handoff`, M4). */
export type Handoff = { prompts: string[]; replies: string[]; files: string[]; commands: string[] };

export type HandoffSource = {
  /** Nazwa agenta źródła („Claude”). */
  agent: string;
  /** Nazwa projektu źródła. */
  project: string;
  /** Folder projektu źródła (`~/…`): ścieżki plików w nim skracamy do względnych. */
  projectPath: string;
  home: string;
};

/** Tyle wklejamy najwyżej: claude i pi zwiną to do „[Pasted text …]”, ale to nadal ich kontekst. */
export const HANDOFF_MAX_CHARS = 8000;
/** Surowy wyciąg, gdy streszczenie się nie uda – krótszy, bo miał być skompresowany. */
export const FALLBACK_MAX_CHARS = 2500;
/** Górna granica streszczenia; długość w jej obrębie wybiera model. */
export const SUMMARY_MAX_CHARS = 1500;

/** Polecenie systemowe dla Haiku (Rust `claude_summary`); wyciąg idzie na stdin. W języku interfejsu. */
export const summarySystem = () => t("handoff.system", { max: SUMMARY_MAX_CHARS });

const bullet = (text: string) => "- " + text.trim().replace(/\n+/g, "\n  ");

const header = (src: HandoffSource, key: "handoff.summaryHeader" | "handoff.rawHeader") =>
  t(key, { agent: src.agent, project: src.project });
const footer = () => "---\n" + t("handoff.footer");

function relative(file: string, projectPath: string, home: string): string {
  const f = tildify(file, home);
  const dir = tildify(projectPath, home);
  return f.startsWith(`${dir}/`) ? f.slice(dir.length + 1) : f;
}

function sections(h: Handoff, src: HandoffSource): string[] {
  const parts: string[] = [];
  const section = (title: string, lines: string[]) => {
    if (lines.length > 0) parts.push(`## ${title}\n${lines.join("\n")}`);
  };
  section(t("handoff.prompts"), h.prompts.map(bullet));
  section(t("handoff.replies"), h.replies.map(bullet));
  section(t("handoff.files"), h.files.map((f) => bullet(relative(f, src.projectPath, src.home))));
  section(t("handoff.commands"), h.commands.map((c) => bullet("`" + c + "`")));
  return parts;
}

function compose(h: Handoff, src: HandoffSource): string {
  return [header(src, "handoff.rawHeader"), ...sections(h, src), footer()].join("\n\n");
}

/** Wejście dla streszczenia: same sekcje wyciągu, bez nagłówka i miejsca na polecenie. */
export function digestText(h: Handoff, src: HandoffSource): string {
  return sections(h, src).join("\n\n");
}

/** Tekst do wklejenia ze streszczenia modelu; za długie ucięte, `\r` zamienione (xterm zrobiłby z nich Enter). */
export function summaryText(summary: string, src: HandoffSource): string {
  let body = summary.replace(/\r\n?/g, "\n").trim();
  if (body.length > SUMMARY_MAX_CHARS) body = body.slice(0, SUMMARY_MAX_CHARS - 1) + "…";
  return [header(src, "handoff.summaryHeader"), body, footer()].join("\n\n");
}

/**
 * Surowy wyciąg do wklejenia w panel docelowy – bez Entera, użytkownik dopisuje polecenie.
 * Za długi: najpierw odpadają najstarsze odpowiedzi, potem najstarsze prompty.
 */
export function handoffText(h: Handoff, src: HandoffSource, max = HANDOFF_MAX_CHARS): string {
  let cur = h;
  let text = compose(cur, src);
  while (text.length > max && (cur.replies.length > 0 || cur.prompts.length > 1)) {
    cur =
      cur.replies.length > 0
        ? { ...cur, replies: cur.replies.slice(1) }
        : { ...cur, prompts: cur.prompts.slice(1) };
    text = compose(cur, src);
  }
  return text.length > max ? text.slice(0, max - 1) + "…" : text;
}
