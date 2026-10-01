//! Przekazanie (M4): wyciąg rozmowy agenta, wklejany do innego panelu.
//! Z własnego pliku sesji agenta, tylko odczyt – te same pliki co `context.ts`.

import os from "node:os";
import path from "node:path";
import { expand } from "./env";
import { findSession, type Kind, readLast, validId } from "./context";

/** Więcej niż czytają liczniki: przekazanie potrzebuje kilku całych tur, nie tylko ostatniego usage. */
const TAIL_BYTES = 1024 * 1024;
export const MAX_PROMPTS = 5;
export const PROMPT_CHARS = 800;
const MAX_REPLIES = 3;
const REPLY_CHARS = 1500;
const MAX_FILES = 20;
export const MAX_COMMANDS = 5;
const COMMAND_CHARS = 120;

export type Handoff = {
  /** Najnowsze polecenia użytkownika, od najstarszego. */
  prompts: string[];
  /** Najnowsze teksty asystenta (jeden na linię tury), od najstarszego. */
  replies: string[];
  /** Pliki zapisane albo edytowane, od najnowszego, bez powtórzeń. */
  files: string[];
  /** Najnowsze polecenia powłoki, po jednej linii, od najstarszego. */
  commands: string[];
};

type Json = Record<string, unknown>;
const obj = (v: unknown): Json | null => (v !== null && typeof v === "object" && !Array.isArray(v) ? (v as Json) : null);
const str = (v: unknown): string | null => (typeof v === "string" ? v : null);

/** Cięcie na granicy znaku (polskie litery to 2 bajty) z oznaczeniem cięcia. */
export function cut(text: string, max: number): string {
  const chars = Array.from(text.trim());
  if (chars.length <= max) return chars.join("");
  return chars.slice(0, max - 1).join("").trimEnd() + "…";
}

const oneLine = (text: string) => text.split(/\s+/).filter(Boolean).join(" ");

/** Nazwy narzędzi i klucze argumentów, które zapisują pliki / uruchamiają polecenia. */
function toolEffect(kind: Kind, block: Json): { file: string | null; command: string | null } {
  const [blockType, argsKey] = kind === "claude" ? ["tool_use", "input"] : ["toolCall", "arguments"];
  if (block.type !== blockType) return { file: null, command: null };
  const name = str(block.name) ?? "";
  const args = obj(block[argsKey]) ?? {};
  let file: string | null = null;
  if (kind === "claude" && ["Edit", "Write", "MultiEdit"].includes(name)) file = str(args.file_path);
  else if (kind === "claude" && name === "NotebookEdit") file = str(args.notebook_path);
  else if (kind === "pi" && (name === "edit" || name === "write")) file = str(args.path);
  const shell = (kind === "claude" && name === "Bash") || (kind === "pi" && name === "bash");
  const cmd = shell ? str(args.command) : null;
  return { file, command: cmd === null ? null : cut(oneLine(cmd), COMMAND_CHARS) };
}

export function digest(text: string, kind: Kind): Handoff {
  const prompts: string[] = [];
  const replies: string[] = [];
  const files: string[] = [];
  const commands: string[] = [];
  for (const line of text.split("\n")) {
    let entry: Json | null;
    try {
      entry = obj(JSON.parse(line));
    } catch {
      continue;
    }
    // Tury podagentów i wstrzyknięte linie meta to nie rozmowa, którą prowadził użytkownik.
    if (!entry || entry.isSidechain === true || entry.isMeta === true) continue;
    const message = obj(entry.message);
    if (!message) continue;
    const blocks = Array.isArray(message.content) ? message.content.map(obj).filter((b): b is Json => b !== null) : [];
    const texts =
      typeof message.content === "string"
        ? [message.content]
        : blocks.filter((b) => b.type === "text").map((b) => str(b.text)).filter((t): t is string => t !== null);
    if (message.role === "user") {
      const first = texts[0]?.trim();
      // claude: wyjście poleceń i przypomnienia przychodzą jako linie użytkownika zaczynające się tagiem.
      if (!first || (kind === "claude" && first.startsWith("<"))) continue;
      prompts.push(cut(first, PROMPT_CHARS));
    } else if (message.role === "assistant") {
      const reply = texts.join("\n\n");
      if (reply.trim() !== "") replies.push(cut(reply, REPLY_CHARS));
      for (const block of blocks) {
        const { file, command } = toolEffect(kind, block);
        if (file !== null) files.push(file);
        if (command !== null) commands.push(command);
      }
    }
  }
  const newest = (v: string[], n: number) => v.slice(Math.max(0, v.length - n));
  return {
    prompts: newest(prompts, MAX_PROMPTS),
    replies: newest(replies, MAX_REPLIES),
    files: [...new Set(files.reverse())].slice(0, MAX_FILES),
    commands: newest(commands, MAX_COMMANDS),
  };
}

export function handoffIn(root: string, kind: Kind, id: string): Handoff | null {
  if (!validId(id)) return null;
  const file = findSession(root, kind, id);
  const tail = file === null ? null : readLast(file, TAIL_BYTES);
  if (tail === null) return null;
  const h = digest(tail, kind);
  const empty = h.prompts.length + h.replies.length + h.files.length + h.commands.length === 0;
  return empty ? null : h;
}

/** `null`, gdy rodzaj nieznany, pliku nie ma albo rozmowa jest pusta. */
export function sessionHandoff(kind: string, sessionId: string, home = os.homedir(), claudeDir?: string): Handoff | null {
  if (kind === "claude") {
    return handoffIn(path.join(claudeDir ? expand(claudeDir) : path.join(home, ".claude"), "projects"), "claude", sessionId);
  }
  if (kind === "pi") return handoffIn(path.join(home, ".pi", "agent", "sessions"), "pi", sessionId);
  return null;
}
