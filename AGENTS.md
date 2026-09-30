# Agents workspace – zasady pracy

Desktopowa aplikacja (Tauri 2 + React + TypeScript, pnpm, tylko Linux), która uruchamia wiele
agentów CLI (`claude`, `pi`, powłoka) w siatce terminali. Opis projektu: `PLAN.md`.
**Plan do wykonania, etap po etapie: `docs/plan-m2.md`** (M1: `docs/plan-m1.md`, zrobione). Etapy oznaczone „Claude” w tabeli „Kto robi” pomijasz – zatrzymaj się i napisz, że następny etap jest dla Claude.

## Jak pracujesz

1. Na start sesji przeczytaj `docs/plan-m2.md` (sekcje „Kontekst” i „Decyzje”) oraz
   `HANDOFF.md`. Znajdź pierwszy etap bez `[x]` w „Postępie” w `docs/plan-m2.md`.
2. **Jeden etap na sesję.** Nie zaczynaj następnego etapu. Nie rób rzeczy spoza etapu, także
   „przy okazji”. Jeśli coś w etapie jest niejasne albo niemożliwe, zatrzymaj się i napisz,
   co blokuje.
3. Czytaj plik, zanim go zmienisz. Zmieniaj małymi kawałkami.
4. Po etapie uruchom **wszystkie** sprawdzenia z sekcji „Sprawdzenia”. Każde musi przejść.
   Czytaj wyjście komendy, nie tylko kod wyjścia: nie przepuszczaj wyniku przez `| tail`
   w łańcuchu `&&` (połyka błąd).
5. Zaznacz etap `[x]` w „Postępie”, dopisz na górę `HANDOFF.md` 3–8 linii: co zrobione,
   wynik sprawdzeń, co zostało niesprawdzone. Potem jeden commit z komunikatem podanym
   w etapie. Poprawki po audycie UI wchodzą do tego samego commitu (`git commit --amend`
   przed zakończeniem sesji jest dozwolony tylko dla commitu z tej sesji).
6. W HANDOFF pisz tylko to, co jest w kodzie. Przed commitem przejdź listę kroków etapu
   i przy każdym sprawdź w `git diff --cached`, że zmiana naprawdę tam jest.
7. Ostrzeżenia kompilatora i testów poprawiaj od razu, nawet w teście z wcześniejszego etapu.
   Nie wpisuj ich do HANDOFF jako „do zrobienia”.

## Sprawdzenia

```bash
pnpm typecheck
pnpm test                                             # vitest (od etapu 1)
cargo test --manifest-path src-tauri/Cargo.toml --lib
cargo build --manifest-path src-tauri/Cargo.toml
```

## Zakazy

- Nie uruchamiaj `pnpm desktop` / `tauri dev` – to otwiera okno na pulpicie użytkownika.
  Wygląd sprawdzasz w trybie podglądu w przeglądarce (etap 2): `pnpm dev`, adres
  `http://localhost:5183`.
- Nie ruszaj `~/.claude/`, `~/.pi/` ani sesji agentów. Czytać nazwy plików wolno, pisać nie.
- Procesy zabijaj po PID (`ss -ltnp`, `pgrep -a`). Nigdy `pkill -f` ani `killall`.
- Nie dodawaj zależności spoza tych wymienionych w etapie.
- Pluginy Tauri przypinaj do wersji z planu. `tauri` (crate) i `@tauri-apps/api` muszą mieć
  tę samą wersję minor (teraz 2.12), inaczej `tauri build` odmawia.
- Nie zmieniaj `set_webview_env` w `src-tauri/src/lib.rs` (bez niego okno jest czarne).
- Nie `git push`, nie `git reset --hard`, nie przepisuj historii.

## Styl

- Nazwy w kodzie po angielsku, teksty w UI po polsku.
- Komentarze krótkie: dlaczego, nie co.
- Logika bez UI (układ siatki, argumenty, skróty, aktywność) trafia do czystych funkcji
  w osobnych plikach `src/*.ts` z testami `src/*.test.ts`.
