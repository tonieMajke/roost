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

**M3 – zakładka Chat z Pi Code** (dopisane 2026-09-30)

Obok trybu „Code” (siatka terminali) druga zakładka „Chat”: rozmowa z pi w interfejsie
Pi Code (`~/Documents/Pi/pi-gui`), a nie w TUI. Jak BridgeMind „Thread/Chat”.

Co wiemy o Pi Code: ten sam stos (Tauri 2 + React 19), ~12,6 tys. linii TS w UI,
czat działa przez sidecar w Node (`sidecar/`, SDK `@earendil-works/pi-coding-agent`),
który rozmawia z UI liniami JSON po stdio (`shared/protocol.ts`). Rust w Pi Code tylko
uruchamia sidecar i przekazuje linie (`pi_send`, zdarzenia), plus schowek z obrazkiem.

Warianty, od najtańszego:
1. **„Otwórz w Pi Code”** – przycisk na projekcie uruchamia osobne okno Pi Code w folderze
   projektu (`PI_GUI_CWD`). Kilkadziesiąt linii, ale to osobne okno, nie zakładka.
2. **Zakładka Chat z kodem Pi Code** (zalecane) – Agents workspace importuje komponenty
   czatu i `shared/` z repozytorium Pi Code (alias ścieżki / pakiet w workspace pnpm),
   a Rust uruchamia ten sam sidecar i przekazuje linie jak w Pi Code. Jedno źródło kodu:
   poprawki w Pi Code od razu są w zakładce. Do zrobienia: wyrównać wersje Tauri (Pi Code
   2.11, tu 2.12), odizolować style Pi Code, żeby nie psuły siatki, przenieść komendy Rusta
   (`pi_send`, schowek), jeden sidecar na projekt albo jeden wspólny.
3. **Kopia UI Pi Code do tego repo** – najprostsze na start, ale dwie wersje zaczną się
   rozjeżdżać. Odradzane.

Przed rozpisaniem etapów: sprawdzić, jak mocno UI Pi Code zakłada, że ma całe okno
(globalny stan, style, skróty), i czy sidecar obsługuje kilka sesji naraz.

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

## Ryzyka

| Ryzyko | Co robimy |
|---|---|
| xterm.js wolny bez WebGL przy 16 panelach | pomiar w M0; nie renderować paneli poza ekranem, limit scrollbacku |
| Skróty zjadane przez WebView (Ctrl+W, Ctrl+R, F5) | przechwycić w panelu, przepuścić do PTY |
| Osierocone procesy agentów | grupy procesów + sprzątanie przy wyjściu i przy zamknięciu panelu |
| Wznowienie sesji claude, gdy id już istnieje | sprawdzić zachowanie `--session-id` vs `--resume` w M1 |
