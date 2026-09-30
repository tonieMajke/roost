# HANDOFF

Najnowszy wpis na górze. Każdy etap z `docs/plan-m1.md` dopisuje tu 3–8 linii.

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
