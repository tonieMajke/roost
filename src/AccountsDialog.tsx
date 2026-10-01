import { useState } from "react";
import { X } from "lucide-react";
import type { AccountDef, AccountKind, Accounts } from "./accounts";
import { Dialog } from "./Dialog";
import { IconButton } from "./IconButton";
import { t } from "./i18n";
import { useT } from "./i18n/useT";

type Props = {
  value: Accounts;
  /** Wybór folderu systemowym oknem; `null` = anulowanie. */
  pickDir(): Promise<string | null>;
  /** Zaloguj = nowy panel agenta na tym koncie; agent sam pokaże ekran logowania. */
  canLogin: boolean;
  onLogin(account: AccountDef): void;
  onChange(next: Accounts): void;
  onClose(): void;
};

const KINDS: { kind: AccountKind; name: string; hint: () => string }[] = [
  { kind: "claude", name: "Claude", hint: () => t("ui2.acc.hintClaude") },
  { kind: "codex", name: "Codex", hint: () => t("ui2.acc.hintCodex") },
];

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

/** Okno „Konta”: osobne foldery logowania Claude / Codex; konto domyślne agenta (bez wpisu) zawsze istnieje. */
export function AccountsDialog({ value, pickDir, canLogin, onLogin, onChange, onClose }: Props) {
  useT();
  const [kind, setKind] = useState<AccountKind>("claude");
  const [name, setName] = useState("");
  const [dir, setDir] = useState("");
  const hint = KINDS.find((k) => k.kind === kind)!.hint();

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
    <Dialog label={t("ui2.acc.title")} onClose={onClose}>
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
            <h2>{t("ui2.acc.title")}</h2>
            <p>{t("ui2.acc.desc")}</p>
            {KINDS.map((k) => {
              const mine = value.accounts.filter((a) => a.kind === k.kind);
              const current = value.defaults[k.kind];
              return (
                <div key={k.kind} className="acc-group">
                  <h3 className="acc-title">{k.name}</h3>
                  <ul className="pm-list">
                    <li className="pm-item">
                      <button type="button" className="pm-row" onClick={() => setDefault(null, k.kind)}>
                        <span className="pm-name">{current === undefined ? "● " : "○ "}{t("ui2.acc.default", { name: k.name })}</span>
                        <span className="pm-agents">{t("ui2.acc.agentFolder")}</span>
                      </button>
                    </li>
                    {mine.map((a) => (
                      <li key={a.id} className="pm-item">
                        <button type="button" className="pm-row" onClick={() => setDefault(a, k.kind)}>
                          <span className="pm-name">{current === a.id ? "● " : "○ "}{a.name}</span>
                          <span className="pm-agents">{a.dir}</span>
                        </button>
                        <button
                          type="button"
                          className="btn acc-login"
                          disabled={!canLogin}
                          title={t("ui2.acc.loginTip")}
                          onClick={() => onLogin(a)}
                        >
                          {t("ui2.acc.login")}
                        </button>
                        <IconButton icon={X} label={t("ui2.acc.delete", { name: a.name })} className="pm-del" onClick={() => remove(a)} />
                      </li>
                    ))}
                  </ul>
                </div>
              );
            })}
            <p className="set-foot">{t("ui2.acc.foot")}</p>
            <hr className="pm-sep" />
            <div className="pm-save">
              <select
                className="pm-input acc-kind"
                value={kind}
                aria-label={t("ui2.acc.kindAria")}
                onChange={(e) => setKind(e.target.value as AccountKind)}
              >
                {KINDS.map((k) => (
                  <option key={k.kind} value={k.kind}>{k.name}</option>
                ))}
              </select>
              <input
                className="pm-input"
                value={name}
                placeholder={t("ui2.acc.namePh")}
                aria-label={t("ui2.acc.nameAria")}
                onChange={(e) => setName(e.target.value)}
              />
            </div>
            <div className="pm-save">
              <input
                className="pm-input"
                value={dir}
                placeholder={hint}
                aria-label={t("ui2.acc.dirAria")}
                onChange={(e) => setDir(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key !== "Enter") return;
                  e.preventDefault();
                  add();
                }}
              />
              <button type="button" className="btn" onClick={() => void pickDir().then((p) => p && setDir(p))}>
                {t("ui2.acc.pick")}
              </button>
              <button type="button" className="btn primary" disabled={trimmed === "" || folder === ""} onClick={add}>
                {t("ui2.acc.add")}
              </button>
            </div>
          </>
        );
      }}
    </Dialog>
  );
}
