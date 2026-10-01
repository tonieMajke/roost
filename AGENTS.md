# Roost – zasady pracy

Desktopowa aplikacja (Electron + React + TypeScript, pnpm, tylko Linux), która uruchamia wiele
agentów CLI (`claude`, `pi`, powłoka) w siatce terminali. Opis projektu: `PLAN.md`.
**Plan do wykonania, etap po etapie: `docs/plan-m5.md`** (M1–M4: `docs/plan-m1.md`…`plan-m4.md`, zrobione). Etapy oznaczone **(C)** robi Claude: gdy pierwszy niezrobiony etap ma (C), nie zaczynaj go – zatrzymaj się i napisz, że następny etap jest dla Claude.

## Jak pracujesz

1. Na start sesji przeczytaj `docs/plan-m5.md` (sekcje „Decyzje” i „Kto robi”) oraz
   `HANDOFF.md`. Znajdź pierwszy etap bez `[x]` w „Postępie” w `docs/plan-m5.md`.
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
(cd electron && npm run typecheck && npm run build)   # backend Electrona
```

## Zakazy

- Nie uruchamiaj `pnpm desktop` / `electron .` – to otwiera okno na pulpicie użytkownika.
  Wygląd sprawdzasz w trybie podglądu w przeglądarce (etap 2): `pnpm dev`, adres
  `http://localhost:5183`.
- Nie ruszaj `~/.claude/`, `~/.pi/` ani sesji agentów. Czytać nazwy plików wolno, pisać nie.
- Procesy zabijaj po PID (`ss -ltnp`, `pgrep -a`). Nigdy `pkill -f` ani `killall`.
- Nie dodawaj zależności spoza tych wymienionych w etapie.
- `legacy-tauri/` to archiwum dawnej wersji Tauri – nie rozwijaj go i nie usuwaj.
- Nie `git push`, nie `git reset --hard`, nie przepisuj historii.

## Styl

- Nazwy w kodzie po angielsku. Teksty w UI idą przez `t()` / `useT()` z `src/i18n` (klucze w
  `src/i18n/messages/<obszar>.ts`, para `pl` + `en`); nie wpisuj polskich napisów w komponentach.
  W procesie głównym Electrona analogicznie `electron/src/i18n.ts`.
- Komentarze krótkie: dlaczego, nie co.
- Logika bez UI (układ siatki, argumenty, skróty, aktywność) trafia do czystych funkcji
  w osobnych plikach `src/*.ts` z testami `src/*.test.ts`.
