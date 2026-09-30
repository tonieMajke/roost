# HANDOFF

Najnowszy wpis na górze. Każdy etap z `docs/plan-m1.md` dopisuje tu 3–8 linii.

## M0 – 2026-09-30

Jeden terminal (Tauri 2 + portable-pty + xterm.js), wybór agenta i katalogu, restart.
`pnpm typecheck` czysto, `cargo test --lib` 1/1, `cargo build` bez ostrzeżeń.
Sprawdzone przez użytkownika w oknie Tauri: okno się rysuje (zmienne WebKit działają),
wyjście PTY dochodzi, TUI claude z kolorami i ramkami (pytanie o zaufanie do `~`).
Potem użytkownik potwierdził: „wszystko działa”, przełączanie agentów też. M0 zamknięte.
