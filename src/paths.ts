/** Paths are stored with `~` instead of the home directory (Rust expands them in `pty::expand`). */

/** "/home/majke/x" + "/home/majke" -> "~/x". Trailing slashes are dropped; other paths are only cleaned. */
export function tildify(path: string, home: string): string {
  const clean = path.replace(/\/+$/, "") || "/";
  const base = home.replace(/\/+$/, "");
  // Without a usable home prefix there is nothing to shorten.
  if (base === "" || base === "/") return clean;
  if (clean === base) return "~";
  return clean.startsWith(`${base}/`) ? `~${clean.slice(base.length)}` : clean;
}
