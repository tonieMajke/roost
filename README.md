# Agents workspace

Desktopowa aplikacja (Tauri 2 + React + TypeScript, tylko Linux) do pracy z wieloma
agentami CLI naraz. Po lewej szyna z projektami (folderami), po prawej siatka 1–16
terminali aktywnego projektu. Przełączenie projektu nie zatrzymuje procesów —
schowane siatki żyją dalej.

Każdy panel to prawdziwy PTY (`portable-pty`) renderowany przez xterm.js. Panel
uruchamia agenta w folderze projektu i pilnuje UUID rozmowy, żeby po restarcie
aplikacji wrócić do tych samych rozmów.

## Uruchomienie

```bash
pnpm install
pnpm desktop          # okno Tauri (dev)
pnpm electron         # okno Electron (build + start; raz wcześniej: cd electron && npm install)
```

Produktowo: `pnpm tauri build` (binarka w `src-tauri/target/release/bundle/`) albo
`pnpm electron:dist` (`electron/release/Agents-<wersja>.AppImage`).

Wersja Electron (`electron/`): ten sam frontend z `src/`, backend w Node (`electron/src/`,
IPC przez `preload.ts` → `src/backend-electron.ts`), ta sama konfiguracja
`~/.config/dev.majke.agents/` (`AGENTS_CONFIG_DIR` przestawia ją na inną – nie uruchamiaj
obu wersji naraz na wspólnym `workspace.json`).

Sprawdzenia: `pnpm typecheck`, `pnpm test` (vitest),
`cargo test --manifest-path src-tauri/Cargo.toml --lib`,
`cargo build --manifest-path src-tauri/Cargo.toml`.

### Podgląd w przeglądarce (bez procesów)

```bash
pnpm dev              # http://localhost:5183
```

Ten sam interfejs z udawanymi terminalami (banner `[podgląd] …`, `exit`, `fail`).
Stan układu trafia tu do `localStorage` (klucz `aw-workspace`) zamiast do pliku.
Służy do sprawdzania układu i stylów bez otwierania okna na pulpicie.

## Pliki konfiguracyjne

W `~/.config/dev.majke.agents/`:

- `agents.json` — lista agentów (tworzona z domyślnymi wpisami przy pierwszym starcie).
  Uszkodzonego pliku aplikacja nie nadpisuje, tylko pokazuje błąd w pasku.
- `workspace.json` — układ (projekty, panele, UUID sesji, presety). Zapisywany przy
  każdej zmianie. Ścieżki bywają skracane do `~/…` (rozwijane przy starcie procesu).
- `workspace.<RRRR-MM-DD>.bak` — kopia przed pierwszym zapisem, gdy plik był
  nieczytelny lub nie do parsowania (jedna na dzień, bez nadpisywania).

### Agenci

Domyślnie: `claude`, `pi`, `shell` (Terminal). Plik ma postać `{ "agents": [...] }`:

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

codex nie przyjmuje UUID przy tworzeniu rozmowy, więc nie ma tu `session`: panel codexa
po restarcie aplikacji startuje od nowa (`codex resume` można wpisać w nim ręcznie).

- `command` — program do uruchomienia; `$SHELL` jest rozwijany przez aplikację.
- `args` — stałe argumenty, zawsze przed argumentami sesji.
- `session.new` / `session.resume` — argumenty na start nowej rozmowy / wznowienie;
  `{session}` zastępuje się UUID panelu. Bez `session` panel zawsze startuje od nowa.
- `session.check: "claude"` — przed wznowieniem aplikacja sprawdza, czy plik rozmowy
  istnieje w `~/.claude/projects/*/<uuid>.jsonl` (dla innych agentów: zawsze „nowa”).

Nowy agent od razu pojawia się w „+ Panel” i może wejść w skład presetu.

## Presety

`Presety` w nagłówku: wbudowane („Claude + pi”, „2× Claude + 2× pi”, „4× Claude”),
własne oraz „Zapisz obecny układ…” (z paneli aktywnego projektu, w ich kolejności).
Wybrany preset dopisuje panele na koniec aktywnego projektu, do limitu 16 — o
pominiętych panelach i agentach spoza `agents.json` mówi komunikat nad siatką.
Własne presety są w `workspace.json` (`presets`), wbudowane w kodzie (`src/presets.ts`).
W projekcie bez paneli presety wbudowane stoją obok „+ Panel”.

## Skróty klawiszowe

| Klawisz | Akcja |
| --- | --- |
| Ctrl+Alt+←/→/↑/↓ | fokus panelu w siatce |
| Ctrl+Alt+Enter | maksymalizuj / przywróć panel |
| Ctrl+Alt+N | nowy panel (wybór agenta: 1–9, ↑↓, Enter, Esc) |
| Ctrl+Alt+P | nowy projekt (pyta o katalog) |
| Ctrl+Alt+1…9 | przejdź do projektu numer N |
| Ctrl+Alt+B | zwiń / rozwiń szynę projektów (56 px samych klawiszy i kropek) |
| Ctrl+Alt+R | uruchom ponownie aktywny panel |
| Ctrl+Alt+W | zamknij aktywny panel (przy żywym procesu: drugi raz = „Na pewno?”) |
| Ctrl+Shift+C / Ctrl+Shift+V | kopiuj zaznaczenie / wklej do aktywnego panelu |

Zwyczajne Ctrl+C i Ctrl+V nie są przechwytywane — trafiają do procesu (SIGINT,
wklejenie obrazka w claude). Kropka w nagłówku panelu: szara = proces skończony,
pulsująca = agent pracuje, akcentowa = coś wypisał, gdy na niego nie patrzysz.

Kropka przy projekcie na szynie dotyczy paneli, których siatki teraz nie widać:
szara pulsująca = agent pracuje, akcentowa = nowe wyjście; ten sam kolor pulsuje
jednorazowo (`ping`), gdy praca skończyła się w ukrytym projekcie.

## Jak to działa

- `src/workspace.ts` — czysty model (reducer, siatka, `parseWorkspace`), testy w `*.test.ts`.
- `src/backend.ts` — kontrakt wspólny: `backend-tauri.ts` (prawdziwe komendy) i `backend-mock.ts`
  (podgląd). Komponenty nie importują `@tauri-apps/*` bezpośrednio.
- `src/Terminal.tsx` — xterm + PTY; proces żyje dokładnie tak długo jak komponent,
  klucz Reacta to `${pane.id}:${pane.run}`.
- `src-tauri/src/pty.rs` — `spawn`/`write`/`resize`/`kill`, grupa procesów = pid, więc
  zabijanie sprząta całe drzewo dziecka. Przy wyjściu aplikacji `kill_all` domyka wszystko.

Plan etapów: `docs/plan-m1.md`, bieżący stan: `HANDOFF.md`.
