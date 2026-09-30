# HANDOFF

Najnowszy wpis na górze. Każdy etap z `docs/plan-m1.md` dopisuje tu 3–8 linii.

## Do sprawdzenia przez użytkownika (w oknie Tauri, po etapie 11)

- [ ] TUI claude i pi: kolory, ramki, polskie znaki (ąęśćżźół), Shift+Tab, Esc, Ctrl+C
- [ ] zmiana rozmiaru okna i maksymalizacja przerysowuje terminale poprawnie
- [ ] Ctrl+Shift+C/V, Ctrl+V z obrazkiem w claude
- [ ] 16 paneli z `$SHELL`, w każdym `yes | head -c 20M` — okno reaguje, czas zapisany
- [ ] zamknięcie aplikacji: `pgrep -a claude; pgrep -a pi` nie pokazują procesów z paneli
- [ ] restart aplikacji wznawia rozmowy (claude i pi)
- [ ] przełączanie projektów nie przerywa pracy agentów w schowanych siatkach
- [ ] powiadomienie po zakończeniu pracy agenta w panelu bez fokusu
- [ ] czarny pasek pod terminalem xterm (zauważony w podglądzie od etapu 5 — w oknie go nie ma?)
- [ ] presety: wybór z menu dopisuje panele, „Zapisz obecny układ…” wraca po restarcie aplikacji

## M2 Etap 6 – 2026-09-30 (Claude)

- `src/motion.ts` (czyste) + 12 testów: `flipTransform` (próg 1 px / 1%), `maxOrigin` (środek komórki w `gridShape`), `enterClass` (dalej na szynie = `enter-next`), `enterDelayMs` (60 ms na panel przez 700 ms), `motionAllowed`; stałe `FLIP_MS` 340, `FLIP_EASE` ze wzoru.
- `Grid.tsx`: FLIP komórek (`element.animate`, `transform-origin: 0 0`) po dodaniu/zamknięciu/przywróceniu, tylko przy zmianie listy paneli lub maksymalizacji w tym samym projekcie. Pudełka z `offset*` (bez transformacji), odświeżane `ResizeObserver`em siatki (okno, szyna) – FLIP nie startuje ze starych pudełek.
- Maksymalizacja: `.pane-cell.is-maxed` = `grow` 0,44 s z `transform-origin` = miejsce panelu w siatce; przywrócenie = FLIP z pełnego obszaru do komórki. Przełączenie projektu: `enter-next`/`enter-prev` na siatce (`slideNext`/`slidePrev`), panele kolejno przez `--enter-delay` → `animation-delay` `.pane`.
- `motion-lite` (prop `motion` z `ws.ui`) i `prefers-reduced-motion` wyłączają FLIP (w JS), `grow` i wjazd (w CSS).
- `fit()`: transformacje nie ruszają `ResizeObserver` ani wymiaru z `getComputedStyle`; xterm 6 mierzy komórkę przez `offsetWidth`/OffscreenCanvas – skala w trakcie animacji go nie myli. Maksymalizacja zmienia rozmiar raz → jeden `fit()` na starcie `grow`.
- Sprawdzenia: typecheck czysty, vitest 129/129, cargo test 11/11, cargo build 0 ostrzeżeń. Podgląd w headless Firefoksie przez WebDriver BiDi (skrypt w scratchpadzie, świeży profil): `getAnimations()` pokazał FLIP po zamknięciu i dodaniu, `grow` z `75% 50%`, FLIP przy przywróceniu, `slideNext`/`slidePrev` z opóźnieniem 60 ms drugiego panelu, klasa wjazdu zdjęta po 700 ms, przy `motion-lite` zero animacji; zrzuty w połowie `grow` i wjazdu.
- Użytkownik w oknie Tauri: ruch „może nie 60 fps, ale jest ok” (WebKitGTK, rysowanie programowe). Przy 16 panelach niesprawdzone.

## M2 Etap 5 – 2026-09-30 (lokalny model, dokończył Claude)

- Wspólny `src/Dialog.tsx`: `.overlay` > `.backdrop` + `.dialog` (`pop`), Esc/klik w tło = anuluj i oddanie fokusu; `scrim={false}` = przezroczyste tło (popover). „Nowy panel” i „Presety” na nim; kafelki `.tile` z `tileDelayMs(i)` = 80 + 55·i ms (`new-pane.ts`, test).
- Okno „Wygląd” (`AppearanceDialog.tsx`, `.settings` ze wzoru) ze stopki szyny: wiersze z `UI_ROWS` w `ui.ts` (akcent = kółka `ACCENT_HEX`, reszta = `.seg`; `dock` pominięty do etapu 8), klik = `setUi` przez `uiPatch`, zapis ze zwykłym zapisem `workspace.json`. Przy niskim oknie karta się przewija (`max-height`).
- Komunikaty: `.toast` w prawym dolnym rogu, znikają po `TOAST_MS` = 4 s (`toast.ts`); błędy konfiguracji zostają w `.config-errors` z ✕. Podpowiedzi klawiszy w stopkach okien jako `<kbd>`.
- Claude po przejęciu: `toastText` faktycznie użyty w `applyPreset`, Enter w polu nazwy presetu respektuje `canSave`, wcięcia w `App.tsx`. Lokalny model zawiesił się na temp stronie seed (obserwator `MutationObserver` budził sam siebie → headless Firefox nie kończył ładowania); strona poprawiona na czas zrzutów i usunięta.
- Sprawdzenia: typecheck czysty, vitest 117/117, cargo test 11/11, cargo build 0 ostrzeżeń. Zrzuty headless Firefox (animacje wyłączone na czas zrzutu): „Nowy panel” (3 kafelki), „Presety” (wbudowane, własne z ✕, zapis), „Wygląd” (8 wierszy), toast „Brak agentów w konfiguracji: codex”.
- Niesprawdzone: animacje `pop`/`tileIn`/`toastIn` na żywo, znikanie toastu po 4 s, okno Tauri. W podglądzie toast nachodzi na napis „podgląd – bez prawdziwych procesów” (tylko podgląd).

## M2 Etap 4 – 2026-09-30 (Claude)

- Panel według wzoru D: `.glow`, `.ag-badge` (pierwsza litera agenta), `.pane-name`/`.pane-state` (mono, wersaliki), `.tools` przygaszone do 0,3 (pełne przy fokusie, najechaniu i `:focus-within`), miejsce na `.ctx` (komentarz, etap 8).
- `paneStatus()` w `activity.ts` zastępuje `rowState`/`dotClass`/`dotTitle`: `st-working` > `st-done` > `st-unread` > `st-exited` > `st-idle`; ten sam stan na szynie i w nagłówku.
- `done` w `PaneState`: App ustawia go na zdarzenie `finished` i zdejmuje po `DONE_MS` = 1600 ms (fala `wave`). Timery App w jednym `later()`, czyszczone przy odmontowaniu.
- Zamykanie: `closing` w App → `is-closing` (`paneOut` 190 ms, `PANE_OUT_MS` w `Pane.tsx`), dopiero potem `forget` + `close`; drugi klik w trakcie ignorowany.
- Proces zakończony: pasek `.pane-exit` „Proces zakończony (kod N) · Uruchom ponownie Ctrl+Alt+R”; szara linia w xterm usunięta z `Terminal.tsx`.
- Siatka: `.project-grid` → `.grid`, odstępy `var(--gap)`, ścieżki `minmax(0, 1fr)`. Stare `.dot*` i `.pane-tools` usunięte.
- Sprawdzenia: typecheck czysty, vitest 109/109 (usunięte testy `dotClass`/`dotTitle`), `vite build` OK. Podgląd w headless Firefoksie: nagłówek, plakietki, `fh-fill` OK.
- Niesprawdzone: pasek `.pane-exit`, fala `st-done` i `paneOut` na żywo (headless robi zrzut przed wyjściem procesu z mocka). Headless Firefox czasem nie rysuje tekstu Geist Mono 10,5 px (`kbd`, `.pane-state`) – DOM jest poprawny, w Tauri sprawdzić.

## M2 Etap 3 – poprawki (Claude)

- `--accent-hover` przeniesiony z `:root` na `.app` (na `:root` zawsze dawał pomarańcz, niezależnie od `acc-*`).
- `.btn.primary:disabled`: przygaszony cały przycisk (wcześniej `--muted` na tle akcentu – nieczytelne).
- Zwinięta szyna: stopka w kolumnie (dwie ikony 26 px nie mieściły się w 44 px); `PanelLeft` ma etykietę „Rozwiń/Zwiń szynę”.

## M2 Etap 3 – 2026-09-30 (lokalny model)

- `Rail.tsx` przepisany na wzór D: `.rail-head` (marka „AGENTS" + `PanelLeft`), `.rail-label`, `.proj` / `.proj-row` (`<kbd>` z numerem, nazwa, ścieżka `~/…`, `.proj-dot`), `.proj-panes` tylko pod aktywnym projektem (animacja `fold`), `.rail-foot` (`FolderPlus` + `SlidersHorizontal` „Wygląd", nieaktywny do etapu 5).
- Stan wiersza panelu: `rowState()` w `src/activity.ts` (`st-working|st-unread|st-exited|st-idle` + tekst po prawej), kropka projektu: `projectState()` (`has-work` pulsujące, `has-unread` akcent) + jednorazowy `ping` (App: tick 1 Hz, projekt ≠ aktywny, `PING_MS` = 1000 ms).
- Zwijanie szyny: Ctrl+Alt+B (`keys.ts`: `toggleRail`) → `ui.rail` (`open|closed`, zapis w `workspace.json`, klasa `rail-closed`); CSS `.rail-closed .rail { width: 56px }` wygrywa z media 720 px, w 56 px zostają `<kbd>` i kropki.
- Nagłówek obszaru: `.area-head` 70 px, `.area-name` Bricolage 32 px (`--title-size`, 16 px w `title-compact`), `.area-path`, `.area-count`, przyciski `.btn` / `.btn.primary` (zamiast `.btn-ico`; `.btn-ico`, stare `.rail-*` i `.dot--hidden` usunięte). `.area-name` ma `flex: none` — ścieżka zwija się pierwsza (priorytet wzoru); przy 11–12 px użyty `--muted` zamiast `--faint` dla kontrastu.
- `prefers-reduced-motion` wyłącza `breathe` (kropki), `ping` i `fold` (razem z `.glow` z etapu 1); `motion-lite` obejmuje `.proj-panes` (lista z etapu 1).
- Sprawdzenia: typecheck czysty, vitest 111/111, cargo test 11/11, cargo build 0 ostrzeżeń, `ui_audit` @1000/390: 0 wysokich, 16 średnich (wszystkie to wartości dosłowne ze wzoru: tekst 10,5/11/11,5 px, odstępy 9/10/7/6/5/3 px), 2 niskie (4 fonty i 4 barwy = z planu). Podgląd @1000 i @460 px na seedowanym `workspace` (temp pliki usunięte): szyna otwarta i zwinięta.
- Niesprawdzone: okno Tauri; Ctrl+Alt+B i `ping` na żywo (sprawdzone logiką i testami `commandFor`, nie klikaniem).

## M2 Etap 2 – 2026-09-30 (Claude)

- `lucide-react@^1.48.0` (zgodne z `^1.47.0` z planu); `src/IconButton.tsx`: 26×26, ikona 15 px, `strokeWidth 1.75`, `aria-label`/`title` ze skrótem, klasa `.icon` ze wzoru.
- Panel: `MessageSquarePlus`, `RotateCw` (Ctrl+Alt+R), `Maximize2`/`Minimize2` (Ctrl+Alt+Enter), `X` (Ctrl+Alt+W); „Na pewno?” zostaje tekstem.
- Szyna: `FolderPlus` (Ctrl+Alt+P), `X` przy projekcie; górny pasek: `LayoutGrid` Presety, `Plus` Panel; pusty ekran: `FolderPlus` Projekt; komunikat i presety: `X`.
- „Pulpit”, „Wygląd”, zwijanie szyny – ikony dojdą w etapach 3, 5, 8 (tych przycisków jeszcze nie ma).
- Sprawdzenia: typecheck czysty, vitest 106/106, cargo test 11/11, cargo build OK; zrzut podglądu (Firefox headless) – ikony na miejscu.
- Niesprawdzone: okno Tauri.

## M2 Etap 1 – 2026-09-30 (lokalny model, dokończył Claude)

- Fonty Geist, Geist Mono, Bricolage Grotesque (`@fontsource-variable/*@^5.3.0`), import w `main.tsx`.
- `styles.css`: tokeny ze wzoru D w `:root`, klasy `acc-*`, `fh-*`, `work-scan`, `edge-soft`, `title-compact`, `bg-grid`, `motion-lite`; kolory tylko w tokenach i `.acc-*` (grep czysty).
- `src/ui.ts` (`Ui`, `DEFAULT_UI`, `parseUi`, `uiClasses`, `ACCENT_HEX`) + testy; `workspace.ts`: pole `ui`, akcja `setUi`, stary plik bez `ui` wczytuje się bez błędów.
- `agents.ts`: `color` (`#rrggbb`) + `agentColor()`; `--ag` na panelach i wierszach szyny; `.app` dostaje `uiClasses(ws.ui)`.
- Terminal: tło `#0d0e11`, tekst `#c6ced8`, kursor = akcent; zmiana akcentu podmienia `x.options.theme` bez restartu.
- Sprawdzenia: typecheck czysty, vitest 106/106, cargo test 11/11, cargo build OK.
- Niesprawdzone: wygląd w oknie Tauri (brak jeszcze okna „Wygląd” – ustawienia zmienia się w `workspace.json` do etapu 5).

## Pomiar obciążenia (lokalny model, podgląd) – 2026-09-30
- Rdzeń PTY (Rust): 16 procesów × 20 MB w 8,05 s.
- Podgląd, 16 xterm × 20 MB: przy realnym tempie wyjścia UI żyje (0 longtasków); przy
  jednoczesnym zrzucie wszystkiego naraz UI się zacina. Na później (M2): dławienie zapisu do
  xterm (callback `write`, paczki na klatkę), zwłaszcza w schowanych siatkach.
- Filtr raportów fokusu (DECSET 1004): w oknie nadal do potwierdzenia.

## M1 Etap 11 – 2026-09-30
Porządki: scrollback xtermu 5000 → 3000 (limit pamięci przy 16 panelach) + komentarz przy warunku
`el.clientWidth === 0` w `ResizeObserver`. `fit()` dla ukrytych paneli zmierzony w podglądzie (temp strona
seed, usunięta): panel w schowanej siatce startuje z 5 wierszami (fit słusznie nic nie robi na elemencie
0 px), a po przełączeniu projektu ma 32 wiersze i te same 761 px co panel widoczny — czyli observer
strzela po zdjęciu `display: none`; po maksymalizacji wymiary bez zmian (siatka 1×1 = ten sam obszar).
Do tego w `Terminal.tsx` leżała w drzewie niezacommitowana zmiana z poprzedniej sesji (odfiltrowanie raportów
fokusu DECSET 1004 w `onData`, żeby TUI odświeżane w panelu bez fokusu nie wyglądały jak praca agenta) —
wpisana tu razem z etapem 11, przeżyła typecheck i testy, w oknie niesprawdzona.
Nowy `README.md` (uruchomienie, `agents.json` z przykładem codexa, skróty, presety), lista wyżej do
sprawdzenia w oknie, `PLAN.md`: M1 oznaczone jako zrobione. Sprawdzania: typecheck czysto, vitest 93/93,
cargo test 11/11, cargo build 0 ostrzeżeń, `tauri` w `Cargo.lock` 2.12.0, `ui_audit` :5183 bez nowych flag
(0 wysokich / 6 średnich = te same co w etapach 8–10). Niesprawdzone: cała lista powyżej (okno Tauri);
BrowserOS w tej sesji niedostępny, więc klikanie po podglądzie zastąpione temp stronami seed ze skryptem.

## M1 Etap 10 – 2026-09-30
Presety: `src/presets.ts` = `BUILT_IN_PRESETS` (Claude + pi / 2× Claude + 2× pi / 4× Claude) i czysty
`planPreset(preset, knownIds, slots)` → `{agents, skipped, dropped}` (nieznani agenci nie jedzą miejsc) + 9 testów.
`reduce`: `savePreset {name}` (panele aktywnego projektu w ich kolejności, nazwa po `trim()`, ta sama nazwa
nadpisuje, pusty projekt / pusta nazwa = brak zmiany) i `deletePreset {name}` + 5 testów (własne w `workspace.presets`,
już parsowane w etapie 4). `src/PresetMenu.tsx` (nakładka jak „Nowy panel”, Esc zamyka): wbudowane, kreska,
własne z ✕, na końcu pole nazwy + „Zapisz obecny układ…” (wyłączony bez paneli); wbudowany o nazwie własnej
jest ukrywany (nie dublujemy wierszy). App: `applyPreset` dodaje panele na koniec aktywnego projektu (`add` w pętli,
sessionId jak przy „+ Panel”), komunikat o pominiętych agentach i o limicie; Grid: w pustym projekcie presety
wbudowane jako przyciski obok „+ Panel”. Sprawdzania: typecheck czysto, vitest 93/93, cargo test 11/11, cargo build
0 ostrzeżeń, `tauri` w `Cargo.lock` 2.12.0. `ui_audit` :5183 (1000 px + 390 px): 0 wysokich / 6 średnich — te same
co w etapach 8–9 (kompaktowe 4/8 px w chrome, siatka komórek xtermu); po naprawie zniknęły dwie nowe flagi
(wysokości 36/20 px w wierszu z ✕, przesunięty `.pm-hint`). Niesprawdzone: okno Tauri (presety tylko TS/UI);
BrowserOS znów niedostępny (`MCP server "browseros" not available`) → menu, pusty projekt i zapis presetu obejrzane
zrzutami `look` na temp stronach seed (usunięte): wiersz presetu dodaje panele, przy 15 panelach komunikat
„Pominięto 1 z powodu limitu 16 paneli na projekt”, przy braku agenta „Brak agentów w konfiguracji: codex”,
zapis + usunięcie widoczne w `localStorage` (`duo=claude,pi`).

## Przegląd etapów 8–9 (Claude) – 2026-09-30
- Panel z fokusem, który coś wypisał, gdy okno było w tle, zostawał z akcentową kropką po
  powrocie do okna (fokus panelu się nie zmienia, więc nic jej nie kasowało). Teraz kasuje ją
  zdarzenie `focus` okna.
- Poprawka w opisie etapu 9: `notify.rs` usuwa zmienne `own_env()` ze środowiska `notify-send`.

## M1 Etap 9 – 2026-09-30
Aktywność: `src/activity.ts` (czyste `onOutput`/`onResize`/`tick`, progi 2000/3000/500 ms, `dotClass`/`dotTitle`)
+ 11 testów. `Terminal` zgłasza każdy chunk od procesu (`onOutput`) i zmianę rozmiaru xtermu (`onRedraw`);
`App` trzyma czasy w `useRef(Map)` (chunki nie restartują Reacta), `setInterval` 1 s → `tick`, a stan ulotny
panelu to teraz `PaneState {exited, working, unread}` (zastąpił mapę `exited` w `Rail`/`Grid`/`Pane`).
`unread` = wyjście panelu bez fokusu lub bez fokusu okna (`document.hasFocus()`), kasowane przy fokusie
(też przy przejściu strzałką na inny projekt). Kropki: `.dot--working` (puls, `prefers-reduced-motion` wyłącza),
`.dot--unread` (akcent), `.dot--hidden` (rezerwuie miejsce w wierszu projektu; akcent, gdy któryś panel ma `unread`).
Powiadomienie: `src-tauri/src/notify.rs` = `notify-send -a Agents <tytuł> <treść>` (spawn, `wait` w wątku, bez `own_env`,
błąd na stderr), mock = `console.info`; `notify` w `Backend` — bez nowej zależności i bez wpisu w capability (komenda aplikacji).
Sprawdzenia: typecheck czysto, vitest 78/78, cargo test 11/11, cargo build 0 ostrzeżeń, `tauri` w `Cargo.lock` 2.12.0.
`ui_audit` :5183 (1000 px + 390 px): 0 wysokich / 6 średnich (te same co w etapie 8: kompaktowe 4/8 px w chrome
i siatka komórek xtermu). `x.onResize` w `Terminal.tsx` łączy `pty.resize` ze zgłoszeniem `onRedraw` (resize nie zmienia zachowania PTY).
Niesprawdzone: BrowserOS znów niedostępny (`MCP server "browseros" not available`) → kropki obejrzane zrzutem `look`:
`unread` na panelu pi i na wierszach Projekt A/B, `działa` na czytanym panelu; `working` (2 s po wyjściu) i `finished`
(seria ≥ 3 s) nie do uchwycenia zrzutem — logika w testach, ścieżka renderowania ta sama co dla `unread`.
W oknie Tauri `notify-send` i `document.hasFocus()` wołane po raz pierwszy.
Ręcznie (użytkownik): długie zadanie w drugim panelu → pulsująca kropka; po ≥ 3 s ciszy powiadomienie
„Agents: Claude — skończył pracę w <projekt>”; klik w panel kasuje akcentową kropkę; fokus okna = brak powiadomień.

## M1 Etap 8 – 2026-09-30
Skróty: `src/keys.ts` (`commandFor`, table Ctrl+Alt+←/→/↑/↓, Enter, N, W, R, P, 1–9 oraz
Ctrl+Shift+C/V; reszta → `null`, więc Ctrl+C i Ctrl+V zostają dla terminala). App: jeden
`keydown` na `window` w fazie capture + `preventDefault` dla rozpoznanych; handler w `useRef`
(ma aktualny stan, subskrypcja efektu z `[]`). `Terminal.tsx`:
`attachCustomKeyEventHandler(e => commandFor(e) === null)` (xterm nie wysyła naszych skrótów
do procesu) oraz uchwyt `copySelection()/paste()` przez `useImperativeHandle` → `Pane` rejestruje
go w mapie App (`registerTerminal` w `PaneActions`, klucz = id panelu, kopiowanie z panelu
z fokusem modelu). `closePane` z klawiatury używa tej samej reguły co ✕ (`confirmClick`, 3 s);
`armedPane` w App podświetla „Na pewno?” w nagłówku. Schowek: `Backend.copyText/pasteText`
tauri-plugin-clipboard-manager ~2.4 / `@tauri-apps/plugin-clipboard-manager` 2.4.0
(`clipboard-manager:allow-read-text|write-text` w capability, plugin w `lib.rs`; mock =
`navigator.clipboard` z buforem awaryjnym). Na szynie numery 1–9 przy nazwach (`.rail-key`).
Sprawdzenia: typecheck czysto, vitest 66/66 (8 nowych `keys.test.ts` + kopiuj→wklej w mocku),
cargo test 10/10, cargo build 0 ostrzeżeń, `tauri` w `Cargo.lock` nadal 2.12.0.
`ui_audit` :5183 (stan z 2 projektami i 3 panelami, seed przez temp `seed-preview.html` — usunięty):
0 wysokich / 8 średnich / 0 niskich. Wysoki (kontrast `rail-count` 4,4:1 na aktywnym wierszu)
naprawiony; średnie to `text-touches-edge` w kompaktowym chrome (wiersz szyny 28 px, nagłówek
panelu 26 px, padding 4/8 px) i wewnątrz warstwy xtermu (0 px — siatka komórek xtermu, nasza
reguła by ją rozjechała) — zostawione celowo.
Niesprawdzone: **klawiatura interaktywnie** (BrowserOS niedostępny w tej sesji: `fetch failed`,
brak chromium na PATH → w podglądzie sprawdzony tylko rendering: szyna z numerami, 3 panele,
fokus; logika mapowania w testach, Wiring `preventDefault`/dispatch tylko z przeglądu diffu),
oraz okno Tauri: plugin schowka i uprawnienia po raz pierwszy wołane, Ctrl+Alt u WebKitGTK.
Ręcznie (użytkownik): Ctrl+Alt+N → okno panelu, Ctrl+Alt+Enter maksymalizacja, Ctrl+Alt+W
dwukrotnie = zamknięcie, Ctrl+Alt+2 zmiana projektu, zaznacz tekst → Ctrl+Shift+C, w drugim
panelu Ctrl+Shift+V, plain Ctrl+V w claude nadal wkleja, plain Ctrl+C nadal przerywa.

## Przegląd etapu 7 (Claude) – 2026-09-30
- Usunięty drugi, stary efekt `loadAgents` w `App.tsx`: biegł równolegle ze startem i jego
  `setErrors(r.errors)` kasował błędy parsowania `workspace.json`.
- Błąd odczytu pliku (np. nie-UTF-8) robi teraz kopię `.bak` przed pierwszym zapisem; wcześniej
  pusty stan nadpisywał plik bez kopii.
- Data kopii liczona lokalnie, nie w UTC (po 22:00 wychodził jutrzejszy dzień).

## M1 Etap 7 – 2026-09-30
Zapis/wznowienie: Rust `config.rs` – `workspace_load` (brak pliku → `None`), `workspace_save` przez
`write_atomic`, `workspace_backup(date)` → kopie `workspace.<RRRR-MM-DD>.bak` obok, bez nadpisywania
istniejącej (datę liczy TS, Rust validating `[0-9-]` – bez nowej zależności). TS: `loadWorkspace`/
`saveWorkspace`/`backupWorkspace` w `Backend`; mock w `localStorage` (try/catch). `App.tsx`: start
`loadAgents` → `loadWorkspace` → `parseWorkspace` → `load` (przed wczytaniem napis „Wczytywanie…”,
błędy parsowania/JSON → `backupWorkspace` przed pierwszym zapisem), zapis `useEffect` na `[ws, loaded]`
(`JSON.stringify(ws, null, 2)`, bez debounce). Panel z `session` ma „+” (Nowa rozmowa) w nagłówku →
`newConversation` (nowe sessionId + run+1). Naprawiony błąd: `Terminal` montował się przy „Nowa rozmowa”
ze **starymi** args (efekt liczy args po macie; spawn czyta args raz przy montażu) – `Pane` stempluje
args `{run, sessionId}` i renderuje `Terminal` tylko gdy stempl pasuje do panelu (znaleziono w podglądzie:
banner pokazywał stare id, localStorage już nowe).
Sprawdzenia: typecheck czysto, vitest 57/57 (round-trip `Workspace→JSON→parseWorkspace` z etapu 4),
cargo test 10/10 (nowy: backup kopiuje raz, brak źródła = brak kopii), cargo build 0 ostrzeżeń.
Podgląd :5183 (BrowserOS): start bez pliku → pusty stan; zapis → reload → projekt + panele claude/pi
wracają, claude dostaje zapisane sessionId, „+” → proces z nowym id w bannerze (przed naprawą: ze starym),
reload → oba panele na miejscu. `ui_audit` :5183: 0 wysokich / 0 średnich / 0 niskich.
Niesprawdzone: okno Tauri (`workspace.json`, `write_atomic`, backup z prawdziwą datą – po raz pierwszy
wołane); ręczny test użytkownika: dwa projekty, panele claude + pi z wiadomością, zamknij/otwórz →
rozmowy na miejscu. Uwaga: podgląd dzieli `localStorage` z poprzednimi stanami – start ze śmieciami
parsuje `parseWorkspace`, czysty stan = skasować klucz `aw-workspace`.

## M1 Etap 6 – 2026-09-30
„+ Projekt” (szyna i pusta siatka) pyta o katalog: `backend.pickDir()` = tauri-plugin-dialog
`open({ directory: true })`, w podglądzie `prompt()`; anulowanie = nic, wynik → `dirExists` →
`addProject` z `projectName(path)`. Ścieżki zapisywane z `~`: `tildify(path, home)` w `src/paths.ts`
(4 testy), `home` z nowej komendy Rust `home_dir()` (mock → `/home/podglad`). Błąd pickera i
nieistniejący katalog → komunikat w `.config-errors` z ✕ (stan ulotny `notice`, nie trafia do pliku).
Panel: `src/NewPaneDialog.tsx` – kafelki agentów z numerem, 1–9 / klik / Enter dodaje i zamyka,
↑↓ przechodzą, Esc i klik w tło zamykają; zaznaczone na starcie: ostatnio użyty agent (`lastAgentId`,
stan ulotny). Logika klawiszy to czysta `dialogKey` w `src/new-pane.ts` (5 testów). `ProjectActions`:
`addProject()` (async), `openPaneDialog()`, `addPane(agentId)`; „+ Panel” wyłączony bez aktywnego
projektu i przy 16 panelach. Zależności: `@tauri-apps/plugin-dialog` 2.8.0 + `tauri-plugin-dialog` ~2.8,
`dialog:allow-open` w capability (w Cargo.lock `tauri` nadal 2.12.0).
Sprawdzenia: typecheck czysto, vitest 57/57 (11 nowych), cargo test 9/9, cargo build 0 ostrzeżeń.
Podgląd :5183 (BrowserOS): projekt z promptu (nazwa „Agents workspace” + ścieżka w nagłówku), „2” →
panel pi z `--session-id`, strzałka + Enter → panel Terminal, preselect = pi (ostatni użyty), Esc zamyka,
siatka 1→2 kolumn bez restartu procesów. `ui_audit` :5183: 0 wysokich / 0 średnich / 0 niskich.
Niesprawdzone: okno Tauri (prawdziwy dialog katalogu i `home_dir` po raz pierwszy wołane); w podglądzie
`home` to `/home/podglad`, więc prawdziwych ścieżek nie skraca do `~` — skrót pilnują testy `tildify`.
Czarny pasek pod terminalem w podglądzie = artefakt z etapu 5, do sprawdzenia w oknie (etap 11).

## Przegląd etapu 5 (Claude) – 2026-09-30
Poprawione: stary proces po ⟳/✕ wołał `onExit` i gasił kropkę nowego uruchomienia (teraz ignorowane po
odmontowaniu); każdy terminal robił `focus()` po starcie i przez `onFocus` przestawiał fokus modelu
(po etapie 7 przełączałby projekt) – teraz tylko panel z fokusem; „Na pewno?” wraca do ✕ po 3 s
(panel i szyna); dwuklik w ✕ projektu nie otwiera zmiany nazwy. Sprawdzone w podglądzie.

## M1 Etap 5 – 2026-09-30
UI na modelu z etapu 4: `App.tsx` = `useReducer(reduce, emptyWorkspace)` + stan ulotny `Record<paneId,{exited}>`
(agenci wyłącznie z `backend.loadAgents()`, stała `AGENTS` usunięta, błędy w pasku `.config-errors`);
`Rail.tsx` (220 px, panele pod każdym projektem, dwuklik na nazwie = edycja, ✕ z dwuklikiem), `Grid.tsx`
(wszystkie siatki zamontowane, nieaktywne `display:none`; maksymalizacja = 1×1 + `display:none` na reszcie),
`Pane.tsx` (nagłówek 26 px; przed montażem `Terminal` pyta `claudeSessionExists` i liczy `buildArgs`),
`Terminal.tsx` (efekt z `[]` – proces żyje tylko z kluczem `${pane.id}:${pane.run}`, `focused` → `term.focus()`,
`onFocus` z `textarea`), `confirm.ts` + 5 testów (dwuklik „Na pewno?”, 3 s, czysta funkcja). Klucze Reacta
i id (`crypto.randomUUID`) tworzy wywołujący (`handlers.ts` = typy callbacków).
Sprawdzenia: typecheck czysto, vitest 46/46 (5 nowych), cargo test 9/9, cargo build 0 ostrzeżeń.
Podgląd :5183 (klikane w BrowserOS): 1/3/5 paneli → cols 1/2/3; maksymalizacja i przywrócenie zachowują
napisany tekst (proces nie zrestartowany); fokus z szyny; zamknięcie środkowego panelu po dwukliku;
dwuklik na nazwie → pole edycji → Enter zapisuje; ✕ przy projekcie zamyka projekt i jego panele (pusty start).
`ui_audit` :5183: 0 wysokich / 0 średnich / 0 niskich (poprawione: 11 px → 12 px w szynie, minimaksy paneli,
media query <720 px, `.pi/` z referencjami w `.gitignore`).
Niesprawdzone: okno Tauri. Przełączenie **dwóch** projektów nie do przejścia w podglądzie: „+ Projekt” dodaje
zawsze `~`, a `addProject` deduplikuje po ścieżce → drugiego projektu nie da się utworzyć przed etapem 6
(logikę pilnują testy `reduce`: fokus/select między projektami). Artefakt wizualny: cienki poziomy pasek pod
terminalem xterm w podglądzie Chromium – nie znika po regułach `overflow`/`.scrollbar`, nie pochodzi z układu
z etapu 5; do sprawdzenia w oknie Tauri (etap 11).

## M1 Etap 4 – 2026-09-30
Model workspace'u bez Reacta w `src/workspace.ts`: typy `Pane/Project/Preset/Workspace`, `emptyWorkspace`,
`MAX_PANES = 16`, `gridShape` (cols = ceil(√n)), `neighbor` (poza siatkę → bez zmiany; w dół do dziury
ostatniego wiersza → ostatni panel), `activeProject`, `projectName`, `reduce` (12 akcji, czysty —
id tworzy wywołujący), `parseWorkspace` (naprawia refs, ucina >16 paneli, odrzuca nieznanych agentów
i duplikaty ścieżek, nieznana wersja → pusty + błąd). `reduce` i `parseWorkspace` nie wołają `randomUUID`
(w tym drugim tylko uzupełnianie brakujących id). Złapany błąd: `mapProject` aplikował funkcję do
wszystkich projektów, nie tylko o pasującym id — naprawione, test `focus` między projektami to pilnuje.
UI (App.tsx) bez zmian — podłączenie w etapie 5. Sprawdzenia: typecheck czysto, vitest 41/41 (24 nowe
workspace, w tym deep-freeze na wejściu `reduce`), cargo test 9/9, cargo build 0 ostrzeżeń.
Niesprawdzone: zachowanie w oknie Tauri (etap 4 to tylko funkcje czyste, zero wywołań backendu).

## M1 Etap 3 – 2026-09-30
Agenci z pliku: `src/agents.ts` (`AgentDef`, `DEFAULT_AGENTS`, `parseAgents`, `buildArgs` — podmiana `{session}`,
`exists ? resume : new`); Rust `src-tauri/src/config.rs`: `agents_load` (brak pliku → zapis domyślnego przez
`write_atomic` (tmp+rename), uszkodzony zwracany bez nadpisania), `claude_session_exists` (tylko id z `[0-9a-f-]`, szukane
w `~/.claude/projects/*/<id>.jsonl` przez `session_exists_in`), `dir_exists` (używa `pty::expand`, teraz `pub(crate)`).
Backend: `loadAgents`/`claudeSessionExists`/`dirExists`; mock: defaults / `false` / `true`. `App.tsx`: lista z
`loadAgents()`, błędy jako pasek `.config-errors`. `smoke.test.ts` usunięty. Sprawdzenia: typecheck czysto, vitest 17/17
(11 nowych agents), cargo test 9/9 (4 nowe), cargo build bez ostrzeżeń; podgląd :5183 — start z agentem z pliku, bez paska błędów.
Niesprawdzone: okno Tauri (nowe komendy nie były wołane w oknie; `agents_load` tworzy `~/.config/dev.majke.agents/agents.json`
przy pierwszym starcie); `pid()` nadal `#[cfg(test)]` (fokus/powiadomienia są w etapach 5/9).
Po `ui_audit` :5183 — 0 wysokich / 0 średnich / 0 niskich (pasek `.config-errors` tylko przy błędach, w domyśle niewidoczny).

## M1 Etap 2 – 2026-09-30

Każde wywołanie backendu idzie przez `src/backend.ts` (interfejs `Backend`, `inTauri`, `backend`); `pty.ts` →
`src/backend-tauri.ts` (logicznie bez zmian, `SpawnSpec`/`ExitInfo`/`PtyHandle` wyprowadzone z `backend.ts`).
`src/backend-mock.ts`: banner `[podgląd] <command> <args> w <cwd>`, echo klawiszy, Enter → nowy prompt,
Ctrl+C → `^C`, Backspace, `exit` → kod 0, `fail` → kod 1, `kill()` → `onExit` po 100 ms; zero `invoke`.
W rogu napis „podgląd – bez prawdziwych procesów" (`App.tsx` + `.preview-badge` w CSS). Zero nowych zależności.
`backend.pid()` nadal `#[cfg(test)]` — Etap 2 nie dodał komendy, która by go użyła (zdjąć przy `focus`/`notify`).
Testy: `pnpm test` 6/6 (nowy `backend-mock.test.ts`), `pnpm typecheck` czysto, `cargo test --lib` 5/5,
`cargo build` bez ostrzeżeń. W podglądzie (`:5183`, zrzut + realne klawisze przez BrowserOS): banner,
echo, Enter, restart przez „Uruchom ponownie".
Niesprawdzone: okno Tauri (brak zmian w kontrakcie komend; `Terminal.tsx` tylko zmienia import na `backend`);
`cargo test --lib` ma ostrzeżenie `unused_variables` w `pty.rs:287` (test z Etapu 1, build czysty).
Poprawione po `ui_audit` (0 wysokich / 0 średnich): napis 12 px, paddingy `.bar` i `.terminal` na skali 4 px.

## M1 Etap 1 – 2026-09-30

Vitest 5.0.3 (`pnpm test`, `vitest.config.ts`, `src/smoke.test.ts`) + rdzeń PTY bez Tauri:
`Ptys::spawn/write/resize/kill/pid` w `pty.rs`, komendy to cienkie opakowania (kanal → domknięcia
`DataSink`/`ExitSink`). `SpawnSpec` ma `env: Vec<(String,String)>` (rozwijane jak reszta, stosowane
po TERM/COLORTERM). `pid()` tymczasowo `#[cfg(test)]` (build bez ostrzeżeń) — zdjąć gate w etapie 2.
Testy Rusta: exit code + usunięcie z mapy, cwd, zabijanie grupy (marker `sleep`), echo przez `cat`
— 5/5 w 0,05 s. Naprawiony wyścig: katalog tymczasowy usuwany dopiero po wyjściu dziecka.
`pnpm typecheck` czysto, `pnpm test` 1/1, `cargo test --lib` 5/5, `cargo build` bez ostrzeżeń.
Niesprawdzone: zachowanie w oknie Tauri (brak zmian w UI — komendy mają identyczny kontrakt serde,
`env` z domyśłem, frontend nic nie wysyła poza dotychczasowe pola).

## M0 – 2026-09-30

Jeden terminal (Tauri 2 + portable-pty + xterm.js), wybór agenta i katalogu, restart.
`pnpm typecheck` czysto, `cargo test --lib` 1/1, `cargo build` bez ostrzeżeń.
Sprawdzone przez użytkownika w oknie Tauri: okno się rysuje (zmienne WebKit działają),
wyjście PTY dochodzi, TUI claude z kolorami i ramkami (pytanie o zaufanie do `~`).
Potem użytkownik potwierdził: „wszystko działa”, przełączanie agentów też. M0 zamknięte.
