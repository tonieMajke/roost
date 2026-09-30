import type { ButtonHTMLAttributes, ReactNode } from "react";
import type { LucideIcon } from "lucide-react";

type Props = Omit<ButtonHTMLAttributes<HTMLButtonElement>, "type" | "children"> & {
  icon: LucideIcon;
  /** Opis dla czytnika i podpowiedzi, np. „Zamknij panel”. */
  label: string;
  /** Skrót dopisywany w nawiasie: „Zamknij panel (Ctrl+Alt+W)”. */
  shortcut?: string;
  /** Zastępuje ikonę, np. tekst „Na pewno?” przy zamykaniu. */
  children?: ReactNode;
};

/** Square 26×26 icon button from wzor D (`.icon`), 15 px lucide icon. */
export function IconButton({ icon: Icon, label, shortcut, className, title, children, ...rest }: Props) {
  const full = shortcut ? `${label} (${shortcut})` : label;
  return (
    <button
      type="button"
      aria-label={full}
      title={title ?? full}
      className={className ? `icon ${className}` : "icon"}
      {...rest}
    >
      {children ?? <Icon size={15} strokeWidth={1.75} aria-hidden />}
    </button>
  );
}
