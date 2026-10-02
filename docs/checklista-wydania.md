# Checklista wydania (sprawdzenia ręczne w oknie)

Zebrane 2026-10-02 z otwartych punktów `HANDOFF.md`, `docs/plan-m3.md` i `docs/plan-pliki-git.md`.
Odhaczaj tutaj, a wynik dopisuj do `HANDOFF.md`. Nic z tego nie zostało jeszcze sprawdzone w prawdziwym oknie.
AGENTS.md zabrania agentowi uruchamiania okna, więc robi to użytkownik.

## 0. Po zmianie nazwy na Roost (AppImage)

- [ ] `pnpm electron:dist`, start zainstalowanego `Roost-<wersja>.AppImage` (start, splash, tytuł okna)
- [ ] migracja `~/.config/dev.majke.agents` → `dev.majke.roost`: stary katalog zostaje, układ i presety są
- [ ] zapisane wcześniej klucze API nadal działają (`safeStorage`, nazwa `userData` bez zmian)
- [ ] ikona i `StartupWMClass` w menu / na pasku zadań (KDE)

## 1. Terminale i siatka (M1/M2)

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

## 2. Czat (M3 etap 8)

- [ ] rozmowa z lokalnym modelem (llama-server :8080, FreeToken :1919), Stop w trakcie
- [ ] Claude z subskrypcji: nowa rozmowa, kontynuacja po restarcie aplikacji
- [ ] ChatGPT z subskrypcji: to samo
- [ ] API (OpenRouter albo Anthropic): klucz zapisany, po restarcie działa, nie ma go w plikach JSON
- [ ] zmiana modelu w środku rozmowy (lokalny → Claude → lokalny) – kontekst przechodzi
- [ ] przełączanie Code | Czat nie przerywa agentów w siatce, terminale po powrocie mają dobry rozmiar
- [ ] długa odpowiedź z kodem – płynne przewijanie, CPU w normie
- [ ] czytelność w jasnych motywach
- [ ] „Szukaj w sieci” z Claude, ChatGPT i modelem lokalnym: źródła i przypisy klikalne

## 3. Konta

- [ ] „Konta” → dodaj konto Claude (`~/.claude-test`) → „Zaloguj” → w panelu ekran logowania, po zalogowaniu panel działa
- [ ] „Nowy panel” pokazuje rząd „Konto”; panel na koncie ma plakietkę; restart aplikacji wznawia rozmowę na właściwym koncie
- [ ] statusline na koncie: po odpowiedzi claude w panelu konta pojawia się blok w „Pulpicie” z nazwą konta (i znika `Brak danych`)
- [ ] pasek limitu: wymuś (np. podmień `claude-limits.<id>.json` na `pct: 100`, `resetsAt` w przyszłości) → pasek w panelu, „Poczekam” go chowa
- [ ] „Kontynuuj gdzie indziej” (ikona ⇄): panel na innym koncie startuje, streszczenie wkleja się bez Entera, stary panel zostaje
- [ ] cel Codex: `CODEX_HOME` z własnym kontem, panel działa; MCP bota (M5 Etap 5) nie jest przez to gubiony
- [ ] okno „Konta”, rząd „Konto” w „Nowy panel”, pasek limitu i bloki w Pulpicie wyglądają dobrze w jasnym i ciemnym motywie (wizualnie nieoglądane)
- [ ] własna linia statusu w `settings.json` konta wyłącza limity tego konta (bez błędu)

## 4. Bot (M5 etap 11)

- [ ] Kreator → „zrób mi bota, który co rano przegląda newsy o Ruście i mówi jak pirat” → najwyżej 3 pytania, potem karta zgody z podglądem bota (nie JSON)
- [ ] „Zezwól raz” → bot od razu na liście, pod kartą narzędzia „Porozmawiaj z …” otwiera jego powitanie
- [ ] zadanie od Kreatora jest w karcie bota → Harmonogram, **wyłączone**
- [ ] „zrób <bota> mniej gadatliwym” → podgląd z wyróżnionym polem „Styl”, po zgodzie zmiana widoczna w karcie bota
- [ ] „Odrzuć” przy `bot_create` → bot nie powstaje, Kreator pyta, co zmienić
- [ ] claude (subskrypcja): bot czyta plik z folderu bez pytania, `bash` pyta o zgodę
- [ ] ChatGPT / codex (subskrypcja): to samo
- [ ] model lokalny (llama-server z `--jinja`): wywołania narzędzi; bez `--jinja` – nagłówek „bez narzędzi”
- [ ] API (OpenRouter / Anthropic), jeśli masz klucz
- [ ] zgoda: Enter = „Zezwól raz”, Esc = „Odrzuć”; „Zezwalaj w tej rozmowie” nie pyta drugi raz o to samo polecenie
- [ ] odmowa: bot nie próbuje obejść jej innym narzędziem, pyta, co dalej
- [ ] Stop w trakcie czekania na zgodę: karta znika, rozmowa kończy się bez błędu
- [ ] „zapamiętaj, że wolę krótkie odpowiedzi” → w karcie bota → Pamięć widać wpis; w **nowej** rozmowie bot odpowiada krótko
- [ ] zadanie wymagające wielu kroków → bot zapisuje skill (karta → Skille, autor „bot”); podobne zadanie w nowej rozmowie → bot czyta skill (`skill_view`)
- [ ] import skilla z `~/.claude/skills` w karcie bota; okno wyboru obrazka awatara i folderu
- [ ] nowe zadanie „co 5 minut”, polecenie bez zapisu plików → przez godzinę: przebiegi z zegarem na liście rozmów, CPU w spoczynku między przebiegami (`top`), powiadomienie po każdym przebiegu przy oknie bez fokusu, brak przy oknie w fokusie
- [ ] kliknięcie powiadomienia przywraca okno i otwiera przebieg (KDE: czy powiadomienie ma przycisk/klik „Otwórz”)
- [ ] zadanie z poleceniem spoza listy zgód (np. „uruchom `ls ~`”) → powiadomienie „Czeka na twoją zgodę” także przy oknie w fokusie; kliknięcie otwiera przebieg z kartą zgody; po zgodzie przebieg kończy się
- [ ] „Uruchom teraz” na wyłączonym zadaniu działa; włączenie zadania po jego godzinie nie uruchamia go od razu
- [ ] zamknięcie aplikacji w trakcie przebiegu → po starcie przebieg oznaczony „Przerwane…”; zaległe zadanie dzienne rusza raz po starcie
- [ ] uśpienie komputera w trakcie zadania „co 5 minut” → po wybudzeniu jeden przebieg, nie seria
- [ ] Ctrl+R (przeładowanie) przy pracującym przebiegu: przebieg pracuje dalej, jego prośba o zgodę wraca na liście
- [ ] Code ↔ Czat ↔ Bot (Ctrl+Alt+C) przy pracujących agentach w panelach i odpowiadającym bocie: nic nie przerywa się, odpowiedź bota dopływa w tle
- [ ] dwa boty odpowiadają naraz; kropki „pracuje” / „czeka na zgodę” przy właściwych botach
- [ ] wygląd zakładki Bot i karty bota w kilku motywach (jasny, ciemny, Kreślarnia, Pulpit95)

## 5. Głos

- [ ] mikrofon i echo z głośników vs słuchawki; przerywanie odpowiedzi
- [ ] Piper (`piper-tts`, model `.onnx`): „Posłuchaj” i cała rozmowa
- [ ] scenariusz: omówienie pomysłu → „OK, deploy” → panele dostają zadania
- [ ] narzędzia rozmówcy z prawdziwym modelem i na claude/codex CLI (karta zgody)

## 6. Panel plików z gitem (plan-pliki-git etap 5)

- [ ] duże repozytorium: czas odświeżania; nazwy ze spacjami i polskimi literami; rename
- [ ] konflikt po nieudanym pull; praca równoległa z agentem piszącym pliki
- [ ] wygląd w jasnym i ciemnym motywie

## 7. Motywy

- [ ] TUI claude/pi na jasnych motywach (Kreślarnia, Metro, Konstelacja, Składanka, Zeszyt, Shōnen) i na Ciemni / E-papierze
- [ ] Mgławica i Wieża przy wielu panelach (koszt GPU, czytelność radaru)
