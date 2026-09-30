# HANDOFF

Najnowszy wpis na górze. Każdy etap z `docs/plan-m1.md` dopisuje tu 3–8 linii.

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
