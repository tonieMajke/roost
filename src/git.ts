//! Panel plików z gitem: czyste funkcje (parsowanie wyjścia gita, drzewo, reguły operacji).
//! Uruchamia git `electron/src/git.ts`; tu nie ma wejścia/wyjścia.

export type GitCode = "." | "M" | "A" | "D" | "R" | "C" | "T" | "U" | "?" | "!";
export type EntryKind = "ordinary" | "renamed" | "unmerged" | "untracked" | "ignored";

export type GitEntry = {
  path: string;
  /** Poprzednia ścieżka (tylko przeniesienie / kopia). */
  orig?: string;
  kind: EntryKind;
  /** Stan w indeksie względem HEAD (`.` = bez zmian). */
  index: GitCode;
  /** Stan w katalogu roboczym względem indeksu. */
  worktree: GitCode;
};

export type GitBranch = {
  /** `null` = odłączony HEAD. */
  head: string | null;
  oid: string | null;
  upstream: string | null;
  ahead: number;
  behind: number;
};

export type GitStatus = { branch: GitBranch; entries: GitEntry[] };

export const NO_BRANCH: GitBranch = { head: null, oid: null, upstream: null, ahead: 0, behind: 0 };

/** Pierwsze `n` pól rozdzielonych spacją i reszta jako ostatnie pole (ścieżka może mieć spacje). */
function splitN(s: string, n: number): string[] {
  const out: string[] = [];
  let from = 0;
  for (let i = 0; i < n; i++) {
    const at = s.indexOf(" ", from);
    if (at < 0) return [...out, s.slice(from)];
    out.push(s.slice(from, at));
    from = at + 1;
  }
  out.push(s.slice(from));
  return out;
}

const code = (c: string | undefined): GitCode => (c && "MADRCTU?!.".includes(c) ? (c as GitCode) : ".");

/** Wyjście `git status --porcelain=v2 -z --branch`. Nieznane wiersze są pomijane. */
export function parseStatus(raw: string): GitStatus {
  const branch: GitBranch = { ...NO_BRANCH };
  const entries: GitEntry[] = [];
  const tokens = raw.split("\0");
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (t === "") continue;
    if (t.startsWith("# ")) {
      const [key, ...rest] = t.slice(2).split(" ");
      const value = rest.join(" ");
      if (key === "branch.oid") branch.oid = value === "(initial)" ? null : value;
      else if (key === "branch.head") branch.head = value === "(detached)" ? null : value;
      else if (key === "branch.upstream") branch.upstream = value;
      else if (key === "branch.ab") {
        const m = /^\+(\d+) -(\d+)$/.exec(value);
        if (m) {
          branch.ahead = Number(m[1]);
          branch.behind = Number(m[2]);
        }
      }
      continue;
    }
    const type = t[0];
    if (type === "1") {
      const f = splitN(t, 8); // 1 XY sub mH mI mW hH hI path
      if (f.length === 9) entries.push({ path: f[8], kind: "ordinary", index: code(f[1][0]), worktree: code(f[1][1]) });
    } else if (type === "2") {
      const f = splitN(t, 9); // 2 XY sub mH mI mW hH hI Xscore path, potem NUL i stara ścieżka
      const orig = tokens[++i];
      if (f.length === 10) entries.push({ path: f[9], orig, kind: "renamed", index: code(f[1][0]), worktree: code(f[1][1]) });
    } else if (type === "u") {
      const f = splitN(t, 10); // u XY sub m1 m2 m3 mW h1 h2 h3 path
      if (f.length === 11) entries.push({ path: f[10], kind: "unmerged", index: "U", worktree: "U" });
    } else if (type === "?") {
      entries.push({ path: t.slice(2), kind: "untracked", index: ".", worktree: "?" });
    } else if (type === "!") {
      entries.push({ path: t.slice(2), kind: "ignored", index: ".", worktree: "!" });
    }
  }
  return { branch, entries };
}

export const isConflict = (e: GitEntry) => e.kind === "unmerged";
export const isStaged = (e: GitEntry) => (e.kind === "ordinary" || e.kind === "renamed") && e.index !== ".";
/** Zmiana w katalogu roboczym względem indeksu, razem z plikiem nieśledzonym. Konflikt osobno. */
export const isUnstaged = (e: GitEntry) =>
  e.kind === "untracked" || ((e.kind === "ordinary" || e.kind === "renamed") && e.worktree !== ".");

/** Litera do plakietki: zmiana w katalogu roboczym ma pierwszeństwo przed indeksem. */
export function statusLetter(e: GitEntry): string {
  if (e.kind === "unmerged") return "U";
  if (e.kind === "untracked") return "?";
  if (e.kind === "ignored") return "!";
  return e.worktree !== "." ? e.worktree : e.index;
}

export type Tone = "added" | "modified" | "deleted" | "conflict" | "untracked" | "none";
export function statusTone(e: GitEntry): Tone {
  if (e.kind === "unmerged") return "conflict";
  if (e.kind === "untracked") return "untracked";
  const c = statusLetter(e);
  if (c === "A" || c === "C") return "added";
  if (c === "D") return "deleted";
  if (c === "." || c === "!") return "none";
  return "modified";
}

/** Ścieżka od UI do gita: względna, bez `..`, bez pustych segmentów i NUL. */
export function validRelPath(p: string): boolean {
  if (p === "" || p.includes("\0") || p.startsWith("/") || p.endsWith("/")) return false;
  return p.split("/").every((seg) => seg !== "" && seg !== "." && seg !== "..");
}

/** Jak odrzucić zmiany w katalogu roboczym; `null` = nie ma czego (staged-only, konflikt, ignorowany). */
export type DiscardPlan = "restore" | "clean" | null;
export function discardPlan(e: GitEntry): DiscardPlan {
  if (e.kind === "untracked") return "clean";
  if ((e.kind === "ordinary" || e.kind === "renamed") && e.worktree !== ".") return "restore";
  return null;
}

/** Ścieżki do `reset` (unstage): przy przeniesieniu obie, inaczej zostałby dodany plik albo usunięty stary. */
export const unstagePaths = (e: GitEntry): string[] => (e.orig ? [e.path, e.orig] : [e.path]);

export function canCommit(entries: GitEntry[], message: string): string | null {
  if (message.trim() === "") return "Wpisz komunikat";
  if (entries.some(isConflict)) return "Rozwiąż konflikty";
  if (!entries.some(isStaged)) return "Nic w indeksie";
  return null;
}

export function branchLabel(b: GitBranch): string {
  if (b.head !== null) return b.head;
  return b.oid ? `odłączony HEAD @ ${b.oid.slice(0, 7)}` : "odłączony HEAD";
}

/** `↑2 ↓1`, `zsynchronizowany`, `brak upstreamu`. */
export function syncLabel(b: GitBranch): string {
  if (b.upstream === null) return "brak upstreamu";
  if (b.ahead === 0 && b.behind === 0) return "zsynchronizowany";
  return [b.ahead > 0 ? `↑${b.ahead}` : "", b.behind > 0 ? `↓${b.behind}` : ""].filter(Boolean).join(" ");
}

// ---- diff ----

export type DiffLine = {
  kind: "meta" | "hunk" | "add" | "del" | "ctx" | "note";
  text: string;
  oldNo?: number;
  newNo?: number;
};
export type ParsedDiff = { lines: DiffLine[]; binary: boolean; added: number; removed: number };

export function parseDiff(text: string): ParsedDiff {
  const lines: DiffLine[] = [];
  let binary = false;
  let added = 0;
  let removed = 0;
  let inHunk = false;
  let o = 0;
  let n = 0;
  const raw = text.split("\n");
  if (raw[raw.length - 1] === "") raw.pop();
  for (const l of raw) {
    if (l.startsWith("diff --git ")) {
      inHunk = false;
      lines.push({ kind: "meta", text: l });
    } else if (!inHunk && /^Binary files .* differ$/.test(l)) {
      binary = true;
      lines.push({ kind: "meta", text: l });
    } else if (l.startsWith("@@")) {
      const m = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(l);
      if (m) {
        o = Number(m[1]);
        n = Number(m[2]);
        inHunk = true;
      }
      lines.push({ kind: "hunk", text: l });
    } else if (!inHunk) {
      lines.push({ kind: "meta", text: l });
    } else if (l.startsWith("\\")) {
      lines.push({ kind: "note", text: l });
    } else if (l.startsWith("+")) {
      lines.push({ kind: "add", text: l.slice(1), newNo: n++ });
      added++;
    } else if (l.startsWith("-")) {
      lines.push({ kind: "del", text: l.slice(1), oldNo: o++ });
      removed++;
    } else {
      lines.push({ kind: "ctx", text: l.slice(1), oldNo: o++, newNo: n++ });
    }
  }
  return { lines, binary, added, removed };
}

// ---- drzewo ----

export type TreeNode = {
  name: string;
  path: string;
  dir: boolean;
  children: TreeNode[];
  /** Liczba zmienionych plików w katalogu (plik: 1 albo 0). */
  changed: number;
  entry?: GitEntry;
};

/** Drzewo ze ścieżek (z `ls-files`) i wpisów statusu; wpisy spoza listy (np. usunięte w indeksie) też trafiają do drzewa. */
export function buildTree(paths: string[], entries: GitEntry[]): TreeNode {
  const root: TreeNode = { name: "", path: "", dir: true, children: [], changed: 0 };
  const byPath = new Map(entries.filter((e) => e.kind !== "ignored").map((e) => [e.path, e]));
  const all = new Set(paths);
  for (const p of byPath.keys()) all.add(p);
  const dirs = new Map<string, TreeNode>([["", root]]);
  const dirNode = (path: string): TreeNode => {
    const have = dirs.get(path);
    if (have) return have;
    const at = path.lastIndexOf("/");
    const node: TreeNode = { name: path.slice(at + 1), path, dir: true, children: [], changed: 0 };
    dirNode(at < 0 ? "" : path.slice(0, at)).children.push(node);
    dirs.set(path, node);
    return node;
  };
  for (const p of all) {
    if (!validRelPath(p)) continue;
    const at = p.lastIndexOf("/");
    const entry = byPath.get(p);
    const parent = dirNode(at < 0 ? "" : p.slice(0, at));
    parent.children.push({ name: p.slice(at + 1), path: p, dir: false, children: [], changed: entry ? 1 : 0, entry });
  }
  const finish = (node: TreeNode): number => {
    node.children.sort((a, b) => Number(b.dir) - Number(a.dir) || a.name.localeCompare(b.name, "pl"));
    if (node.dir) node.changed = node.children.reduce((s, c) => s + finish(c), 0);
    return node.changed;
  };
  finish(root);
  return root;
}

export type TreeRow = { node: TreeNode; depth: number };

/** Płaska lista widocznych wierszy. `open`: rozwinięte katalogi; `onlyChanged` pomija pliki i katalogi bez zmian
 *  i rozwija katalogi ze zmianami. */
export function visibleRows(root: TreeNode, open: ReadonlySet<string>, onlyChanged = false): TreeRow[] {
  const rows: TreeRow[] = [];
  const walk = (node: TreeNode, depth: number) => {
    for (const c of node.children) {
      if (onlyChanged && c.changed === 0) continue;
      rows.push({ node: c, depth });
      if (c.dir && (onlyChanged || open.has(c.path))) walk(c, depth + 1);
    }
  };
  walk(root, 0);
  return rows;
}

/** Katalogi nadrzędne każdej zmienionej ścieżki: domyślnie rozwinięte przy pierwszym otwarciu. */
export function dirsWithChanges(entries: GitEntry[]): Set<string> {
  const out = new Set<string>();
  for (const e of entries) {
    if (e.kind === "ignored") continue;
    for (let at = e.path.lastIndexOf("/"); at > 0; at = e.path.lastIndexOf("/", at - 1)) out.add(e.path.slice(0, at));
  }
  return out;
}

/** Który diff pokazać dla pliku: `null` = brak zmian. Preferuje zmiany w katalogu roboczym. */
export type DiffMode = "unstaged" | "staged" | "untracked";
export function diffModeFor(e: GitEntry | undefined, prefer?: DiffMode): DiffMode | null {
  if (!e || e.kind === "ignored" || e.kind === "unmerged") return e?.kind === "unmerged" ? "unstaged" : null;
  const ok: Record<DiffMode, boolean> = { staged: isStaged(e), unstaged: isUnstaged(e) && e.kind !== "untracked", untracked: e.kind === "untracked" };
  if (prefer && ok[prefer]) return prefer;
  return ok.untracked ? "untracked" : ok.unstaged ? "unstaged" : ok.staged ? "staged" : null;
}
