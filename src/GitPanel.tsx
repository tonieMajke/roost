import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent, type MouseEvent } from "react";
import { ArrowDown, ArrowUp, ChevronDown, ChevronRight, Folder, GitBranch, Minus, Plus, RefreshCw, Undo2, X } from "lucide-react";
import { backend } from "./backend";
import { CONFIRM_MS, confirmClick, isArmed, type Arm } from "./confirm";
import { IconButton } from "./IconButton";
import {
  branchLabel,
  buildTree,
  canCommit,
  diffModeFor,
  dirsWithChanges,
  discardPlan,
  isConflict,
  isStaged,
  isUnstaged,
  parseDiff,
  statusLetter,
  statusTone,
  syncLabel,
  unstagePaths,
  visibleRows,
  type DiffMode,
  type GitEntry,
  type GitStatus,
} from "./git";

const POLL_MS = 5000;

type Props = {
  /** Folder projektu (z `~`, jak w `Project.path`). */
  path: string;
  onClose: () => void;
  onNotice: (text: string) => void;
};

type Selected = { path: string; prefer?: DiffMode };

const baseName = (p: string) => p.slice(p.lastIndexOf("/") + 1);
const dirName = (p: string) => (p.includes("/") ? p.slice(0, p.lastIndexOf("/") + 1) : "");
/** Podpis zmiany, żeby nie odświeżać widoku, gdy nic się nie zmieniło. */
const sig = (s: GitStatus | null) => JSON.stringify(s);
const msg = (e: unknown) => (e instanceof Error ? e.message : String(e));

export function GitPanel({ path, onClose, onNotice }: Props) {
  const [status, setStatus] = useState<GitStatus | null | undefined>(undefined); // undefined = jeszcze nie wczytano
  const [files, setFiles] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Selected | null>(null);
  const [diff, setDiff] = useState<{ key: string; text: string; error?: string } | null>(null);
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [onlyChanged, setOnlyChanged] = useState(false);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [armedKey, setArmedKey] = useState<string | null>(null);
  const arm = useRef<Arm>(null);
  const lastSig = useRef("");
  const filesSig = useRef("");
  const inflight = useRef(false);
  const firstOpen = useRef(true);
  const [tick, setTick] = useState(0);

  const refresh = useCallback(async () => {
    if (inflight.current) return;
    inflight.current = true;
    try {
      const s = await backend.gitStatus(path);
      setError(null);
      if (s === null) {
        setStatus(null);
        return;
      }
      const next = sig(s);
      if (next !== lastSig.current) {
        lastSig.current = next;
        setStatus(s);
        if (firstOpen.current) {
          firstOpen.current = false;
          setOpen(dirsWithChanges(s.entries));
        }
      }
      // Lista plików zmienia się tylko razem z listą wpisów (nowy plik, usunięcie).
      const fsig = s.entries.map((e) => `${e.kind}:${e.path}`).join("\0");
      if (fsig !== filesSig.current || filesSig.current === "") {
        filesSig.current = fsig === "" ? "\0" : fsig;
        setFiles(await backend.gitFiles(path));
      }
      setTick((t) => t + 1);
    } catch (e) {
      setError(msg(e));
    } finally {
      inflight.current = false;
    }
  }, [path]);

  useEffect(() => {
    void refresh();
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") void refresh();
    }, POLL_MS);
    const onFocus = () => void refresh();
    window.addEventListener("focus", onFocus);
    return () => {
      clearInterval(timer);
      window.removeEventListener("focus", onFocus);
    };
  }, [refresh]);

  useEffect(() => {
    if (armedKey === null) return;
    const t = setTimeout(() => setArmedKey(null), CONFIRM_MS);
    return () => clearTimeout(t);
  }, [armedKey]);

  const entries = status?.entries.filter((e) => e.kind !== "ignored") ?? [];
  const byPath = useMemo(() => new Map(entries.map((e) => [e.path, e])), [status]); // eslint-disable-line react-hooks/exhaustive-deps
  const staged = entries.filter(isStaged);
  const unstaged = entries.filter((e) => isUnstaged(e) || isConflict(e));
  const tree = useMemo(() => buildTree(files, entries), [files, status]); // eslint-disable-line react-hooks/exhaustive-deps
  const rows = useMemo(() => visibleRows(tree, open, onlyChanged), [tree, open, onlyChanged]);

  const selEntry = selected ? byPath.get(selected.path) : undefined;
  const mode = selected ? diffModeFor(selEntry, selected.prefer) : null;
  const diffKey = selected && mode ? `${selected.path}\0${mode}` : null;

  // Diff przeładowuje się przy zmianie wyboru i po każdym udanym odświeżeniu (agent może dalej pisać).
  useEffect(() => {
    if (!selected || !mode || !diffKey) return void setDiff(null);
    let alive = true;
    backend
      .gitDiff(path, selected.path, mode)
      .then((text) => alive && setDiff((d) => (d && d.key === diffKey && d.text === text && !d.error ? d : { key: diffKey, text })))
      .catch((e) => alive && setDiff({ key: diffKey, text: "", error: msg(e) }));
    return () => {
      alive = false;
    };
  }, [diffKey, tick, path]); // eslint-disable-line react-hooks/exhaustive-deps

  const parsed = useMemo(() => (diff && diff.key === diffKey ? parseDiff(diff.text) : null), [diff, diffKey]);

  /** Operacja na repozytorium: jedna naraz, błąd git idzie do toastu, potem odświeżenie. */
  const run = async (label: string, fn: () => Promise<string | void>) => {
    if (busy !== null) return;
    setBusy(label);
    try {
      const out = await fn();
      if (out) onNotice(out);
    } catch (e) {
      onNotice(`Git: ${msg(e)}`);
    } finally {
      setBusy(null);
      void refresh();
    }
  };

  const stage = (es: GitEntry[]) => run("stage", () => backend.gitStage(path, es.map((e) => e.path)));
  const unstage = (es: GitEntry[]) => run("unstage", () => backend.gitUnstage(path, es.flatMap(unstagePaths)));

  /** Odrzucenie wymaga drugiego kliknięcia w ciągu 3 s (jak zamykanie panelu); `key` łączy oba kliknięcia. */
  const discard = (key: string, es: GitEntry[]) => {
    const r = confirmClick(arm.current, `d:${key}`, Date.now());
    arm.current = r.arm;
    if (!r.fire) return setArmedKey(isArmed(r.arm, `d:${key}`, Date.now()) ? key : null);
    setArmedKey(null);
    const tracked = es.filter((e) => discardPlan(e) === "restore").map((e) => e.path);
    const untracked = es.filter((e) => discardPlan(e) === "clean").map((e) => e.path);
    void run("discard", async () => {
      await backend.gitDiscard(path, tracked, untracked);
      onNotice(`Odrzucono zmiany: ${tracked.length + untracked.length} ${tracked.length + untracked.length === 1 ? "plik" : "plików"}`);
    });
  };

  const blocked = status ? canCommit(status.entries, message) : "Brak repozytorium";
  const commit = () => {
    if (blocked) return;
    void run("commit", async () => {
      const line = await backend.gitCommit(path, message);
      setMessage("");
      return `Zatwierdzono: ${line}`;
    });
  };
  const onMessageKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      commit();
    }
  };

  const select = (p: string, prefer?: DiffMode) => setSelected({ path: p, prefer });
  const toggleDir = (p: string) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (!next.delete(p)) next.add(p);
      return next;
    });
  const stop = (e: MouseEvent) => e.stopPropagation();
  const rowKey = (fn: () => void) => (e: KeyboardEvent) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      fn();
    }
  };

  const branch = status?.branch;
  const canPull = !!branch && branch.upstream !== null && busy === null;
  const canPush = !!branch && busy === null && (branch.upstream === null ? branch.head !== null : branch.ahead > 0);

  const badge = (e: GitEntry) => (
    <span className={`git-badge tone-${statusTone(e)}`} aria-hidden>
      {statusLetter(e)}
    </span>
  );

  const changeRow = (e: GitEntry, section: "staged" | "unstaged") => {
    const key = `${section}:${e.path}`;
    const isSel = selected?.path === e.path;
    const plan = section === "unstaged" ? discardPlan(e) : null;
    const show = () => select(e.path, section === "staged" ? "staged" : e.kind === "untracked" ? "untracked" : "unstaged");
    return (
      <div
        key={key}
        className={`git-row${isSel ? " is-sel" : ""}`}
        role="button"
        tabIndex={0}
        title={e.orig ? `${e.orig} → ${e.path}` : e.path}
        onClick={show}
        onKeyDown={rowKey(show)}
      >
        {badge(e)}
        <span className="git-name">
          <span className="git-dir">{dirName(e.path)}</span>
          {baseName(e.path)}
        </span>
        <span className="git-actions" onClick={stop}>
          {plan && (
            <IconButton
              icon={Undo2}
              label={plan === "clean" ? "Usuń plik z dysku" : "Odrzuć zmiany"}
              className={armedKey === key ? "is-confirm" : undefined}
              disabled={busy !== null}
              onClick={() => discard(key, [e])}
            >
              {armedKey === key ? "Na pewno?" : undefined}
            </IconButton>
          )}
          {section === "staged" ? (
            <IconButton icon={Minus} label="Wyłącz z indeksu" disabled={busy !== null} onClick={() => unstage([e])} />
          ) : (
            !isConflict(e) && <IconButton icon={Plus} label="Dodaj do indeksu" disabled={busy !== null} onClick={() => stage([e])} />
          )}
        </span>
      </div>
    );
  };

  const header = (
    <header className="git-head">
      <span className="git-title">Pliki</span>
      {branch && (
        <span className="git-chip" title={branch.upstream ? `${branchLabel(branch)} → ${branch.upstream}` : branchLabel(branch)}>
          <GitBranch size={13} strokeWidth={1.75} aria-hidden />
          <span className="git-branch">{branchLabel(branch)}</span>
          <span className={`git-sync${branch.upstream === null ? " is-none" : ""}`}>{syncLabel(branch)}</span>
        </span>
      )}
      <span className="git-spacer" />
      {branch && (
        <>
          <button type="button" className="btn" disabled={!canPull} title="Pull (tylko fast-forward)" onClick={() => void run("pull", () => backend.gitSync(path, "pull"))}>
            <ArrowDown strokeWidth={1.75} aria-hidden /> Pull{branch.behind > 0 ? ` ${branch.behind}` : ""}
          </button>
          <button
            type="button"
            className="btn"
            disabled={!canPush}
            title={branch.upstream === null ? "Opublikuj branch w origin (push -u)" : "Push"}
            onClick={() => void run("push", () => backend.gitSync(path, "push"))}
          >
            <ArrowUp strokeWidth={1.75} aria-hidden /> {branch.upstream === null ? "Opublikuj" : `Push${branch.ahead > 0 ? ` ${branch.ahead}` : ""}`}
          </button>
        </>
      )}
      <IconButton icon={RefreshCw} label="Odśwież" onClick={() => void refresh()} className={busy !== null ? "is-spin" : undefined} />
      <IconButton icon={X} label="Zamknij panel plików" onClick={onClose} />
    </header>
  );

  if (status === undefined || status === null || error) {
    return (
      <aside className="git git-empty" aria-label="Pliki i git">
        {header}
        <p className="git-note" role={error ? "alert" : undefined}>
          {error ? `Git: ${error}` : status === undefined ? "Wczytywanie…" : "To nie repozytorium git."}
        </p>
      </aside>
    );
  }

  const onlyConflict = entries.some(isConflict);

  return (
    <aside className="git" aria-label="Pliki i git">
      {header}
      <div className="git-body">
        <div className="git-side">
          <section className="git-sec">
            <h3>
              Staged <span className="git-count">{staged.length}</span>
              {staged.length > 0 && (
                <button type="button" className="git-link" disabled={busy !== null} onClick={() => unstage(staged)}>
                  wyłącz wszystko
                </button>
              )}
            </h3>
            {staged.length === 0 ? <p className="git-none">Nic w indeksie</p> : staged.map((e) => changeRow(e, "staged"))}
          </section>
          <section className="git-sec">
            <h3>
              Zmiany <span className="git-count">{unstaged.length}</span>
              {unstaged.some((e) => !isConflict(e)) && (
                <button type="button" className="git-link" disabled={busy !== null} onClick={() => stage(unstaged.filter((e) => !isConflict(e)))}>
                  dodaj wszystko
                </button>
              )}
            </h3>
            {unstaged.length === 0 ? <p className="git-none">Czysto</p> : unstaged.map((e) => changeRow(e, "unstaged"))}
          </section>
          <section className="git-commit">
            <textarea
              value={message}
              rows={3}
              placeholder="Komunikat commitu (Ctrl+Enter zatwierdza)"
              aria-label="Komunikat commitu"
              onChange={(e) => setMessage(e.target.value)}
              onKeyDown={onMessageKey}
            />
            <button type="button" className="btn primary" disabled={blocked !== null || busy !== null} title={blocked ?? "Zatwierdź zmiany z indeksu"} onClick={commit}>
              Zatwierdź{staged.length > 0 ? ` (${staged.length})` : ""}
            </button>
            {onlyConflict && <span className="git-none">Konflikty blokują commit</span>}
          </section>
          <section className="git-sec git-tree">
            <h3>
              Drzewo
              <label className="git-link">
                <input type="checkbox" checked={onlyChanged} onChange={(e) => setOnlyChanged(e.target.checked)} /> tylko zmienione
              </label>
            </h3>
            {rows.length === 0 && <p className="git-none">{onlyChanged ? "Brak zmian" : "Pusto"}</p>}
            {rows.map(({ node, depth }) => {
              const act = node.dir ? () => toggleDir(node.path) : () => select(node.path);
              const e = node.entry;
              return (
                <div
                  key={node.path}
                  className={`git-row git-node${!node.dir && selected?.path === node.path ? " is-sel" : ""}`}
                  style={{ paddingLeft: 8 + depth * 14 }}
                  role="button"
                  tabIndex={0}
                  title={node.path}
                  onClick={act}
                  onKeyDown={rowKey(act)}
                >
                  {node.dir ? (
                    <>
                      {onlyChanged || open.has(node.path) ? <ChevronDown size={13} strokeWidth={1.75} aria-hidden /> : <ChevronRight size={13} strokeWidth={1.75} aria-hidden />}
                      <Folder size={13} strokeWidth={1.75} aria-hidden />
                      <span className="git-name">{node.name}</span>
                      {node.changed > 0 && <span className="git-dot" title={`Zmienione pliki: ${node.changed}`}>{node.changed}</span>}
                    </>
                  ) : (
                    <>
                      <span className="git-chev" />
                      {e ? badge(e) : <span className="git-badge" aria-hidden />}
                      <span className={`git-name${e ? ` tone-${statusTone(e)}` : ""}`}>{node.name}</span>
                    </>
                  )}
                </div>
              );
            })}
          </section>
        </div>
        <div className="git-diff" aria-label="Diff">
          {!selected ? (
            <p className="git-note">Wybierz plik, żeby zobaczyć zmiany.</p>
          ) : (
            <>
              <div className="git-diff-head">
                <span className="git-diff-path" title={selected.path}>{selected.path}</span>
                {selEntry && isStaged(selEntry) && isUnstaged(selEntry) && (
                  <span className="git-tabs">
                    {(["unstaged", "staged"] as const).map((m) => (
                      <button key={m} type="button" className={mode === m || (m === "unstaged" && mode === "untracked") ? "is-on" : undefined} onClick={() => select(selected.path, m)}>
                        {m === "staged" ? "Staged" : "Zmiany"}
                      </button>
                    ))}
                  </span>
                )}
                {parsed && !parsed.binary && (
                  <span className="git-stat">
                    <span className="tone-added">+{parsed.added}</span> <span className="tone-deleted">−{parsed.removed}</span>
                  </span>
                )}
              </div>
              <div className="git-diff-body">
                {!mode ? (
                  <p className="git-note">{selEntry && isConflict(selEntry) ? "Konflikt – rozwiąż go poza panelem." : "Brak zmian w tym pliku."}</p>
                ) : diff?.key === diffKey && diff.error ? (
                  <p className="git-note" role="alert">{diff.error}</p>
                ) : !parsed ? (
                  <p className="git-note">Wczytywanie…</p>
                ) : parsed.lines.length === 0 ? (
                  <p className="git-note">Pusty diff.</p>
                ) : parsed.binary ? (
                  <p className="git-note">Plik binarny.</p>
                ) : (
                  <pre className="git-lines">
                    {parsed.lines
                      .filter((l) => l.kind !== "meta")
                      .map((l, i) => (
                        <div key={i} className={`dl dl-${l.kind}`}>
                          <span className="dl-no">{l.oldNo ?? ""}</span>
                          <span className="dl-no">{l.newNo ?? ""}</span>
                          <span className="dl-sign">{l.kind === "add" ? "+" : l.kind === "del" ? "−" : " "}</span>
                          <span className="dl-text">{l.text}</span>
                        </div>
                      ))}
                  </pre>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </aside>
  );
}
