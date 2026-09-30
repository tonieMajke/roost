/** Workspace state model: pure functions, no React, no side effects.
 *  `reduce` never mutates its input and never calls randomUUID/Date.now —
 *  the caller creates ids and passes them in actions. */

export const MAX_PANES = 16; // per project

export type Pane = {
  id: string; // crypto.randomUUID(), created by the caller
  agentId: string;
  sessionId?: string; // only when the agent has `session`; crypto.randomUUID()
  run: number; // bumped on restart -> new React key
};

export type Project = {
  id: string;
  name: string; // defaults to the last path segment
  path: string; // folder; cwd of every pane
  panes: Pane[];
  focused: string | null;
  maximized: string | null;
};

export type Preset = { name: string; agents: string[] }; // stage 10

export type Workspace = {
  version: 1;
  projects: Project[];
  active: string | null; // active project id
  presets: Preset[];
};

export const emptyWorkspace: Workspace = { version: 1, projects: [], active: null, presets: [] };

/** Auto grid layout: cols = ceil(sqrt(n)), rows = ceil(n / cols). */
export function gridShape(n: number): { cols: number; rows: number } {
  if (n <= 0) return { cols: 0, rows: 0 };
  const cols = Math.ceil(Math.sqrt(n));
  return { cols, rows: Math.ceil(n / cols) };
}

export type Dir = "left" | "right" | "up" | "down";

/** Index of the grid neighbor of `index` among `n` panes; no neighbor -> `index`.
 *  Moving down into an empty cell of the last row -> last pane. */
export function neighbor(index: number, dir: Dir, n: number): number {
  if (index < 0 || index >= n || n <= 0) return index;
  const { cols, rows } = gridShape(n);
  const r = Math.floor(index / cols);
  const c = index % cols;
  const nr = dir === "up" ? r - 1 : dir === "down" ? r + 1 : r;
  const nc = dir === "left" ? c - 1 : dir === "right" ? c + 1 : c;
  if (nr < 0 || nr >= rows || nc < 0 || nc >= cols) return index;
  const ni = nr * cols + nc;
  if (ni < n) return ni;
  // Cell exists in the grid but is past the last pane (trailing holes).
  return dir === "down" ? n - 1 : index;
}

export function activeProject(ws: Workspace): Project | null {
  return ws.projects.find((p) => p.id === ws.active) ?? null;
}

/** Last path segment: "/a/b/" -> "b", "~" -> "~", "/" -> "/". */
export function projectName(path: string): string {
  const trimmed = path.replace(/\/+$/, "");
  const idx = trimmed.lastIndexOf("/");
  const name = idx >= 0 ? trimmed.slice(idx + 1) : trimmed;
  return name === "" ? "/" : name;
}

export type Action =
  | { type: "addProject"; project: Project } // same path already present -> just activate it
  | { type: "removeProject"; id: string } // active -> next, else previous, else null
  | { type: "selectProject"; id: string }
  | { type: "renameProject"; id: string; name: string }
  // Pane actions operate on the active project; with no active project they do nothing.
  | { type: "add"; pane: Pane } // ignored at MAX_PANES; focuses the new pane
  | { type: "close"; id: string } // focus -> pane at the same index, else previous
  | { type: "restart"; id: string } // run + 1
  | { type: "newConversation"; id: string; sessionId: string } // run + 1
  | { type: "focus"; id: string } // finds the pane in any project and activates that project
  | { type: "move"; dir: Dir } // focus the grid neighbor
  | { type: "toggleMaximize"; id?: string } // no id = the focused pane
  | { type: "load"; workspace: Workspace };

function mapProject(ws: Workspace, id: string, fn: (p: Project) => Project): Workspace {
  let changed = false;
  const projects = ws.projects.map((p) => {
    if (p.id !== id) return p;
    const q = fn(p);
    if (q !== p) changed = true;
    return q;
  });
  return changed ? { ...ws, projects } : ws;
}

function patchActive(ws: Workspace, fn: (p: Project) => Project): Workspace {
  const proj = activeProject(ws);
  if (!proj) return ws;
  return mapProject(ws, proj.id, fn);
}

function mapPane(p: Project, paneId: string, fn: (pane: Pane) => Pane): Project {
  if (!p.panes.some((x) => x.id === paneId)) return p;
  return { ...p, panes: p.panes.map((x) => (x.id === paneId ? fn(x) : x)) };
}

export function reduce(ws: Workspace, action: Action): Workspace {
  switch (action.type) {
    case "addProject": {
      const existing = ws.projects.find((p) => p.path === action.project.path);
      if (existing) return existing.id === ws.active ? ws : { ...ws, active: existing.id };
      return { ...ws, projects: [...ws.projects, action.project], active: action.project.id };
    }
    case "removeProject": {
      const idx = ws.projects.findIndex((p) => p.id === action.id);
      if (idx < 0) return ws;
      const projects = ws.projects.filter((p) => p.id !== action.id);
      let active = ws.active;
      if (active === action.id) {
        const next = projects[idx] ?? projects[idx - 1] ?? null;
        active = next ? next.id : null;
      }
      return { ...ws, projects, active };
    }
    case "selectProject": {
      if (action.id === ws.active || !ws.projects.some((p) => p.id === action.id)) return ws;
      return { ...ws, active: action.id };
    }
    case "renameProject":
      return mapProject(ws, action.id, (p) => (p.name === action.name ? p : { ...p, name: action.name }));
    case "add": {
      const proj = activeProject(ws);
      if (!proj || proj.panes.length >= MAX_PANES) return ws;
      return patchActive(ws, (p) => ({ ...p, panes: [...p.panes, action.pane], focused: action.pane.id }));
    }
    case "close":
      return patchActive(ws, (p) => {
        const idx = p.panes.findIndex((x) => x.id === action.id);
        if (idx < 0) return p;
        const panes = p.panes.filter((x) => x.id !== action.id);
        const focused =
          p.focused === action.id ? (panes[idx]?.id ?? panes[idx - 1]?.id ?? null) : p.focused;
        const maximized = p.maximized === action.id ? null : p.maximized;
        return { ...p, panes, focused, maximized };
      });
    case "restart":
      return patchActive(ws, (p) => mapPane(p, action.id, (pane) => ({ ...pane, run: pane.run + 1 })));
    case "newConversation":
      return patchActive(ws, (p) =>
        mapPane(p, action.id, (pane) => ({ ...pane, sessionId: action.sessionId, run: pane.run + 1 })),
      );
    case "focus": {
      const owner = ws.projects.find((p) => p.panes.some((x) => x.id === action.id));
      if (!owner) return ws;
      const next = mapProject(ws, owner.id, (p) => (p.focused === action.id ? p : { ...p, focused: action.id }));
      return next.active === owner.id ? next : { ...next, active: owner.id };
    }
    case "move": {
      const proj = activeProject(ws);
      if (!proj || proj.panes.length === 0) return ws;
      const idx = proj.panes.findIndex((x) => x.id === proj.focused);
      if (idx < 0) return ws;
      const target = proj.panes[neighbor(idx, action.dir, proj.panes.length)];
      return target.id === proj.focused ? ws : patchActive(ws, (p) => ({ ...p, focused: target.id }));
    }
    case "toggleMaximize": {
      const proj = activeProject(ws);
      if (!proj) return ws;
      const id = action.id ?? proj.focused;
      if (id === null || !proj.panes.some((x) => x.id === id)) return ws;
      return patchActive(ws, (p) => ({ ...p, maximized: p.maximized === id ? null : id }));
    }
    case "load":
      return action.workspace;
  }
}

const isStringArray = (v: unknown): v is string[] => Array.isArray(v) && v.every((x) => typeof x === "string");

/** Parse a persisted workspace; invalid parts are repaired and described in `errors`. */
export function parseWorkspace(raw: unknown, agentIds: string[]): { workspace: Workspace; errors: string[] } {
  const errors: string[] = [];
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return { workspace: emptyWorkspace, errors: ["workspace: expected an object"] };
  }
  const r = raw as Record<string, unknown>;
  if (r.version !== undefined && r.version !== 1) {
    return { workspace: emptyWorkspace, errors: [`workspace: unknown version ${String(r.version)}, starting empty`] };
  }

  const known = new Set(agentIds);
  const projects: Project[] = [];
  const seenPaths = new Set<string>();
  if (r.projects !== undefined && !Array.isArray(r.projects)) errors.push("workspace: `projects` must be a list, ignored");
  (Array.isArray(r.projects) ? r.projects : []).forEach((entry, i) => {
    const where = `projects[${i}]`;
    if (typeof entry !== "object" || entry === null) {
      errors.push(`${where}: not an object, skipped`);
      return;
    }
    const e = entry as Record<string, unknown>;
    if (typeof e.path !== "string" || e.path === "") {
      errors.push(`${where}: missing \`path\`, skipped`);
      return;
    }
    if (seenPaths.has(e.path)) {
      errors.push(`${where}: duplicate path \`${e.path}\`, skipped`);
      return;
    }
    seenPaths.add(e.path);

    const panes: Pane[] = [];
    (Array.isArray(e.panes) ? e.panes : []).forEach((pe, j) => {
      const pwhere = `${where}.panes[${j}]`;
      if (typeof pe !== "object" || pe === null) {
        errors.push(`${pwhere}: not an object, skipped`);
        return;
      }
      const p = pe as Record<string, unknown>;
      if (typeof p.agentId !== "string" || !known.has(p.agentId)) {
        errors.push(`${pwhere}: unknown agent \`${String(p.agentId)}\`, pane removed`);
        return;
      }
      const pane: Pane = {
        id: typeof p.id === "string" && p.id !== "" ? p.id : crypto.randomUUID(),
        agentId: p.agentId,
        run: typeof p.run === "number" && Number.isFinite(p.run) && p.run >= 1 ? Math.floor(p.run) : 1,
      };
      if (typeof p.sessionId === "string" && p.sessionId !== "") pane.sessionId = p.sessionId;
      panes.push(pane);
    });
    if (panes.length > MAX_PANES) {
      panes.length = MAX_PANES;
      errors.push(`${where}: more than ${MAX_PANES} panes, truncated`);
    }

    const ids = new Set(panes.map((x) => x.id));
    projects.push({
      id: typeof e.id === "string" && e.id !== "" ? e.id : crypto.randomUUID(),
      name: typeof e.name === "string" && e.name !== "" ? e.name : projectName(e.path),
      path: e.path,
      panes,
      focused: typeof e.focused === "string" && ids.has(e.focused) ? e.focused : null,
      maximized: typeof e.maximized === "string" && ids.has(e.maximized) ? e.maximized : null,
    });
  });

  let active: string | null =
    typeof r.active === "string" && projects.some((p) => p.id === r.active) ? r.active : (projects[0]?.id ?? null);

  const presets: Preset[] = [];
  if (r.presets !== undefined && !Array.isArray(r.presets)) errors.push("workspace: `presets` must be a list, ignored");
  (Array.isArray(r.presets) ? r.presets : []).forEach((entry, i) => {
    const e = entry as Record<string, unknown> | null;
    if (typeof e === "object" && e !== null && typeof e.name === "string" && e.name !== "" && isStringArray(e.agents)) {
      presets.push({ name: e.name, agents: [...e.agents] });
    } else {
      errors.push(`presets[${i}]: expected {name, agents}, skipped`);
    }
  });

  return { workspace: { version: 1, projects, active, presets }, errors };
}
