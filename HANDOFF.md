# HANDOFF

Najnowszy wpis na górze. Każdy etap z `docs/plan-m1.md` dopisuje tu 3–8 linii.

## M0 – 2026-09-30

Jeden terminal (Tauri 2 + portable-pty + xterm.js), wybór agenta i katalogu, restart.
`pnpm typecheck` czysto, `cargo test --lib` 1/1, `cargo build` bez ostrzeżeń.
Niesprawdzone: okno Tauri nie było uruchamiane – nie wiadomo, czy wyjście dochodzi jako
`ArrayBuffer` (kod obsługuje też `number[]`), jak wyglądają TUI claude/pi, wklejanie.
