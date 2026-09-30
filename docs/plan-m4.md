# Plan M4 – przeciąganie paneli i przekazanie kontekstu

Dopisane 2026-09-30 z rozmowy z użytkownikiem. Niezależne od M3 (Chat) – może iść przed nim.
W `plan-m2.md` przeciąganie było „poza M2”; to jest jego osobny kamień.

Co ma działać po M4:
1. Panel chwycony za nagłówek zamienia się w kulkę, leci za kursorem, a upuszczony na inny
   panel **zamienia się z nim miejscami**; reszta siatki przesuwa się FLIP-em z etapu 6 M2.
2. **Shift przy upuszczeniu** (albo trzymany w locie) = nie zamiana, tylko **przekazanie
   kontekstu**: wyciąg z rozmowy panelu źródłowego wklejany do panelu docelowego,
   **bez Entera** – użytkownik dopisuje polecenie i sam wysyła.

## Decyzje

- **Zamiana, nie wstawianie.** Siatka jest automatyczna (`gridShape`), więc „inny układ” to
  inna kolejność `project.panes`. Upuszczenie na panel = zamiana dwóch miejsc: przewidywalne
  w siatce, porusza tylko dwa panele. Wstawianie między panele – poza M4.
- **Kolejność przez CSS `order`, DOM stały.** Komórki siatki zostają w DOM w kolejności
  utworzenia (tablica `mountOrder` w Grid), pozycję daje `style={{ order: i }}`. Powód:
  przeniesienie węzła w DOM (React przy zmianie kolejności kluczy) odpina i przypina canvas
  xterm – ryzyko utraty kontekstu WebGL i migania. `measure()` czyta `offsetLeft/Top`,
  które uwzględniają `order`, więc FLIP działa bez zmian.
- **Zdarzenia pointer, nie HTML5 drag&drop.** Natywnego „ducha” nie da się animować,
  a Tauri na Linuksie przechwytuje natywne przeciąganie (`dragDropEnabled`).
- **Uchwyt = `.pane-head`** bez przycisków `.tools`. Terminal nie jest uchwytem
  (przeciąganie w nim zaznacza tekst).
- **Przekazanie = wklejenie, bez Entera, bez LLM.** Wyciąg składany deterministycznie
  z pliku sesji (ten sam odczyt co etapy 8–9 M2). Wklejenie przez `TerminalHandle.paste`
  (bracketed paste: claude pokaże „[Pasted text …]”, nic się nie wysyła). Streszczenie
  przez `claude -p` – poza M4 (koszt limitów, kilkanaście sekund czekania).
- Nic nie zapisujemy w katalogu projektu ani w `~/.claude` / `~/.pi` – tylko odczyt.

## Postęp

- [x] Etap 1 (L) – zamiana paneli w modelu + skrót klawiszowy
- [x] Etap 2 (C) – przeciąganie i kulka
- [ ] Etap 3 (L) – wyciąg rozmowy w Rust
- [ ] Etap 4 (C) – Shift = przekazanie kontekstu
- [ ] Etap 5 (C + użytkownik) – sprawdzenie w oknie

---

## Etap 1 (L) – zamiana paneli w modelu + skrót klawiszowy

- `workspace.ts`: akcja `swap { a: string; b: string }` w aktywnym projekcie. Ten sam id,
  nieznany id albo projekt z `maximized` = brak zmiany (ten sam obiekt `ws`). Fokus zostaje
  na panelu, który miał fokus (idzie razem z nim). Testy: zamiana, brak zmian w złych
  przypadkach, `savePreset` po zamianie zapisuje nową kolejność, zapis/odczyt pliku
  zachowuje kolejność.
- `Grid.tsx`: DOM w kolejności utworzenia, `order` z indeksu w `project.panes` (patrz
  Decyzje). Sprawdzić, że `layoutKey` nadal się zmienia przy zamianie (zawiera kolejność id),
  więc FLIP rusza.
- `keys.ts`: **Ctrl+Alt+Shift+strzałka** = zamiana panelu z fokusem z sąsiadem w tym
  kierunku (sąsiad z istniejącej funkcji dla `move`). Dostępna alternatywa dla myszy.
  Testy w `keys.test.ts`.
- `backend-mock`: nic.

**Commit:** `M4 Etap 1: zamiana paneli`

## Etap 2 (C) – przeciąganie i kulka

Nowy `src/drag.ts` (czyste, testy): próg startu (6 px), wybór celu z pudełek komórek
(`Box` z `motion.ts`, punkt w pudełku, własny panel = brak celu), stan
`idle | pressed | dragging`, sprężyna kulki (`follow(pos, target, dt)`, stała ~0,25/klatkę
przy 60 Hz, liczona od `dt`, żeby 144 Hz nie było szybsze).

Zachowanie:
- `pointerdown` na `.pane-head` (nie na `.tools`) → `pressed`; ruch > 6 px → `dragging`,
  `setPointerCapture`. Krótki klik bez ruchu działa jak dziś (fokus).
- Start lotu: nad panelem pojawia się **duch** (`.drag-ghost`, portal do `.app`,
  `pointer-events: none`) w pudełku panelu, w kolorze agenta (`--ag`), z `ag-badge`
  i nazwą. W ~220 ms (`--ease` ze wzoru) zwija się do kulki 48 px pod kursorem:
  `transform` + `border-radius` + `opacity` treści. Kulka ma poświatę agenta.
- Lot: pozycja kulki goni kursor sprężyną (`requestAnimationFrame`, tylko `transform`),
  lekkie rozciągnięcie w kierunku ruchu (`scale` od prędkości, maks. 1,15) – efekt bąbelka.
- Panel źródłowy: `is-lifted` (opacity .35, nic nie przesuwa). Cel pod kursorem:
  `is-drop-target` (obrys akcentem).
- Upuszczenie na cel: kulka wlatuje w środek celu i znika (120 ms), potem `swap` →
  FLIP przesuwa oba panele. Upuszczenie poza celem, Esc, `pointercancel`, utrata fokusu
  okna: kulka wraca do źródła i rozwija się (odwrócenie startu), bez zmian w modelu.
- Wyłączone, gdy: 1 panel w projekcie, projekt z maksymalizacją.
- `motion-lite` / `prefers-reduced-motion`: bez zwijania, sprężyny i powrotu – od razu mały
  żeton przy kursorze, zamiana bez animacji ducha (FLIP i tak jest wyłączony).
- `fit()` terminala nie może się odpalić w trakcie lotu (nic nie zmienia rozmiarów – sprawdzić).
- WebKitGTK rysuje programowo: `border-radius` animujemy tylko na duchu (mały, prosty
  element, bez canvasu), sam terminal nie jest kopiowany ani skalowany.

Podgląd: headless przeglądarka na mocku – zrzuty klatek: start, lot, cel, powrót.

**Commit:** `M4 Etap 2: przeciąganie paneli`

## Etap 3 (L) – wyciąg rozmowy w Rust

Rust `context.rs`: komenda `session_handoff(kind, session_id) -> Option<Handoff>`.
Używa istniejących `find_session`, `user_prompt`, `session_title`, `last_tools`.
Czyta ogon **1 MB** (osobna stała, nie zmieniać 256 KB dla mierników).

```
Handoff {
  title: Option<String>,
  prompts: Vec<String>,      // do 5 ostatnich promptów użytkownika, każdy ≤ 800 znaków
  replies: Vec<String>,      // do 3 ostatnich tekstów asystenta (bloki "text"), każdy ≤ 1500 znaków
  files: Vec<String>,        // ścieżki z narzędzi zapisu/edycji (claude: Edit/Write/MultiEdit/NotebookEdit,
                             // pi: edit/write), bez powtórzeń, najnowsze pierwsze, do 20
  commands: Vec<String>,     // do 5 ostatnich poleceń powłoki, w jednej linii, ≤ 120 znaków
}
```

Pomija `isSidechain`, `isMeta`, prompty zaczynające się od `<` (claude, jak w tytule).
Ucięcia na granicy znaku (UTF-8, polskie litery), z „…”. Brak pliku / pusta rozmowa = `None`.
Testy na fixture w katalogu tymczasowym (claude i pi, sidechain, ucięcie w środku „ż”,
limity liczby wpisów) – **testy nie czytają prawdziwego `~/.claude` ani `~/.pi`**.

TS `src/handoff.ts` (czyste, testy): `handoffText(h, from: { agent, project, pane }) -> string`
– markdown z nagłówkiem „Kontekst przekazany z innej sesji (agent, projekt, tytuł). To tylko
tło – czekaj na moje polecenie poniżej.”, sekcje „Ostatnie polecenia użytkownika”,
„Ostatnie odpowiedzi”, „Zmienione pliki” (ścieżki względem projektu), „Polecenia powłoki”;
puste sekcje pominięte; całość ≤ 8000 znaków (ucinamy najpierw odpowiedzi, potem prompty).
`backend.ts` / `backend-tauri.ts` / `backend-mock.ts`: `sessionHandoff(kind, sessionId)`.

**Commit:** `M4 Etap 3: wyciąg rozmowy`

## Etap 4 (C) – Shift = przekazanie kontekstu

- Tryb lotu liczony na żywo: `shiftKey` z `pointermove` + `keydown/keyup` Shift (bez ruchu
  myszy też się przełącza). Tryb przy `pointerup` decyduje.
- Wygląd trybu: kulka `is-handoff` (akcent zamiast koloru agenta, ikona `Send` z lucide,
  etykieta „kontekst →” obok kulki), cel `is-handoff-target` (inny obrys + podpis
  „wklej kontekst” w nagłówku celu).
- Źródło bez rozmowy (`contextKind` = `null`, np. powłoka) – w trybie Shift kulka szara,
  etykieta „brak rozmowy”, upuszczenie = nic (kulka wraca).
- Cel: dowolny panel z działającym procesem, inny niż źródło. Cel zakończony (`exited`) –
  nieaktywny.
- Upuszczenie: `sessionHandoff` → `handoffText` → `paste` do uchwytu terminala celu
  (`registerTerminal` już je trzyma) → fokus celu. Kulka „wsiąka” w cel (skala do 0 +
  jednorazowa fala `box-shadow` jak przy końcu pracy). **Żadnego `\r`.**
- Komunikaty: sukces – toast „Wklejono kontekst z „X” – dopisz polecenie i wciśnij Enter”;
  `None` / błąd – toast „Nie udało się odczytać rozmowy „X””, nic nie wklejamy.
  Zdarzenie w „Na żywo”: „przekazano kontekst X → Y”.
- Panel źródłowy i kolejność paneli bez zmian.

Podgląd na mocku (mock zwraca stały `Handoff`), zrzut wklejonego tekstu w panelu powłoki.

**Commit:** `M4 Etap 4: przekazanie kontekstu`

## Etap 5 (C + użytkownik) – sprawdzenie w oknie

`pnpm desktop`, prawdziwe claude i pi: płynność kulki na WebKitGTK (programowe rysowanie),
czy canvas xterm przeżywa zamianę (brak migania, brak utraty treści), jak claude i pi
przyjmują wklejenie 8000 znaków (czy pi zbiera bracketed paste, czy nie wysyła w środku),
czy `Shift` nie wpada do terminala w trakcie lotu. Wyniki i poprawki w `HANDOFF.md`.

---

## Poza M4 (nie rób)

Wstawianie między panele, własne proporcje komórek, przeciąganie panelu na projekt w szynie
(przeniesienie między projektami – proces zostaje, zmienia się cwd? do ustalenia), streszczenie
przez LLM, przekazanie z bufora terminala dla paneli bez rozmowy, przekazanie do wielu paneli naraz.
