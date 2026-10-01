**Polski** · [English](README.md)

# Roost

*Rule the roost.*

Desktopowa aplikacja (Electron + React + TypeScript, tylko Linux) do pracy z wieloma
agentami CLI naraz. Po lewej szyna z projektami (folderami), po prawej siatka 1–16
terminali aktywnego projektu. Przełączenie projektu nie zatrzymuje procesów —
schowane siatki żyją dalej.

Każdy panel to prawdziwy PTY (`portable-pty`) renderowany przez xterm.js. Panel
uruchamia agenta w folderze projektu i pilnuje UUID rozmowy, żeby po restarcie
aplikacji wrócić do tych samych rozmów.

## Uruchomienie

```bash
pnpm install
pnpm desktop          # okno Electron (build + start; raz wcześniej: cd electron && npm install)
```

Produktowo: `pnpm electron:dist` (`electron/release/Roost-<wersja>.AppImage`).
Dawna wersja Tauri leży w `legacy-tauri/` (nieużywana, patrz jej README).

Backend w Node (`electron/src/`, IPC przez `preload.ts` → `src/backend-electron.ts`),
konfiguracja w `~/.config/dev.majke.roost/` (`ROOST_CONFIG_DIR` przestawia ją na inną –
nie uruchamiaj dwóch kopii naraz na wspólnym `workspace.json`). Przy pierwszym starcie po zmianie nazwy z „Agents” stary katalog
`~/.config/dev.majke.agents/` jest kopiowany do nowego (stary zostaje jako kopia zapasowa).

Sprawdzenia: `pnpm typecheck`, `pnpm test` (vitest),
`cd electron && npm run typecheck`.

### Podgląd w przeglądarce (bez procesów)

```bash
pnpm dev              # http://localhost:5183
```

Ten sam interfejs z udawanymi terminalami (banner `[podgląd] …`, `exit`, `fail`).
Stan układu trafia tu do `localStorage` (klucz `aw-workspace`) zamiast do pliku.
Służy do sprawdzania układu i stylów bez otwierania okna na pulpicie.

## Pliki konfiguracyjne

W `~/.config/dev.majke.roost/`:

- `agents.json` — lista agentów (tworzona z domyślnymi wpisami przy pierwszym starcie).
  Uszkodzonego pliku aplikacja nie nadpisuje, tylko pokazuje błąd w pasku.
- `accounts.json` — konta agentów (opcjonalny; powstaje, gdy dodasz pierwsze konto w oknie „Konta”).
- `claude-limits.json`, `claude-limits.<id konta>.json` — ostatnie limity subskrypcji Claude z linii statusu.
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

## Konta i kontynuacja na innym koncie

Kilka subskrypcji (np. praca i prywatne) albo limit, który właśnie się skończył? **Konto** to
osobny folder logowania agenta: dla Claude `CLAUDE_CONFIG_DIR`, dla Codexa `CODEX_HOME`.
Aplikacja zna tylko ścieżkę folderu i ustawia zmienną dla procesu panelu. Tokenów nie czyta,
nie kopiuje ani nie zapisuje; logowanie robi sam agent.

- **Dodawanie:** przycisk `Konta` w nagłówku. Podajesz agenta, nazwę i folder (np. `~/.claude-praca`).
  `Zaloguj` otwiera panel agenta na tym koncie, a on sam pokazuje ekran logowania. Folder tworzy agent.
  „Domyślne konto” to zwykły folder agenta (`~/.claude`, `~/.codex`), bez zmiennej; ● oznacza
  konto, które dostają nowe panele.
- **Wybór w panelu:** „Nowy panel” ma rząd „Konto” przy Claude i Codexie. Konto zapisuje się w panelu
  na stałe, więc zmiana domyślnego nie przesuwa działających paneli (sesje leżą w folderze konta).
  W nagłówku panelu jest plakietka z nazwą konta.
- **Limity:** każde konto Claude ma własny plik limitów i własny blok w „Pulpicie”.
- **Przy limicie:** gdy okno limitu konta dojdzie do 100 %, panel pokazuje pasek z resetem i
  opcjami „Kontynuuj gdzie indziej” albo „Poczekam”. To samo jest zawsze pod ikoną ⇄ w nagłówku
  panelu. Kontynuacja otwiera **nowy** panel (inne konto tego samego agenta albo inny agent, np. Codex)
  i wkleja do niego streszczenie rozmowy, bez Entera. Wznowienie tej samej sesji na innym koncie
  nie jest możliwe, bo sesje są per konto.

Ograniczenia: wyciąg rozmowy umie czytać tylko Claude i pi, więc „Kontynuuj” nie ma w panelach
Codexa; limity wykrywamy tylko dla Claude; streszczenie robi Haiku na domyślnym koncie Claude
(gdy jest wyczerpane, wkleja się skrócony wyciąg).

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
- `src/backend.ts` — kontrakt wspólny: `backend-electron.ts` (prawdziwe komendy) i `backend-mock.ts`
  (podgląd). Komponenty nie wołają IPC bezpośrednio.
- `src/Terminal.tsx` — xterm + PTY; proces żyje dokładnie tak długo jak komponent,
  klucz Reacta to `${pane.id}:${pane.run}`.
- `electron/src/pty.ts` — `spawn`/`write`/`resize`/`kill`, grupa procesów = pid, więc
  zabijanie sprząta całe drzewo dziecka (SIGHUP, po 1,5 s SIGKILL). Przy wyjściu aplikacji
  `killAll` domyka wszystko.

Plan etapów: `docs/plan-m1.md`, bieżący stan: `HANDOFF.md`.
