import type { Dir } from "./workspace";

/** What a recognised shortcut asks the app to do (stage 8). */
export type Command =
  | { type: "move"; dir: Dir }
  | { type: "toggleMaximize" }
  | { type: "newPane" }
  | { type: "closePane" }
  | { type: "restartPane" }
  | { type: "copy" }
  | { type: "paste" }
  | { type: "selectProject"; index: number } // 0-based; outside the list -> nothing
  | { type: "newProject" }
  | { type: "toggleRail" }
  | { type: "toggleDock" };

/** The part of a keydown event the mapping needs. */
export type KeyLike = Pick<KeyboardEvent, "key" | "ctrlKey" | "altKey" | "shiftKey" | "metaKey">;

/**
 * Keyboard shortcut map. Everything not listed here returns `null`, so it reaches the
 * terminal untouched: plain Ctrl+C goes to the process (SIGINT) and plain Ctrl+V stays
 * for the agent (claude pastes images with it).
 */
export function commandFor(e: KeyLike): Command | null {
  if (e.metaKey) return null; // the Super key belongs to the desktop
  const key = e.key.toLowerCase(); // letters arrive as "n" or "N" with Alt/CapsLock

  if (e.ctrlKey && e.shiftKey && !e.altKey) {
    if (key === "c") return { type: "copy" };
    if (key === "v") return { type: "paste" };
    return null;
  }

  if (!e.ctrlKey || !e.altKey || e.shiftKey) return null;
  switch (key) {
    case "arrowleft":
      return { type: "move", dir: "left" };
    case "arrowright":
      return { type: "move", dir: "right" };
    case "arrowup":
      return { type: "move", dir: "up" };
    case "arrowdown":
      return { type: "move", dir: "down" };
    case "enter":
      return { type: "toggleMaximize" };
    case "n":
      return { type: "newPane" };
    case "w":
      return { type: "closePane" };
    case "r":
      return { type: "restartPane" };
    case "p":
      return { type: "newProject" };
    case "b":
      return { type: "toggleRail" };
    case "d":
      return { type: "toggleDock" };
    default:
      // Ctrl+Alt+0 has no 10th project to select.
      return /^[1-9]$/.test(key) ? { type: "selectProject", index: Number(key) - 1 } : null;
  }
}
