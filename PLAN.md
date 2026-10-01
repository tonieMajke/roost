# Agents workspace – plan

Osobiste, lokalne środowisko do uruchamiania wielu agentów CLI obok siebie, w stylu
trybu Code z BridgeMind One (bridgemind.ai), ale bez konta, chmury i subskrypcji.

## Decyzje (2026-09-30)

- **Tauri 2 + React + TypeScript**, pnpm – ten sam stos co Pi Code (`~/Documents/Pi/pi-gui`).
- **Agenci na start: `pi` i `claude`.** Hermes pominięty, codex/omp później (to tylko wpis w configu).
- **Zakres: wersja podstawowa** (M0 + M1 poniżej). Reszta to lista na później.
- **Tylko Linux** (CachyOS, Wayland, NVIDIA).
- Repozytorium git w tym folderze.

## Co robi BridgeMind One (strona i dokumentacja obejrzane 2026-09-30)

Dawny BridgeSpace nazywa się teraz **BridgeMind One – „The Agent Super App”**. Pro 50 $/mies.
(40 $ rocznie), jeden plan, własne subskrypcje/API do modeli. Dokumentacja: macOS 26 – tak,
Windows – w budowie, **Linux – „not supported”** (choć na stronie jest AppImage).

Trzy tryby przełączane w pasku tytułu:
- **Code** (to budujemy): praca według **folderu projektu**. Po lewej szyna projektów,
  pod każdym jego panele (agent + kropka stanu). W środku panele: terminal, „wątek”
  (agent jako rozmowa – adaptery tylko dla Claude Code i Codex), pliki, przeglądarka,
  symulator iOS. Panele dzielone, w kartach, przeciągane, „snap” do układów, „Tidy”.
  Nagłówek panelu: ikona agenta, folder, `…`, maksymalizuj, `+`, ✕. Po prawej dokowany
  pasek z przeglądarką (localhost) i „Dashboard” wszystkich agentów.
  Presety sesji: Solo, Pair, Workbench, Swarm (z rolami, podgląd przed startem).
  Wykrywa agentów z PATH powłoki logowania. Pasek poleceń wysyła prompt do aktywnej sesji.
  Przeciągnięcie pliku na terminal wstawia ścieżkę w cudzysłowie.
- **Agent**: nazwani „współpracownicy” z briefem, pamięcią, skillami, na harmonogramie (routines).
- **Thread/Chat**: rozmowa bez projektu.
- Poza tym: przełączanie kont Claude/Codex przy limicie, dyktowanie (BridgeVoice,
  Parakeet/Whisper lokalnie), kredyty na funkcje w chmurze.

Co z tego bierzemy do M1: szynę projektów z panelami i stanem, siatkę terminali, presety.
Później: pasek poleceń, przeciąganie pliku, przeglądarka, wątki, harmonogram.
Pomijamy: konta, kredyty, logowanie, symulator.

## Architektura wersji podstawowej

Każdy agent = proces w pseudo-terminalu po stronie Rusta, wyświetlany w xterm.js.
Działa z każdym CLI; nowy agent to wpis w konfiguracji.

```
src-tauri/   Rust: portable-pty, rejestr sesji PTY, komendy pty_spawn/write/resize/kill,
             zdarzenia pty:data:<id> i pty:exit:<id>, sprzątanie grup procesów przy wyjściu
src/         React: siatka paneli, panel = xterm.js + nagłówek (agent, katalog, stan procesu)
```

**Wznawianie rozmów:** oba CLI mają `--session-id <id>`. Panel dostaje UUID przy
utworzeniu, zapisany w układzie. Po restarcie aplikacji panel startuje z tym samym id:
- claude: `claude --session-id <uuid>`, a jeśli sesja już istnieje, `claude --resume <uuid>`
- pi: `pi --session-id <uuid>` (tworzy, gdy nie ma, inaczej wznawia)

**Konfiguracja agentów** (plik JSON w katalogu konfiguracyjnym aplikacji, edytowalny ręcznie):

```json
{ "agents": [
  { "id": "claude", "name": "Claude", "command": "claude", "args": [] },
  { "id": "pi",     "name": "pi",     "command": "pi",     "args": [] },
  { "id": "shell",  "name": "Terminal", "command": "$SHELL", "args": [] }
]}
```

## Lekcje przeniesione z Pi Code

- WebKitGTK na NVIDIA + Wayland daje czarne okno: `GDK_BACKEND=x11`,
  `WEBKIT_DISABLE_COMPOSITING_MODE=1`, `WEBKIT_DISABLE_DMABUF_RENDERER=1`,
  `LIBGL_ALWAYS_SOFTWARE=1` ustawiane w Rust przed startem (wartości usera wygrywają).
  Te zmienne **usuwać ze środowiska agentów**, żeby nie dziedziczyły ich programy użytkownika.
- `LIBGL_ALWAYS_SOFTWARE` = WebGL w programie → **renderer xterm.js DOM/canvas, nie WebGL**.
  Do zmierzenia w M0 przy kilku panelach naraz.
- Bez `capabilities` w Tauri 2 `listen()` jest cicho odrzucany.
- Każdy agent we własnej grupie procesów; przy wyjściu z aplikacji SIGHUP/SIGTERM do grupy,
  po chwili SIGKILL. Nigdy `pkill -f` – zabijać po PID.
- Pluginy Tauri przypinać do minor zgodnej z `@tauri-apps/api` (inaczej `tauri build` odmawia).
- Uruchamianie w dev: `GDK_BACKEND=x11 ... cargo build` jak `pnpm desktop` w Pi Code.

## Kamienie milowe

**M0 – jeden terminal (spike)**
- Scaffold Tauri 2 + React + Vite + xterm.js, portable-pty w Rust.
- Jeden panel uruchamiający `claude` albo `pi` w wybranym katalogu.
- Sprawdzić: kolory i TUI (claude/pi rysują pełny ekran), zmiana rozmiaru, wklejanie,
  polskie znaki, skróty (Ctrl+C, Shift+Tab, Esc), szybkość przewijania, zamknięcie aplikacji
  nie zostawia procesów.

**M1 – wersja podstawowa (zrobione 2026-09-30, czeka na sprawdzenie użytkownika — lista w `HANDOFF.md`)**
– szczegółowe etapy dla lokalnego agenta: `docs/plan-m1.md`
- Szyna projektów (foldery) po lewej, pod każdym jego panele ze stanem; przełączanie
  projektu nie zatrzymuje agentów.
- Siatka 1–16 paneli na projekt (automatyczny układ kolumn/wierszy).
- „Nowy panel” → wybór agenta (katalog = folder projektu).
- Nagłówek panelu: agent, stan (działa / zakończony z kodem), restart, zamknij,
  maksymalizuj (panel na cały ekran i z powrotem).
- Presety: np. „2× claude + 2× pi” w aktywnym projekcie, zapis własnych.
- Zapis układu i UUID sesji; po restarcie aplikacji panele wracają z tymi samymi rozmowami.
- Fokus klawiaturą (Ctrl+Alt+strzałki), wskaźnik „coś się zmieniło” na panelu bez fokusu
  (nowe dane na PTY), powiadomienie systemowe, gdy panel bez fokusu przestaje wypisywać
  (heurystyka „agent skończył/czeka”).

**M2 – wygląd „D” i pulpit (limity, kontekst, na żywo)** – etapy: `docs/plan-m2.md`, wzór: `docs/design/wzor-d.html`.

**M3 – zakładka Czat** (dopisane 2026-09-30, przepisane 2026-10-01) – etapy: `docs/plan-m3.md`
- Przełącznik Code | Czat w pasku tytułu. Czat wyglądem jak claude.ai: lista rozmów, wątek, pole wpisywania.
- Wybór modelu: Claude i ChatGPT z subskrypcji (przez `claude -p` / `codex exec`), API z kluczem,
  modele lokalne (llama-server, FreeToken). Zmiana modelu w środku rozmowy.
- „Szukaj w sieci”: odpowiedź ze źródłami i przypisami.
- Własny czat w procesie głównym Electrona (bez sidecara); pojedyncze kawałki UI z Pi Code.
  Poprzedni szkic („UI Pi Code przez sidecar”) odrzucony – powstał dla wersji Tauri.

**M4 – przeciąganie paneli i przekazanie kontekstu** (dopisane 2026-09-30, niezależne od M3)
– etapy: `docs/plan-m4.md`
- Nagłówek panelu chwycony myszą zwija się w kulkę, upuszczona na inny panel zamienia je
  miejscami (FLIP). Skrót Ctrl+Alt+Shift+strzałki robi to samo z klawiatury.
- Shift przy upuszczeniu: wyciąg z rozmowy źródła (prompty, odpowiedzi, pliki, polecenia)
  wklejany do celu bez Entera.

## Później (poza wersją podstawową)

- Status agentów przez tryby maszynowe (`pi --mode rpc`, `claude -p --output-format stream-json`,
  hooki Claude Code), liczniki tokenów.
- Jeden prompt do wielu paneli naraz.
- Kanban + git worktree per agent/zadanie + widok diffu.
- Wbudowana przeglądarka i edytor.
- Agent-koordynator przez własny serwer MCP.
- codex, omp, hermes.

### Pomysły z BridgeMind One (changelog v0.1.69 i strona, obejrzane 2026-10-01)

Na początek, małe:
- **Klikalne ścieżki w terminalu.** [x] Zrobione (`src/term-links.ts`, `electron/src/open-path.ts`; do sprawdzenia w oknie). Ctrl-klik na `src/foo.ts:41` otwiera plik w linii
  (xterm.js `registerLinkProvider`). Na start `$EDITOR` albo `xdg-open`, bez wbudowanego edytora.
- **Szukanie w terminalu.** Ctrl+F, Ctrl+G / Ctrl+Shift+G między trafieniami (xterm-addon-search).
- **Dashboard agentów z wyszukiwaniem i „Close idle”.** Szukanie po tytule, agencie, projekcie,
  branchu, ostatniej wiadomości (każde słowo musi pasować, Esc czyści). „Close idle” zamyka tylko
  bezczynne, zostawia działające i czekające. Baza: `activity.ts`.
- **Przeciągnięcie pliku na panel wpisuje jego ścieżkę w prompcie** (w cudzysłowie).

Większe:
- **Przełączanie kont przy limicie.** Konto = osobny folder logowania agenta (Claude:
  zapewne `CLAUDE_CONFIG_DIR`), domyślne + nadpisanie per projekt/agent. Przy limicie wybór:
  poczekać na reset albo kontynuować na innym koncie ze streszczeniem. Baza: `limits.ts`,
  `handoff.ts`; brakuje zmiennej środowiskowej per panel. (Wcześniej w „pomijamy”.)
- **Panel plików z gitem.** Drzewo ze statusem, stage/unstage/discard/commit z diffem, chip
  brancha z ahead/behind i pull/push. Łączy się z pozycją „Kanban + worktree + diff”.
- **Wybieranie elementu w przeglądarce** → styl i kontekst strony do schowka dla agenta
  (po dodaniu wbudowanej przeglądarki).
- **Dyktowanie trzymanym klawiszem** (lokalnie Parakeet/Whisper, „Enhance Prompt”). Pułapki
  z ich changelogu: skrót globalny na Wayland wymaga xdg-desktop-portal ≥ 1.21, wklejanie do
  XWayland działa inaczej.
- **Scratchpad** – notatki w projekcie z prostym formatowaniem.
- **Kalendarz i mail dla botów** (dopisane 2026-10-01, szkic: `docs/plan-kalendarz-mail.md`).
  Wspólny kalendarz aplikacji (lokalny ICS + subskrypcje, ewentualnie CalDAV) i poczta przez
  IMAP/SMTP jako grupy narzędzi bota, przypomnienia z harmonogramu. Przed startem: pytania
  z „Do ustalenia” w tym pliku.

Lekcje do przeniesienia:
- Pauzować renderowanie (animacje, zegary) gdy panel/okno jest nieaktywne – dotyczy ryzyka
  xterm.js przy 16 panelach.
- Test startu zainstalowanego AppImage po `tauri build` przed wydaniem (BridgeMind wycofał
  Windows 0.2.0 po crashu przy starcie).
- Odzyskiwanie sesji: niepotwierdzone przywrócenie agenta zostaje dostępne, gdy agent wyjdzie;
  przy pełnym dysku zachować zapisany stan zamiast go tracić.
- Aktualizacje pokazywać w pasku tytułu, nie wyskakującym oknem.

Sugerowana kolejność: klikalne ścieżki → szukanie → Dashboard/„Close idle” → konta.

## Ryzyka

| Ryzyko | Co robimy |
|---|---|
| xterm.js wolny bez WebGL przy 16 panelach | pomiar w M0; nie renderować paneli poza ekranem, limit scrollbacku |
| Skróty zjadane przez WebView (Ctrl+W, Ctrl+R, F5) | przechwycić w panelu, przepuścić do PTY |
| Osierocone procesy agentów | grupy procesów + sprzątanie przy wyjściu i przy zamknięciu panelu |
| Wznowienie sesji claude, gdy id już istnieje | sprawdzić zachowanie `--session-id` vs `--resume` w M1 |
