[Polski](README.pl.md) · **English**

# Roost

*Rule the roost.*



https://github.com/user-attachments/assets/6798c7fb-9c21-4cbf-a05f-db971493c9fd




A desktop app (Electron + React + TypeScript, Linux only) for running several CLI agents at
once. On the left is a rail of projects (folders); on the right, a grid of 1–16 terminals for the
active project. Switching projects does not stop any processes — hidden grids keep running.

Every pane is a real PTY rendered by xterm.js. A pane starts the agent in the project folder and
tracks the conversation UUID, so after an app restart you land back in the same conversations.

The interface is available in **English and Polish**. By default it follows your system language
(Polish systems get Polish, everything else gets English); change it any time in
**Appearance → Language**.

## Features

- **Code** — the terminal grid described above: presets, drag-and-drop pane swapping, Shift-drag to hand a conversation summary
  to another pane, dropping files to paste their paths, a dashboard
  with Claude limits and context use, Ctrl-click on `path:line` in terminal output, notifications
  when a hidden agent finishes.
- **Chat** — a claude.ai-style conversation tab. Models: Claude and ChatGPT through your
  subscription (`claude -p`, `codex exec`), API keys (stored in the system keyring), local models
  (llama-server). You can switch models mid-conversation and search the web with sources.
- **Bot** — your own bots, each with a personality, persistent memory, skills it writes itself,
  tools (web, files, shell; writes and commands ask for permission first) and a schedule that
  runs while the app is open. A built-in Creator builds a bot from a description.
- **Voice** — dictation into any pane and a live voice conversation (microphone → speech
  recognition → model → speech), which can also open and read panes.
- **Files and git** — a side panel with the project tree, diffs, stage/unstage/discard, commit,
  pull and push.
- **Accounts** — several Claude/Codex logins and "continue on another account" at a limit (below).
- **Appearance** — over 20 themes, English and Polish interface.

## Screenshots

![Roost: nine agents side by side in one grid](docs/screenshots/grid.webp)

| | |
|---|---|
| ![Dashboard: Claude limits per account, context per pane, live feed](docs/screenshots/dashboard.webp) | ![Token statistics by day, model, project, provider and account](docs/screenshots/statistics.webp) |
| Dashboard: Claude limits per account, context per pane, live feed | Token statistics by day, model, project, provider and account |
| ![Chat: subscriptions, API and local models in one picker](docs/screenshots/chat.webp) | ![Bot: a reviewer reads the diff and writes its notes, with permission](docs/screenshots/bots.webp) |
| Chat: subscriptions, API and local models in one picker | Bot: a reviewer reads the diff and writes its notes, with permission |
| ![Files and git: diff, stage, commit, push](docs/screenshots/files-git.webp) | ![Over 20 themes](docs/screenshots/themes.webp) |
| Files and git: diff, stage, commit, push | Over 20 themes |

## Download

Prebuilt AppImage (Linux x86_64): **[Releases](https://github.com/tonieMajke/roost/releases)**.

```bash
chmod +x Roost-*.AppImage
./Roost-*.AppImage
```

Each release has a `.sha256` file next to it (`sha256sum -c Roost-<version>.AppImage.sha256`). Agents
are not bundled — see Requirements below. If it doesn't start, see [Troubleshooting](#troubleshooting).

From 0.0.3 on, the AppImage and the Windows installer check GitHub for updates, download them in the
background and ask to restart (the zip doesn't). To turn this off, set `ROOST_NO_UPDATE=1`.
Keep the AppImage under a stable name (e.g. `~/.local/bin/Roost.AppImage`): updates then replace the
file in place. With a version in the name the update gets a new file name; Roost then fixes its own
menu entry (`~/.local/share/applications`) on the next start.

### Windows (beta)

Same place: `Roost-Setup-<version>.exe` (per-user installer, no administrator rights needed) or
`Roost-<version>-win-x64.zip` (portable). Windows 10/11, x64.

The app is not code-signed, so on first start SmartScreen shows "Windows protected your PC":
**More info → Run anyway**.

Agents and tools (all optional, on `PATH`):

```powershell
npm install -g @anthropic-ai/claude-code @openai/codex
winget install Git.Git BurntSushi.ripgrep.MSVC
```

Differences from Linux:

- The "Terminal" pane runs PowerShell.
- Configuration lives in `%APPDATA%\dev.majke.roost\`.
- The bots' `bash` tool is disabled; the other tools (files, `grep`, web) work.

## Requirements

Linux, Node.js and pnpm to build from source. The agents themselves are not bundled; install the
ones you use and make sure they are on `PATH`: `claude`, `codex`, `pi`. Optional: `git` and `rg`
(file panel, bot tools), `piper-tts` (local speech; on Arch/AUR the binary is `piper-tts`, not
`piper`), a `whisper`-compatible server for dictation.

## Running

```bash
pnpm install
pnpm desktop          # Electron window (build + start; once beforehand: cd electron && npm install)
```

For a distributable build: `pnpm electron:dist` (`electron/release/Roost-<version>.AppImage`).
The former Tauri version lives in `legacy-tauri/` (unused, see its README).

The backend runs in Node (`electron/src/`, IPC through `preload.ts` → `src/backend-electron.ts`).
Configuration lives in `~/.config/dev.majke.roost/` (`ROOST_CONFIG_DIR` points it elsewhere —
don't run two copies at once against a shared `workspace.json`). On first start after the rename from
"Agents", the old `~/.config/dev.majke.agents/` is copied to the new folder (the old one stays as a backup).

Checks (the same ones CI runs):

```bash
pnpm install && (cd electron && npm ci && npm run build)   # tests need node-pty and out/mcp-server.cjs
pnpm typecheck && pnpm test && (cd electron && npm run typecheck)
```

### Browser preview (no processes)

```bash
pnpm dev              # http://localhost:5183
```

The same interface with fake terminals (a `[preview] …` banner, `exit`, `fail`). Layout state is
kept in `localStorage` (key `aw-workspace`) instead of a file. Handy for checking layout and
styles without opening a window on your desktop.

## Configuration files

In `~/.config/dev.majke.roost/`:

- `agents.json` — the list of agents (created with default entries on first start). A corrupted
  file is never overwritten; the app shows an error in the bar instead.
- `accounts.json` — agent accounts (optional; created when you add your first account in the
  Accounts window).
- `claude-limits.json`, `claude-limits.<account id>.json` — the latest Claude subscription limits
  taken from the status line.
- `workspace.json` — layout (projects, panes, session UUIDs, presets) and appearance settings,
  including the language (`ui.lang`: `auto`, `pl` or `en`). Written on every change. Paths may be
  shortened to `~/…` (expanded when a process starts).
- `workspace.<YYYY-MM-DD>.bak` — a copy made before the first write when the file was unreadable
  or could not be parsed (one per day, never overwritten).

### Agents

Defaults: `claude`, `pi`, `shell` (Terminal). The file has the shape `{ "agents": [...] }`:

```json
{
  "agents": [
    { "id": "claude", "name": "Claude", "command": "claude",
      "session": { "new": ["--session-id", "{session}"], "resume": ["--resume", "{session}"], "check": "claude" } },
    { "id": "codex", "name": "Codex", "command": "codex",
      "args": ["--sandbox", "workspace-write"] }
  ]
}
```

codex does not accept a UUID when creating a conversation, so it has no `session`: a codex pane
starts fresh after an app restart (you can type `codex resume` in it by hand).

- `command` — the program to run; `$SHELL` is expanded by the app.
- `args` — fixed arguments, always placed before the session arguments.
- `session.new` / `session.resume` — arguments to start a new conversation / resume one;
  `{session}` is replaced with the pane's UUID. Without `session` a pane always starts fresh.
- `session.check: "claude"` — before resuming, the app checks that the conversation file exists in
  `~/.claude/projects/*/<uuid>.jsonl` (for other agents it always counts as "new").

A new agent shows up in "+ Pane" right away and can be part of a preset.

## Presets

`Presets` in the header: built-in ones ("Claude + pi", "2× Claude + 2× pi", "4× Claude"), your own,
and "Save current layout…" (from the panes of the active project, in their order). Choosing a
preset appends its panes to the active project, up to the limit of 16; skipped panes and agents
missing from `agents.json` are reported in a message above the grid. Custom presets are stored in
`workspace.json` (`presets`), built-in ones in the code (`src/presets.ts`). In a project with no
panes the built-in presets sit next to "+ Pane".

## Dragging panes, files and context

- **Swap panes:** grab a pane by its header and drag it onto another pane. The pane shrinks into a
  bubble that follows the cursor; dropping it swaps the two places. The processes keep running,
  nothing restarts. Esc or dropping it anywhere else cancels.
- **Hand over context (Shift + drag):** hold Shift while dragging (you can press it mid-flight) and
  drop the pane onto another one. The source conversation is summarized into a few bullet points
  — goal, what was done, decisions, files touched, what is still open — and pasted into the target
  pane **without pressing Enter**, followed by a line for your own instruction. The target can be
  any agent: a fresh Claude, pi on a local model, another account. The source pane stays as it
  was. The summary is made by Haiku on the default Claude account (at most 1500 characters); if
  that fails, a shortened excerpt of the conversation is pasted instead. Only Claude and pi
  conversations can be read, so a Codex or shell pane can't be the source.
- **Start over with a summary:** the same summary is behind the ⇄ icon in the pane header
  ("Continue elsewhere") — it opens a **new** pane, on another account or another agent, and
  pastes the summary there. Handy when a long session has filled up its context and you want to
  continue in a clean conversation without losing the thread.
- **Drop files:** drag files from your file manager onto a pane to type their paths into the
  prompt, quoted for the shell and without Enter.

## Accounts and continuing on another account

Several subscriptions (say, work and personal), or a limit that just ran out? An **account** is a
separate agent login folder: `CLAUDE_CONFIG_DIR` for Claude, `CODEX_HOME` for Codex. The app only
knows the folder path and sets the variable for the pane's process. It never reads, copies or
stores tokens; the agent does the logging in itself.

- **Adding:** the `Accounts` button in the header. You give the agent, a name and a folder (e.g.
  `~/.claude-work`). `Sign in` opens an agent pane on that account, and the agent shows its own
  login screen. The agent creates the folder. "Default account" is the agent's normal folder
  (`~/.claude`, `~/.codex`), with no variable; ● marks the account that new panes get.
- **Choosing in a pane:** "New pane" has an "Account" row for Claude and Codex. The account is
  saved in the pane permanently, so changing the default doesn't move running panes (sessions live
  in the account's folder). The pane header shows a badge with the account name.
- **Limits:** every Claude account has its own limits file and its own block in the dashboard.
- **At a limit:** when an account's limit window reaches 100 %, the pane shows a bar with the reset
  time and the options "Continue elsewhere" or "I'll wait". The same is always available under the
  ⇄ icon in the pane header. Continuing opens a **new** pane (another account of the same agent, or
  another agent such as Codex) and pastes a summary of the conversation into it, without pressing
  Enter. Resuming the same session on another account isn't possible because sessions are
  per-account.

Limitations: only Claude and pi can have their conversations extracted, so "Continue" is missing
from Codex panes; limits are detected for Claude only; the summary is made by Haiku on the default
Claude account (when that one is exhausted, a shortened excerpt is pasted instead).

## Keyboard shortcuts

| Key | Action |
| --- | --- |
| Ctrl+Alt+←/→/↑/↓ | focus a pane in the grid |
| Ctrl+Alt+Enter | maximize / restore the pane |
| Ctrl+Alt+N | new pane (pick an agent: 1–9, ↑↓, Enter, Esc) |
| Ctrl+Alt+P | new project (asks for a folder) |
| Ctrl+Alt+1…9 | go to project number N |
| Ctrl+Alt+B | collapse / expand the project rail (56 px of keys and dots) |
| Ctrl+Alt+D | show / hide the dashboard |
| Ctrl+Alt+C | switch Code → Chat → Bot |
| Ctrl+Alt+`+` / `-` / `0` | terminal font size: larger / smaller / reset |
| Ctrl+Alt+R | restart the active pane |
| Ctrl+Alt+W | close the active pane (with a live process: a second press = "Sure?") |
| Ctrl+F / Ctrl+G / Ctrl+Shift+G | search in the terminal / next / previous match (Esc closes) |
| Ctrl+Shift+C / Ctrl+Shift+V | copy the selection / paste into the active pane |

Moving panes by keyboard (Ctrl+Alt+Shift+arrows) may be taken by your desktop environment.

Plain Ctrl+C and Ctrl+V are not intercepted — they go to the process (SIGINT, pasting an image
into claude). The dot in a pane header: grey = process finished, pulsing = the agent is working,
accent = it printed something while you weren't looking.

The dot next to a project on the rail reflects panes whose grid you can't see right now: grey
pulsing = an agent is working, accent = new output; the same colour pulses once (`ping`) when work
finished in a hidden project.

## How it works

- `src/workspace.ts` — the pure model (reducer, grid, `parseWorkspace`), tests in `*.test.ts`.
- `src/backend.ts` — the shared contract: `backend-electron.ts` (real commands) and
  `backend-mock.ts` (preview). Components never call IPC directly.
- `src/Terminal.tsx` — xterm + PTY; the process lives exactly as long as the component, the React
  key is `${pane.id}:${pane.run}`.
- `electron/src/pty.ts` — `spawn`/`write`/`resize`/`kill`, process group = pid, so killing cleans up
  the child's whole tree (SIGHUP, SIGKILL after 1.5 s). On app exit `killAll` closes everything.
- `src/i18n/` — interface translations (`pl`, `en`); see "Translating" below.

## Translating

UI text goes through `t()` / `useT()` from `src/i18n`. Strings live in `src/i18n/messages/<area>.ts`
as a `{ pl, en }` pair; the compiler checks that both languages have the same keys. The Electron main
process has its own small table in `electron/src/i18n.ts`. To add a language, add its table next to
`pl`/`en` in each area file and the language in `src/i18n/index.ts` (`Lang`, `LANGS`) and its choice in the language row of `src/ui.ts`.

Not translated on purpose: prompts and tool descriptions sent to language models, and code comments
(which are mostly Polish).

## Troubleshooting

- **API keys are lost after an update** — keys live in the system keyring (`safeStorage`) under the
  app name; don't rename the app's `userData`. Without a keyring (e.g. KWallet not running) they
  cannot be saved.
- **A codex pane starts fresh after a restart** — codex can't be given a conversation UUID; type
  `codex resume` in the pane.
- **AppImage won't start (`dlopen(): error loading libfuse.so.2`)** — AppImages built with the old
  runtime need libfuse2, which Ubuntu 22.04+ no longer installs by default
  (`sudo apt install libfuse2t64` on 24.04, `libfuse2` on 22.04). Current builds use the static
  runtime and don't need it; without any FUSE (containers, WSL) run
  `./Roost-<version>.AppImage --appimage-extract-and-run`.
- **`error while loading shared libraries: libnss3.so` (or `libgtk-3.so.0`, `libasound.so.2`, `libgbm.so.1`)** — a minimal
  install without a desktop. On Debian/Ubuntu: `sudo apt install libgtk-3-0 libnss3 libasound2 libgbm1`
  (on Ubuntu 24.04 the packages are `libgtk-3-0t64` and `libasound2t64`).
- **Ubuntu 24.04+: "Roost is running without the Chromium sandbox"** — AppArmor blocks the
  unprivileged user namespaces Chromium's sandbox needs. The AppImage launcher then starts the app with
  `--no-sandbox` so it still opens, and Roost shows this warning once. Without the sandbox, a bug in the
  renderer (which shows web content, e.g. chat answers and fetched pages) would run with all your
  user's rights. To turn the sandbox back on, add an AppArmor profile for the AppImage (use its full path;
  `*` matches any version):

  ```bash
  sudo tee /etc/apparmor.d/roost <<'EOF'
  abi <abi/4.0>,
  include <tunables/global>

  profile roost /home/YOU/Applications/Roost-*.AppImage flags=(unconfined) {
    userns,
  }
  EOF
  sudo apparmor_parser -r /etc/apparmor.d/roost
  ```

  Checked on Ubuntu 24.04: with the profile the renderer runs in its own namespace with seccomp.
- **A pane shows `execvp(3) failed.: No such file or directory`** — the agent program (`claude`, `pi`,
  …) is not in `PATH`. Install it, or set the full path in `agents.json`. An AppImage started from the
  desktop menu may have a shorter `PATH` than your terminal.
- **Two windows overwrite each other's layout** — use `ROOST_CONFIG_DIR` for a second copy.
- **No voice output** — check that `piper-tts` is installed and set as the program in
  Voice → Conversation.

## Documentation

Plans and design notes (in Polish) are indexed in [`docs/README.md`](docs/README.md); current
state and open manual checks: `HANDOFF.md`.

## License

Roost is free software, licensed under the GNU General Public License v3.0 or later (GPL-3.0-or-later); see [`LICENSE`](LICENSE). You may use, modify and distribute it, including commercially, but derived versions must make their source code available under the same license. Third-party components: [`THIRD-PARTY-NOTICES.md`](THIRD-PARTY-NOTICES.md).

Copyright (C) 2026 majke
