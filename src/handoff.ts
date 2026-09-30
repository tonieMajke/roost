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

const bullet = (text: string) => "- " + text.trim().replace(/\n+/g, "\n  ");

function relative(file: string, projectPath: string, home: string): string {
  const f = tildify(file, home);
  const dir = tildify(projectPath, home);
  return f.startsWith(`${dir}/`) ? f.slice(dir.length + 1) : f;
}

function compose(h: Handoff, src: HandoffSource): string {
  const parts = [
    `Kontekst przekazany z innej sesji (${src.agent} · ${src.project}). To tylko tło – nic z nim nie rób, poczekaj na moje polecenie pod spodem.`,
  ];
  const section = (title: string, lines: string[]) => {
    if (lines.length > 0) parts.push(`## ${title}\n${lines.join("\n")}`);
  };
  section("Ostatnie polecenia użytkownika", h.prompts.map(bullet));
  section("Ostatnie odpowiedzi", h.replies.map(bullet));
  section("Zmienione pliki", h.files.map((f) => bullet(relative(f, src.projectPath, src.home))));
  section("Polecenia powłoki", h.commands.map((c) => bullet("`" + c + "`")));
  parts.push("---\nMoje polecenie: ");
  return parts.join("\n\n");
}

/**
 * Tekst do wklejenia w panel docelowy – bez Entera, użytkownik dopisuje polecenie.
 * Za długi: najpierw odpadają najstarsze odpowiedzi, potem najstarsze prompty.
 */
export function handoffText(h: Handoff, src: HandoffSource): string {
  let cur = h;
  let text = compose(cur, src);
  while (text.length > HANDOFF_MAX_CHARS && (cur.replies.length > 0 || cur.prompts.length > 1)) {
    cur =
      cur.replies.length > 0
        ? { ...cur, replies: cur.replies.slice(1) }
        : { ...cur, prompts: cur.prompts.slice(1) };
    text = compose(cur, src);
  }
  return text.length > HANDOFF_MAX_CHARS ? text.slice(0, HANDOFF_MAX_CHARS - 1) + "…" : text;
}
