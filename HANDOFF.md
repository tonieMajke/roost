# HANDOFF

Najnowszy wpis na górze. Każdy etap z `docs/plan-m1.md` dopisuje tu 3–8 linii.

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
