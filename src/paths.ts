/** Paths are stored with `~` instead of the home directory (Rust expands them in `pty::expand`).
 *  Helpers here accept Unix paths and Windows paths (`C:\Users\x`, `\\server\share`). */

/** Windows path: drive letter or UNC. Compared case-insensitively, `\` and `/` are equal. */
const isWinPath = (p: string) => /^[a-zA-Z]:[\\/]/.test(p) || p.startsWith("\\\\");
const key = (p: string) => (isWinPath(p) ? p.replaceAll("\\", "/").toLowerCase() : p);

/** Without trailing separators; the root stays (`/`, `C:\`). */
export function trimSep(path: string): string {
  const t = path.replace(/[\\/]+$/, "");
  if (t === "") return path === "" ? "" : path[0] === "\\" ? "\\" : "/";
  if (/^[a-zA-Z]:$/.test(t)) return t + path[t.length];
  return t;
}

/** Last segment: "/a/b/" -> "b", "C:\a\b" -> "b"; a root stays itself. */
export function baseName(path: string): string {
  const t = trimSep(path);
  const name = t.slice(Math.max(t.lastIndexOf("/"), t.lastIndexOf("\\")) + 1);
  return name === "" ? t : name;
}

/** `path` equals `dir` or lies under it. Windows paths: case and slash direction do not matter. */
export function isUnder(path: string, dir: string): boolean {
  const p = key(trimSep(path));
  const d = key(trimSep(dir));
  if (d === "") return false;
  return p === d || p.startsWith(d.endsWith("/") ? d : `${d}/`);
}

/** Program name from an agent command: "/usr/bin/claude" and "C:\…\claude.exe" -> "claude". */
export function programName(command: string): string {
  const name = baseName(command.trim());
  return /\.(exe|cmd|bat|com)$/i.test(name) ? name.replace(/\.[^.]+$/, "").toLowerCase() : name;
}

/** "/home/majke/x" + "/home/majke" -> "~/x" (Windows: "C:\Users\Ja\x" -> "~\x").
 *  Trailing slashes are dropped; other paths are only cleaned. */
export function tildify(path: string, home: string): string {
  const clean = trimSep(path) || "/";
  const base = trimSep(home);
  // Without a usable home prefix there is nothing to shorten.
  if (base === "" || base === "/" || base === "\\") return clean;
  if (key(clean) === key(base)) return "~";
  return isUnder(clean, base) ? `~${clean.slice(base.length)}` : clean;
}
