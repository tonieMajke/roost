# Plan M2 – wygląd

M1 działa i jest sprawdzone w oknie (2026-09-30). M2 zmienia wygląd, bez nowych funkcji.
Jedyny wyjątek to etap 7 (dławienie zapisu do terminala) z pomiaru obciążenia.

## Kierunek

**Ten sam język wizualny co Pi Code** (`~/Documents/Pi/pi-gui`, zrzuty w `docs/screenshots/`).
Powód: w M3 czat z Pi Code ma wejść jako zakładka tej aplikacji, więc obie części muszą
wyglądać jak jedna. Z Pi Code bierzemy:

- tokeny kolorów z `pi-gui/src/styles.css`: ciepłe szarości (`--bg #262624`, `--bg-side
  #1f1e1d`, `--surface`, `--hover`, `--border` jako rgba), akcent `#d97757`, `--ok`, `--err`,
  `--shadow`, i to samo w jasnym motywie;
- fonty: Inter (UI) i JetBrains Mono (terminal, już jest);
- ikony: `lucide-react`, 16 px, obrys 1,75;
- klawisze w podpowiedziach jako „klawisze” (`<kbd>` w ramce, jak `Esc stop` w Pi Code);
- gęstość: szyna jak lista sesji w Pi Code (wiersze ~32 px, nazwa + szary podpis).

Tego nie kopiujemy: czatu, kart, dużych zaokrągleń (`--radius: 12px` jest za duże na
nagłówki paneli; panele 8 px, przyciski 6 px).

## Kto robi

| Etap | Kto | Dlaczego |
|---|---|---|
| 1 tokeny, fonty, motyw | lokalny model | mechaniczne, jasna specyfikacja |
| 2 ikony | lokalny model | mechaniczne |
| 3 szyna | Claude | ocena na oko |
| 4 panel i siatka | Claude | ocena na oko |
| 5 okna i komunikaty | Claude | ocena na oko |
| 6 terminal | Claude + użytkownik | tylko w oknie Tauri (WebKitGTK) widać prawdę |
| 7 dławienie zapisu | lokalny model, przegląd Claude | asynchroniczne, łatwo o błąd |

Na koniec każdego etapu, który robi Claude: **zrzut ekranu z okna Tauri od użytkownika**
(podgląd w przeglądarce renderuje inaczej niż WebKitGTK z renderowaniem programowym).
Zasady z `AGENTS.md` obowiązują bez zmian: jeden etap = jeden commit, wszystkie sprawdzenia.

## Postęp

- [ ] Etap 1 – tokeny, fonty, jasny i ciemny motyw
- [ ] Etap 2 – ikony
- [ ] Etap 3 – szyna projektów
- [ ] Etap 4 – nagłówek panelu i siatka
- [ ] Etap 5 – okna, komunikaty, puste stany
- [ ] Etap 6 – terminal
- [ ] Etap 7 – dławienie zapisu do terminala

---

## Etap 1 – tokeny, fonty, jasny i ciemny motyw

Zależność: `pnpm add @fontsource-variable/inter@^5.3.0` (ta sama co w Pi Code).

- `src/styles.css`: zastąp obecne `:root` tokenami z Pi Code (lista nazw jak w
  `pi-gui/src/styles.css`, bez `--bubble`, `--add-*`, `--del-*`, `--serif`). Dopisz
  `--radius-pane: 8px`, `--radius-control: 6px`. Każdy kolor w pliku idzie przez token –
  po etapie `grep -nE '#[0-9a-fA-F]{3,8}' src/styles.css` zwraca tylko linie z definicjami
  tokenów.
- Motyw: ciemny domyślnie, jasny przez `@media (prefers-color-scheme: light)` oraz
  `:root[data-theme="light"|"dark"]` (ręczny wybór wygrywa z systemem).
- Wybór motywu w `workspace.json`: pole `ui: { theme: "system" | "light" | "dark" }`,
  akcja `setTheme` w `reduce`, `parseWorkspace` akceptuje brak pola (= `"system"`)
  i odrzuca złą wartość z błędem. Testy vitest dla obu.
- `src/theme.ts` (czyste): `terminalTheme(mode: "light" | "dark")` → obiekt `ITheme`
  dla xterm: tło = `--bg`, tekst = `--text`, kursor = akcent, zaznaczenie = `--accent-soft`,
  16 kolorów ANSI dobranych do tła (ciemny: jak w Pi Code w bloku kodu; jasny: ciemniejsze
  odcienie, kontrast ≥ 4,5:1 do tła – test liczy kontrast).
- `Terminal.tsx`: motyw z `terminalTheme`, zmiana motywu podmienia `x.options.theme`
  **bez** restartu procesu.
- Przełącznik: przycisk tekstowy w stopce szyny „Motyw: systemowy / ciemny / jasny”
  (klik = następny). Bez skrótu: Ctrl+Alt+T otwiera terminal w KDE i GNOME. Etap 3
  zamieni go na ikonę.

**Commit:** `M2 Etap 1: tokeny, fonty, jasny i ciemny motyw`

## Etap 2 – ikony

Zależność: `pnpm add lucide-react@^1.47.0` (ta sama co w Pi Code).

Zamień znaki na ikony (16 px, `strokeWidth={1.75}`, `aria-hidden`, przycisk dostaje
`aria-label` + `title` ze skrótem, np. „Zamknij panel (Ctrl+Alt+W)”):

| Teraz | Ikona |
|---|---|
| ✕ (panel, projekt, preset) | `X` |
| ⟳ | `RotateCw` |
| ⤢ / przywróć | `Maximize2` / `Minimize2` |
| + (nowa rozmowa) | `MessageSquarePlus` |
| + (projekt na szynie) | `FolderPlus` |
| „+ Panel” | `Plus` + tekst |
| „Presety” | `LayoutGrid` + tekst |

„Na pewno?” zostaje tekstem. Przyciski-ikony: 24×24 px, bez ramki, tło `--hover` po najechaniu.
Wspólny komponent `src/IconButton.tsx`.

**Commit:** `M2 Etap 2: ikony`

## Etap 3 – szyna projektów (Claude)

- Nagłówek szyny jak w Pi Code: nazwa aplikacji, przycisk zwijania szyny (`PanelLeft`,
  Ctrl+Alt+B, stan w `workspace.json` `ui.rail`).
- Wiersz projektu ~32 px: numer (Ctrl+Alt+1…9) jako `<kbd>`, nazwa, pod nią szara ścieżka
  `~/...` (skrócona od lewej), kropka „nieprzeczytane”. Aktywny projekt: tło `--active`.
- Wiersze paneli pod projektem: ikona agenta (pierwsza litera w kółku albo ikona
  z `agents.json` – decyzja przy etapie), kropka stanu, wcięcie.
- Zwinięta szyna (48 px): tylko numery projektów z kropkami.
- Stopka szyny: przełącznik motywu (`Sun`/`Moon`/`Monitor`).

## Etap 4 – nagłówek panelu i siatka (Claude)

- Odstęp między panelami 6 px, tło siatki `--bg-side`, panel `--bg` z `--radius-pane`.
- Fokus: obramowanie akcentem 1 px + delikatny cień; panel bez fokusu – przygaszony
  nagłówek, terminal bez zmian (czytelność).
- Nagłówek 28 px: ikona agenta, nazwa, kropka stanu, szary podpis (czas od ostatniej
  aktywności albo „kod 1”), narzędzia po prawej widoczne w całości tylko na panelu
  z fokusem albo po najechaniu.
- Proces zakończony: w dole terminala pasek „Proces zakończony (kod 1) · Uruchom
  ponownie (Ctrl+Alt+R)” zamiast samej szarej linii w xtermie.
- Maksymalizacja: pasek u góry „Panel 2 z 4 · Przywróć (Ctrl+Alt+Enter)”.

## Etap 5 – okna, komunikaty, puste stany (Claude)

- Jeden komponent okna (`Dialog`) dla „Nowy panel” i „Presety”: cień `--shadow`,
  animacja wejścia 120 ms (wyłączona przy `prefers-reduced-motion`), podpowiedzi
  klawiszy jako `<kbd>`.
- Komunikaty (`notice`) i błędy konfiguracji jako „toast” w prawym dolnym rogu
  zamiast paska nad siatką; błędy zostają do zamknięcia, komunikaty znikają po 5 s.
- Pusty start („Dodaj folder projektu”) i pusty projekt: ikona, jedno zdanie,
  przyciski, lista skrótów w `<kbd>`.

## Etap 6 – terminal (Claude + użytkownik, w oknie Tauri)

- Czarny pasek pod xtermem (zgłoszony od etapu 5 M1): znaleźć przyczynę w oknie
  (zwykle reszta z dzielenia wysokości przez wysokość wiersza) – wyrównać tło
  kontenera do tła terminala i dodać wewnętrzny margines 4–6 px.
- Pasek przewijania xtermu w kolorach motywu, cienki.
- Rozmiar czcionki terminali: Ctrl+Alt+= / Ctrl+Alt+- / Ctrl+Alt+0, jeden dla wszystkich
  paneli (zapis w `ui.fontSize`, 10–20 px). Zwykłe Ctrl+= zostaje dla agentów.
- Sprawdzenie na zrzutach: TUI claude i pi w ciemnym i jasnym motywie (kolory ANSI
  z etapu 1 w praktyce).

## Etap 7 – dławienie zapisu do terminala

Pomiar z M1: 16 × 20 MB naraz zacina UI. Cel: UI odpowiada (klik w inny panel < 200 ms)
przy tym samym teście.

- `src/write-queue.ts` (czyste, testowalne z fałszywym zegarem): kolejka kawałków na
  panel; zapis do xterm paczkami, następna paczka dopiero w callbacku `x.write(data, cb)`;
  limit paczki 64 KB.
- Panel w schowanej siatce (`clientWidth === 0`) zbiera dane i zapisuje je rzadziej
  (np. co 250 ms), ale **nic nie gubi**.
- Bez limitu rozmiaru kolejki w tym etapie. Pomiar zapisuje szczytową długość kolejki;
  jeśli przekroczy ~50 MB, osobny etap doda wstrzymywanie czytania PTY po stronie Rusta.
- Aktywność (etap 9 M1) nadal liczy wyjście w chwili przyjścia, nie zapisu.
- Test: vitest dla kolejki; ręcznie powtórzony pomiar 16 × 20 MB w oknie, czas zapisany
  w HANDOFF.

**Commit:** `M2 Etap 7: dławienie zapisu do terminala`

---

## Poza M2 (nie rób)

Zakładka Chat (M3), nowe funkcje z listy „Później” w `PLAN.md`, własne proporcje paneli,
przeciąganie paneli, ikony agentów z plików graficznych.
