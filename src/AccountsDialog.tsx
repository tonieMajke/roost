import { useState } from "react";
import { X } from "lucide-react";
import type { AccountDef, AccountKind, Accounts } from "./accounts";
import { Dialog } from "./Dialog";
import { IconButton } from "./IconButton";

type Props = {
  value: Accounts;
  /** Wybór folderu systemowym oknem; `null` = anulowanie. */
  pickDir(): Promise<string | null>;
  onChange(next: Accounts): void;
  onClose(): void;
};

const KINDS: { kind: AccountKind; name: string; hint: string }[] = [
  { kind: "claude", name: "Claude", hint: "np. ~/.claude-praca (CLAUDE_CONFIG_DIR)" },
  { kind: "codex", name: "Codex", hint: "np. ~/.codex-praca (CODEX_HOME)" },
];

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

/** Okno „Konta”: osobne foldery logowania Claude / Codex; konto domyślne agenta (bez wpisu) zawsze istnieje. */
export function AccountsDialog({ value, pickDir, onChange, onClose }: Props) {
  const [kind, setKind] = useState<AccountKind>("claude");
  const [name, setName] = useState("");
  const [dir, setDir] = useState("");
  const hint = KINDS.find((k) => k.kind === kind)!.hint;

  const remove = (a: AccountDef) => {
    const defaults = { ...value.defaults };
    if (defaults[a.kind] === a.id) delete defaults[a.kind];
    onChange({ accounts: value.accounts.filter((x) => x.id !== a.id), defaults });
  };
  const setDefault = (a: AccountDef | null, k: AccountKind) => {
    const defaults = { ...value.defaults };
    if (a) defaults[k] = a.id;
    else delete defaults[k];
    onChange({ ...value, defaults });
  };

  return (
    <Dialog label="Konta" onClose={onClose}>
      {() => {
        const trimmed = name.trim();
        const folder = dir.trim();
        let id = slug(trimmed) || "konto";
        for (let n = 2; value.accounts.some((a) => a.id === id); n++) id = `${slug(trimmed) || "konto"}-${n}`;
        const add = () => {
          if (trimmed === "" || folder === "") return;
          onChange({ ...value, accounts: [...value.accounts, { id, name: trimmed, kind, dir: folder }] });
          setName("");
          setDir("");
        };
        return (
          <>
            <h2>Konta</h2>
            <p>Osobne logowania agentów, np. praca i prywatne. Aplikacja zna tylko folder, tokenów nie czyta.</p>
            {KINDS.map((k) => {
              const mine = value.accounts.filter((a) => a.kind === k.kind);
              const current = value.defaults[k.kind];
              return (
                <div key={k.kind} className="acc-group">
                  <h3 className="acc-title">{k.name}</h3>
                  <ul className="pm-list">
                    <li className="pm-item">
                      <button type="button" className="pm-row" onClick={() => setDefault(null, k.kind)}>
                        <span className="pm-name">{current === undefined ? "● " : "○ "}Domyślne konto {k.name}</span>
                        <span className="pm-agents">folder agenta</span>
                      </button>
                    </li>
                    {mine.map((a) => (
                      <li key={a.id} className="pm-item">
                        <button type="button" className="pm-row" onClick={() => setDefault(a, k.kind)}>
                          <span className="pm-name">{current === a.id ? "● " : "○ "}{a.name}</span>
                          <span className="pm-agents">{a.dir}</span>
                        </button>
                        <IconButton icon={X} label={`Usuń konto ${a.name}`} className="pm-del" onClick={() => remove(a)} />
                      </li>
                    ))}
                  </ul>
                </div>
              );
            })}
            <p className="set-foot">● = konto, którego używają nowe panele. Usunięcie z listy nie rusza folderu.</p>
            <hr className="pm-sep" />
            <div className="pm-save">
              <select
                className="pm-input acc-kind"
                value={kind}
                aria-label="Agent konta"
                onChange={(e) => setKind(e.target.value as AccountKind)}
              >
                {KINDS.map((k) => (
                  <option key={k.kind} value={k.kind}>{k.name}</option>
                ))}
              </select>
              <input
                className="pm-input"
                value={name}
                placeholder="nazwa, np. Praca"
                aria-label="Nazwa nowego konta"
                onChange={(e) => setName(e.target.value)}
              />
            </div>
            <div className="pm-save">
              <input
                className="pm-input"
                value={dir}
                placeholder={hint}
                aria-label="Folder logowania"
                onChange={(e) => setDir(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key !== "Enter") return;
                  e.preventDefault();
                  add();
                }}
              />
              <button type="button" className="btn" onClick={() => void pickDir().then((p) => p && setDir(p))}>
                Wybierz…
              </button>
              <button type="button" className="btn primary" disabled={trimmed === "" || folder === ""} onClick={add}>
                Dodaj
              </button>
            </div>
          </>
        );
      }}
    </Dialog>
  );
}
