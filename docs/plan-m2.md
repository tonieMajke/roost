# Plan M2 – wygląd „D” i pulpit

M1 działa i jest sprawdzone w oknie (2026-09-30). M2 daje aplikacji wygląd „D · Kokpit +
Odważny” z ustawieniami wyglądu i dokłada pulpit po prawej: limity Claude (`/usage`),
kontekst agentów, zdarzenia na żywo.

## Kierunek

**Wzór: `docs/design/wzor-d.html`** (plik atrapy; plansza na żywo:
https://claude.ai/artifact/HjMw3dnoUiR8UL47cLkvYj, artboard „D”). Ze wzoru bierzesz
**CSS dosłownie**: tokeny, klasy, klatki animacji, rozmiary. Nie wymyślaj własnych
kolorów ani odstępów. Znaczniki wzoru (`<sc-for>`, `{{...}}`, `DCLogic`) to format
atrapy – przepisujesz je na React, nie kopiujesz.

Najważniejsze decyzje:
- ciemny motyw (jasny poza M2), tło `#0b0c0f`, siatka w tle, akcent do wyboru;
- fonty: Geist (UI), Geist Mono (etykiety, liczby, terminal zostaje JetBrains Mono),
  Bricolage Grotesque (duże nazwy: projekt, okna, pulpit). **Z paczek fontsource**, nie
  z Google Fonts – aplikacja ma działać bez sieci;
- kolor agenta (`--ag`) widać w nagłówku, poświacie, szynie, pulpicie;
- animacje tylko `transform` i `opacity` (+ jednorazowa fala `box-shadow` przy końcu pracy).
  Powód: WebKitGTK rysuje programowo (`LIBGL_ALWAYS_SOFTWARE`). Nic nie animuje się stale
  poza poświatą/skanem pracującego panelu, a poświata zmienia tylko `opacity` gotowej warstwy.

Ustawienia wyglądu (okno „Wygląd”, zapis w `workspace.json`, pole `ui`):

| Klucz | Wartości (pierwsza = domyślna) | Klasa na `.app` |
|---|---|---|
| `accent` | `orange`, `acid`, `violet`, `mint` | `acc-<wartość>` |
| `head` | `fill`, `line` | `fh-<wartość>` |
| `work` | `glow`, `scan` | `work-<wartość>` |
| `edge` | `sharp`, `soft` | `edge-<wartość>` |
| `title` | `big`, `compact` | `title-<wartość>` |
| `grid` | `on`, `off` | `bg-grid` gdy `on` |
| `motion` | `full`, `lite` | `motion-<wartość>` |
| `dock` | `true`, `false` | – (pulpit widoczny) |

Kolory agentów: pole `color` w `agents.json` (opcjonalne, `#rrggbb`); bez niego
domyślne ze wzoru: claude `#ff7a3d`, pi `#a78bfa`, codex `#3dffa2`, reszta `#8fd3ff`.

## Kto robi

Etapy **L** robi lokalny model, etapy **C** – Claude. Po każdym etapie L z interfejsem
Claude przegląda kod, a użytkownik wysyła zrzut z okna `pnpm desktop` (podgląd
w przeglądarce rysuje inaczej niż WebKitGTK). Zasady z `AGENTS.md` bez zmian.

## Postęp

- [x] Etap 1 (L) – tokeny, fonty, model ustawień `ui`
- [x] Etap 2 (L) – ikony
- [x] Etap 3 (L) – szyna i nagłówek obszaru według wzoru
- [x] Etap 4 (L) – panel i siatka według wzoru
- [x] Etap 5 (L) – okna: „Wygląd”, „Nowy panel”, „Presety”, komunikaty
- [ ] Etap 6 (C) – ruch: przesuwanie paneli, maksymalizacja, przełączanie projektów
- [ ] Etap 7 (L) – dławienie zapisu do terminala
- [ ] Etap 8 (L) – pulpit i kontekst agentów
- [ ] Etap 9 (L) – „Na żywo”
- [ ] Etap 10 (C) – limity Claude (`/usage`)
- [ ] Etap 11 (C + użytkownik) – szlif na zrzutach z okna

---

## Etap 1 (L) – tokeny, fonty, model ustawień `ui`

Zależności: `pnpm add @fontsource-variable/geist@^5.3.0 @fontsource-variable/geist-mono@^5.3.0 @fontsource-variable/bricolage-grotesque@^5.3.0`.
Import w `src/main.tsx` obok JetBrains Mono.

- `src/styles.css`: `:root`/`.app` dostaje tokeny ze wzoru (blok `.stage{...}` w `wzor-d.html`,
  bez `width`/`height`) i klasy ustawień (`acc-*`, `edge-soft`, `title-compact`, `bg-grid`,
  `fh-*`, `work-scan`, `motion-lite`). Każdy kolor w pliku przez token: po etapie
  `grep -nE '#[0-9a-fA-F]{3,8}' src/styles.css` pokazuje tylko definicje tokenów
  i klasy `acc-*`/`ag-*`.
- `src/ui.ts` (czyste): typ `Ui`, `DEFAULT_UI`, `parseUi(raw) -> { ui, errors }` (brak pola
  = domyślne, zła wartość = domyślna + błąd), `uiClasses(ui) -> string`. Testy vitest.
- `workspace.ts`: pole `ui` w `Workspace`, akcja `setUi { patch: Partial<Ui> }`,
  `parseWorkspace` używa `parseUi`. Testy: stary plik bez `ui` wczytuje się bez błędów.
- `agents.ts`: opcjonalne `color` (`#rrggbb`, inaczej błąd i pomijamy pole) + `agentColor(agent)`
  z domyślnymi kolorami z tabeli wyżej. Testy.
- `App.tsx`: `className={"app " + uiClasses(ws.ui)}`; każdy panel i wiersz szyny dostaje
  `style={{ "--ag": agentColor(agent) }}`.
- Terminal: tło `#0d0e11` (`--term-bg`), tekst `#c6ced8`, kursor = kolor akcentu (zmiana
  akcentu podmienia `x.options.theme` bez restartu procesu).

Wygląd po etapie może być jeszcze „pół na pół” – ważne, że tokeny i ustawienia działają.
**Commit:** `M2 Etap 1: tokeny, fonty, ustawienia wyglądu`

## Etap 2 (L) – ikony

Zależność: `pnpm add lucide-react@^1.47.0`. Wspólny `src/IconButton.tsx`: 26×26 px,
ikona 15 px, `strokeWidth={1.75}`, `aria-label` i `title` ze skrótem („Zamknij panel
(Ctrl+Alt+W)”). Klasa `.icon` ze wzoru.

| Teraz | Ikona lucide |
|---|---|
| ✕ | `X` |
| ⟳ | `RotateCw` |
| ⤢ / przywróć | `Maximize2` / `Minimize2` |
| + nowa rozmowa | `MessageSquarePlus` |
| + projekt | `FolderPlus` |
| „+ Panel” | `Plus` + tekst |
| „Presety” | `LayoutGrid` + tekst |
| „Pulpit” (etap 8) | `Gauge` + tekst |
| „Wygląd” (etap 5) | `SlidersHorizontal` |
| zwiń szynę | `PanelLeft` |

„Na pewno?” zostaje tekstem.
**Commit:** `M2 Etap 2: ikony`

## Etap 3 (L) – szyna i nagłówek obszaru według wzoru

Przenieś ze wzoru: `.rail`, `.rail-head` (znak + „AGENTS”), `.rail-label`, `.proj*`,
`.pane-row*`, `.rail-foot`, `.area-head`, `.area-name` (Bricolage, 32 px / 16 px przy
`title-compact`), `.area-path`, `.area-count`, `.btn`, `.btn.primary`.

- Wiersz projektu: `<kbd>` z numerem (Ctrl+Alt+1…9), nazwa, pod nią ścieżka `~/…`,
  kropka: `has-work` (oddycha), `has-unread` (akcent), `ping` (jednorazowo, gdy panel
  schowanego projektu skończył pracę).
- Panele tylko pod aktywnym projektem (animacja `fold`), stan panelu tekstem po prawej.
- Zwijanie szyny: `PanelLeft` + Ctrl+Alt+B → szyna 56 px (tylko `<kbd>` i kropki), stan
  w `ui.rail` (`"open"|"closed"`, dopisz do tabeli w `ui.ts` z testami).
- Stopka: „Dodaj projekt”, „Wygląd” (otwiera okno z etapu 5; do tego czasu nieaktywny).
**Commit:** `M2 Etap 3: szyna i nagłówek`

## Etap 4 (L) – panel i siatka według wzoru

Przenieś: `.grids`, `.grid`, `.pane`, `.glow`, `.pane-head`, `.ag-badge`, `.pane-name`,
`.pane-state`, `.tools`, stany `st-working`/`st-done`/`st-unread`/`st-exited`, klasy
`fh-fill`/`fh-line`, `work-scan`, klatki `breatheGlow`, `wave`, `scan`, `paneIn`, `paneOut`.

- Stan panelu z etapu 9 M1 mapuje się na klasy: `working` → `st-working`, zdarzenie
  `finished` → `st-done` na 1,6 s (potem `st-unread` albo nic), `unread` → `st-unread`,
  `exited` → `st-exited`.
- Tekst stanu w nagłówku: „pracuje”, „skończył”, „nowe wyjście”, „czeka”, „kod N”.
- Narzędzia w nagłówku przygaszone (`opacity .3`), pełne na panelu z fokusem i po najechaniu.
- Miejsce na miernik kontekstu (`.ctx`) w nagłówku – pusty do etapu 8.
- Zamknięcie panelu: klasa `is-closing` (`paneOut` 190 ms), dopiero potem `close` w reduktorze.
- Proces zakończony: pod terminalem pasek „Proces zakończony (kod N) · Uruchom ponownie
  (Ctrl+Alt+R)” zamiast samej szarej linii.
**Commit:** `M2 Etap 4: panel i siatka`

## Etap 5 (L) – okna i komunikaty

- Wspólny `src/Dialog.tsx` (tło `.backdrop`, karta `.dialog`, `pop`, Esc/klik w tło =
  anuluj i oddanie fokusu jak w `NewPaneDialog`). „Nowy panel” i „Presety” na nim.
  Kafelki agentów `.tile` z opóźnieniem `80 + 55·i` ms.
- Okno „Wygląd” (`.settings` ze wzoru, otwierane ze stopki szyny): wiersze z tabeli
  ustawień, akcent jako kółka kolorów, reszta jako przyciski segmentowe; zmiana
  = `setUi` od razu (widać na żywo), zapis przez zwykły zapis `workspace.json`.
- Komunikaty (`notice`) jako `.toast` w prawym dolnym rogu, znikają po 4 s; błędy
  konfiguracji zostają do zamknięcia (✕).
- Przycisk-podpowiedzi klawiszy jako `<kbd>`.
**Commit:** `M2 Etap 5: okna i komunikaty`

## Etap 6 (C) – ruch

Claude: przesuwanie paneli po dodaniu/zamknięciu (FLIP przez `element.animate`), maksymalizacja
z miejsca panelu (`transform-origin` z pozycji w siatce), wjazd siatki przy przełączeniu
projektu (`slideNext`/`slidePrev`, panele kolejno), `motion-lite` i `prefers-reduced-motion`
wyłączają ruch dekoracyjny. Sprawdzić, że `fit()` terminala nie odpala się w trakcie animacji
(transform nie zmienia rozmiaru, ale maksymalizacja tak).

## Etap 7 (L) – dławienie zapisu do terminala

Pomiar z M1: 16 × 20 MB naraz zacina UI. Cel: klik w inny panel reaguje < 200 ms w tym teście.

- `src/write-queue.ts` (czyste, testy z fałszywym zegarem): kolejka kawałków na panel,
  zapis paczkami do 64 KB, następna paczka w callbacku `x.write(data, cb)`.
- Panel w schowanej siatce (`clientWidth === 0`) zapisuje rzadziej (co 250 ms), nic nie gubi.
- Aktywność (M1 etap 9) liczy wyjście w chwili przyjścia z PTY, nie zapisu.
- Pomiar szczytowej długości kolejki; > 50 MB = zapisz w HANDOFF, osobny etap doda
  wstrzymywanie czytania PTY w Rust.
- Ręcznie: powtórzony test 16 × 20 MB w oknie, wynik w HANDOFF.
**Commit:** `M2 Etap 7: dławienie zapisu do terminala`

## Etap 8 (L) – pulpit i kontekst agentów

Pulpit (`.dock` ze wzoru, 300 px po prawej, przycisk „Pulpit” w nagłówku + Ctrl+Alt+D,
stan w `ui.dock`). Trzy sekcje: „Limity Claude” (pusta do etapu 10: napis „wkrótce”),
„Kontekst”, „Na żywo” (etap 9).

Skąd liczby (tylko **odczyt**, nic nie zapisujemy w katalogach agentów):
- claude: `~/.claude/projects/*/<sessionId>.jsonl`; ostatnia linia z `message.usage`;
  kontekst = `input_tokens + cache_read_input_tokens + cache_creation_input_tokens`.
- pi: pliki `~/.pi/agent/sessions/**.jsonl` – **najpierw ustal**, jak nazwa pliku łączy się
  z `--session-id` (ls nazw, bez czytania treści cudzych sesji; w razie wątpliwości stop
  i pytanie). Ostatnia linia z `message.usage`; kontekst = `input + cacheRead + cacheWrite`.
- Limit okna: pole `context` w `agents.json` (liczba tokenów); bez niego claude 200 000,
  pi 128 000, inni – brak miernika.

Rust: komenda `session_context(kind, session_id) -> Option<{ tokens, model }>`; czyta tylko
ostatnie 256 KB pliku (seek od końca). Testy na plikach-fixture w katalogu tymczasowym –
**testy nie czytają prawdziwego `~/.claude` ani `~/.pi`**.
TS: odświeżanie co 5 s i zaraz po `finished`, tylko dla paneli z `session`. Miernik w nagłówku
panelu (`.ctx`, ≥ 80% = akcent) i lista w pulpicie (`.ctx-row`).
**Commit:** `M2 Etap 8: pulpit i kontekst agentów`

## Etap 9 (L) – „Na żywo”

Lista ostatnich 30 zdarzeń ze wszystkich projektów (`.feed-item`, nowe wjeżdżają `feedIn`):
- z aplikacji: panel uruchomiony, skończył pracę, proces zakończony (kod N);
- z pliku sesji (ten sam odczyt co w etapie 8): ostatnie użyte narzędzie – claude:
  `tool_use.name` + `input.file_path` albo pierwsze 60 znaków `input.command`; pi: ustal
  format na fixture.
Czas względny („teraz”, „40 s temu”, „3 min temu”) – czysta funkcja z testami. Klik
w zdarzenie = fokus panelu (i przełączenie projektu). Stan ulotny, nie trafia na dysk.
**Commit:** `M2 Etap 9: na żywo`

## Etap 10 (C) – limity Claude (`/usage`)

Claude najpierw sprawdza źródło: (1) czy dane dla linii statusu Claude Code 2.1.x mają
limity; (2) jeśli nie – nieoficjalny endpoint, którego używa `/usage`, z tokenem
z `~/.claude/.credentials.json`. Wariant 2 tylko po włączeniu przez użytkownika
(ustawienie „Pokaż limity Claude”, domyślnie wyłączone), token czytany w Rust, wysyłany
wyłącznie do api.anthropic.com, nigdy do UI ani logów. Odświeżanie co 5 min + przycisk.

## Etap 11 (C + użytkownik) – szlif na zrzutach z okna

Czarny pasek pod xtermem, pasek przewijania w kolorach motywu, rozmiar czcionki terminali
Ctrl+Alt+= / Ctrl+Alt+- / Ctrl+Alt+0 (`ui.fontSize`, 10–20), puste stany, drobne
poprawki z listy użytkownika.

---

## Poza M2 (nie rób)

Jasny motyw, zakładka Chat (M3), własne proporcje i przeciąganie paneli, pozostałe
pozycje z „Później” w `PLAN.md`.
