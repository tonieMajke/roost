# HANDOFF

Najnowszy wpis na górze. Każdy etap z `docs/plan-m1.md` dopisuje tu 3–8 linii.

## Konta agentów (gałąź `konta-etapy`, worktree `.claude/worktrees/konta`) – 2026-10-01 (Claude)

Plan: `docs/plan-konta.md` (etapy 1–5 zrobione i zacommitowane, 6 = ten wpis). Praca poszła w osobnym worktree, bo w głównym katalogu równolegle szło M5 – przed scaleniem do `master` trzeba rozwiązać konflikty w `App.tsx`, `Pane.tsx`, `Grid.tsx`, `backend*.ts`, `main.ts`, `handlers.ts`, `styles.css` (obie strony je dotykają).

- `src/accounts.ts`: `AccountDef {id, name, kind, dir}`, `parseAccounts`, `resolveAccount`, `pickAccountId`, `accountEnv`; `accounts.json` przez `accounts_load/save` (pliku nie tworzymy bez konta). Okno „Konta” (`AccountsDialog`).
- Konto w panelu: `Pane.account` (zapis w `workspace.json`), wybór w „Nowy panel”, `SpawnSpec.env`, plakietka w nagłówku. `claudeSessionExists`, `sessionContext`, `sessionHandoff` biorą folder konta.
- Limity per konto: `claude-limits.<id>.json`, `--settings` ze statusline per konto, bloki w Pulpicie (`limitBlocks`).
- „Kontynuuj gdzie indziej”: `src/continue.ts` (cele), `ContinueDialog`, pasek `limitHit` w panelu. Nowy panel → czekanie na bracketed paste (do 20 s) → istniejące `sendContext`.
- Sprawdzone: testy 486/486, typecheck frontendu i electronu. Sprawdzone na pustych folderach: pusty `CLAUDE_CONFIG_DIR` daje ekran logowania, `CODEX_HOME` czyta własny `config.toml`.
- Luki: Codex jako źródło kontynuacji (brak czytnika sesji), limity tylko dla Claude, streszczenie zawsze przez domyślne konto Claude.

### Do sprawdzenia przez użytkownika (okno aplikacji, drugie konto potrzebne)

- [ ] „Konta” → dodaj konto Claude (`~/.claude-test`) → „Zaloguj” → w panelu ekran logowania, po zalogowaniu panel działa
- [ ] „Nowy panel” pokazuje rząd „Konto”; panel na koncie ma plakietkę; restart aplikacji wznawia rozmowę na właściwym koncie
- [ ] statusline na koncie: po odpowiedzi claude w panelu konta pojawia się blok w „Pulpicie” z nazwą konta (i znika `Brak danych`)
- [ ] pasek limitu: wymuś (np. podmień `claude-limits.<id>.json` na `pct: 100`, `resetsAt` w przyszłości) → pasek w panelu, „Poczekam” go chowa
- [ ] „Kontynuuj gdzie indziej” (ikona ⇄): panel na innym koncie startuje, streszczenie wkleja się bez Entera, stary panel zostaje
- [ ] cel Codex: `CODEX_HOME` z własnym kontem, panel działa; MCP bota (M5 Etap 5) nie jest przez to gubiony
- [ ] okno „Konta”, rząd „Konto” w „Nowy panel”, pasek limitu i bloki w Pulpicie wyglądają dobrze w jasnym i ciemnym motywie (wizualnie nieoglądane)
- [ ] własna linia statusu w `settings.json` konta wyłącza limity tego konta (bez błędu)

## Tła motywów: Mgławica i radar Wieży (2026-10-01, poza planem M5)

- Powód: motywy z makiet A–U miały w kodzie tylko tokeny i CSS, a część makiet to żywa grafika. Zestawienie makieta ↔ `themes.css` pokazało braki w Mgławicy, Biurze, Wieży, Karuzeli, Rtęci oraz układach Rzeka/Metro/Akwarium/Konstelacja.
- **Mgławica** (`811259b`): `Nebula.tsx` (canvas pod `.grids`, tylko motyw `mglawica`) + `nebula.ts` (czysta symulacja). Tempo cząstek ze stanu `st-*` panelu (`rateFor`), kolor z `--ag`, rdzeń w środku, fala po `st-done`. `backdrop-filter` na panelach. Tryb Oszczędny / `prefers-reduced-motion` = jeden statyczny kadr i bez blura; ukryte okno nie rysuje.
- **Wieża** (`811259b`): `Radar.tsx` + `radar.ts` – sekcja „Radar” na górze Pulpitu, tylko motyw `wieza`. Odległość znaku = czas od ostatniego wyjścia (pierścienie 1/5/15 min), kąt stały z id panelu, wołanie `CLA1 041` = agent + kontekst %. Dane: `activity.current` z `App.tsx` przez prop `radar` w `Dock`.
- Sprawdzone: `pnpm typecheck`, `pnpm test` (530 + 4 pominięte), `electron` build. Testowa kopia z osobnym `AGENTS_CONFIG_DIR` i `--user-data-dir` uruchomiona na prośbę użytkownika (wbrew zakazowi z AGENTS.md, bo to użytkownik o to prosił); wygląd **nie** oceniony.
- **Niesprawdzone:** wygląd i koszt GPU Mgławicy przy wielu panelach, czytelność radaru w Pulpicie 300 px.
- Pominięte względem makiet: żółte fale „czeka” i bursztynowy znak CZEKA (brak stanu „czeka na odpowiedź” w aplikacji), napis „N zmian · M plików” w rdzeniu, pasek „SEKTOR/QNH”, **paski lotów** Wieży (lista paneli ze wszystkich projektów po pilności – makieta uznaje je za lepsze od samego radaru). Radar pokazuje tylko aktywny projekt.
- Do zrobienia: **Biuro** (izometryczne SVG z biurkami – ekran powitalny projektu albo widok w Pulpicie, nie tło), reszta tabeli braków. Niezacommitowane zmiany w `electron/src/bot/*`, `main.ts`, `preload.ts`, `src/backend*.ts`, `src/bot*.ts` nie pochodzą z tej pracy.
## Głos Etap 7: rozmówca steruje aplikacją – 2026-10-01 (Claude, gałąź `glos`)

- Użytkownik przetestował etap 5 w oknie: działa; brakowało działania w całej aplikacji. Wybrał: panele, projekty, konta/modele, boty i Czat, postępy („co wymaga uwagi”). Akcje bez skutków bez karty.
- `src/voice/tools.ts` przepisany: `overview` (wszystkie projekty; stan z `ephemeral`, `limitHit`, `paneMeter`, `activity`; „Wymaga uwagi”: padł / limit / skończył i nieprzeczytany / kontekst ≥ 80%), `read_pane`, `show`, `list_agents`, `open_panes` (+ `project`, `account`, `model`), `send_to_pane`, `pane_control` (Esc / restart / nowa rozmowa / zamknij), `continue_elsewhere`, `apply_preset`, `ask_bot` (`askBot.ts`: nowa rozmowa bota zapisana w zakładce Bot, czekanie ≤ 120 s). Usunięte `list_panes`.
- Karta ma `head`/`action` zamiast `kind`. Gospodarz w `App.tsx` (`voiceHost`, `openVoicePanes` przełącza projekt przed dodaniem paneli). Prompt rozmówcy dostaje `overviewText` przy każdym kroku.
- Komunikat „X skończył pracę” (`session.note`): gra w ciszy, w trakcie odpowiedzi czeka; widać go w zapisie rozmowy; echo-ochrona VAD działa też w trakcie komunikatu.
- Sprawdzone: `pnpm typecheck`, `pnpm test` (645 + 9 pominiętych), electron typecheck i build.
- **Niesprawdzone w oknie:** nowe narzędzia z prawdziwym modelem, Esc jako „stop” w pi, `ask_bot` z botem, który prosi o zgodę (czeka w zakładce Bot), wygląd komunikatów w zapisie.

## Głos Etap 5: panele i deploy z rozmowy – 2026-10-01 (Claude, gałąź `glos`)

- `src/voice/tools.ts`: `list_panes`, `open_panes`, `send_to_pane`, `read_pane` na gospodarzu `PaneHost` (w `App.tsx`: panele aktywnego projektu, id = 6 znaków UUID). `open_panes` i `send_to_pane` zawsze przez kartę; odmowa = „użytkownik odmówił”, „Popraw”/inna wypowiedź = poprawka z treścią wraca do modelu.
- Pętla w oknie (`session.ts`, ≤ 8 kroków): `ChatService` przy `req.tools` oddaje wywołania jako `tool_call` przed `done`; drugi krok idzie z `turns`. Tylko dostawcy HTTP (openai/anthropic); przy claude/codex CLI pasek pokazuje „bez paneli”.
- Karta nad kuleczką (`VoiceOrb.tsx`): Uruchom/Popraw/Anuluj. Przy widocznej karcie mowa nie przerywa odpowiedzi, a transkrypt idzie do `cardAnswer` („tak/ok/uruchom”, „nie/anuluj”, reszta = poprawka). Klik w kuleczkę/Esc = anulowanie.
- Deploy: panel → czekanie na bracketed paste (≤ 20 s) → 1,5 s → wklejka → Enter (`TerminalHandle.type("\r")`). `TerminalHandle.tail(n)` czyta bufor xterm.
- Sprawdzone: `pnpm typecheck`, `pnpm test` (637 + 9 pominiętych), electron typecheck i build.
- **Niesprawdzone:** nic nie uruchomione z prawdziwym modelem ani w oknie – czy Qwen/Claude rozpisuje zadania, czy Enter po wklejce startuje claude/pi, wygląd karty.

## Głos: do wdrożenia przez następnego agenta – 2026-10-01 (stan po rozmowie z użytkownikiem, gałąź `glos`)

Użytkownik zbiera więcej zmian i zleci wdrożenie wszystkich naraz innemu agentowi. Tu jest wszystko, co ustalono o głosie. Niczego z tej listy jeszcze nie zrobiono w kodzie.

**Stan środowiska (zrobione, zweryfikowane)**
- Piper zainstalowany z AUR (`piper-tts-bin`). **Binarka nazywa się `piper-tts` (`/usr/bin/piper-tts`), nie `piper`** – `which piper` nic nie zwraca.
- Głosy w `~/.local/share/piper/`: `pl_PL-bass-high.onnx` (+ `.onnx.json`, pobrany z `rhasspy/piper-voices`, `pl/pl_PL/bass/high/`, bo użytkownik miał sam `.onnx`) oraz `pl.onnx` (+ `.json`) = **`gosia` medium**, żeński, skopiowany ze scratchpada sesji `54c6b0d8…`.
- Test z linii poleceń: `echo "Cześć…" | piper-tts --model ~/.local/share/piper/pl_PL-bass-high.onnx --output_file x.wav` → 2,3 s audio w 0,26 s (RTF 0,11), odtworzone `pw-play`. Czy użytkownikowi głos się podoba – **nie wiadomo**.
- Użytkownik wybrał na razie **Piper + `pl_PL-bass-high`** („bass” to nazwa głosu). Przyznał, że głosy Pipera są „średnie” i woli żeńskie – patrz „Później”.

**Do zrobienia w kodzie**
1. **Domyślny program Pipera**: `electron/src/voice/tts.ts:198` ma `p.command ?? "piper"`, a `TalkSettings.tsx:94` placeholder „piper (z PATH)”. Na tym systemie (Arch/AUR) to `piper-tts`. Spróbować `piper-tts`, potem `piper` (albo wykrywać przez PATH), poprawić placeholder i komunikat ENOENT (`tts.ts:115`). Dodać test.
2. **Domyślny model w szablonie** (`src/voice/voice.ts:43`): dziś `~/.local/share/piper/pl_PL-gosia-medium.onnx`, a plik leży jako `pl.onnx` i `pl_PL-bass-high.onnx`. Ustawić na `pl_PL-bass-high.onnx` (wybór użytkownika); ewentualnie wykrywać `*.onnx` w `~/.local/share/piper/` i dać listę do wyboru zamiast wpisywania ścieżki.
3. **Etap 6 – próba na żywo** (nic z tego nie było uruchamiane z prawdziwym Piperem): `cd .claude/worktrees/glos && pnpm build && pnpm desktop`; Głos → Rozmowa → silnik Piper, program `piper-tts`, model `~/.local/share/piper/pl_PL-bass-high.onnx` → „Posłuchaj” (głos słychać, czas syntezy pokazany) → potem cała rozmowa z kuleczki (mikrofon → whisper → mózg → Piper). Sprawdzić też „Mam słuchawki” i silnik API/lokalny. AGENTS.md zabrania uruchamiania Electrona bez prośby – użytkownik poprosi o to wprost albo wskaże, kiedy wolno.
4. Po teście: zaktualizować ten HANDOFF o wynik i scalić `glos` do `konta` (merge tylko na wyraźne polecenie użytkownika).

**Później (opcjonalnie, użytkownik nie zdecydował)**
- Lepszy głos żeński po polsku przez silnik „API” (bez zmian w kodzie, adres + model w Rozmowie): OpenAI `gpt-4o-mini-tts` (`nova`/`shimmer`/`coral`, wymaga klucza), Edge TTS `pl-PL-ZofiaNeural` przez serwer `openai-edge-tts` (darmowy, nieoficjalny, chmura), lokalnie XTTS-v2 (klonowanie głosu, najlepiej na GPU) np. przez `openedai-speech`. Użytkownik pytał, gdzie odsłuchać: `openai.fm`, demo Azure TTS, HF Space `coqui/xtts` (adresów nie sprawdzałem). Nie wiem, czy ma klucz OpenAI ani GPU – zapytać.
- Piper ma w PL tylko głosy `darkman`, `gosia`, `mc_speech`, `bass` i inne męskie (z pamięci, nie sprawdzone).

## Głos Etap 4: ustawienia rozmowy – 2026-10-01 (Claude, gałąź `glos`)

- Okno „Głos” (`VoiceDialog.tsx`) ma zakładki **Dyktowanie | Rozmowa**; treść dyktowania bez zmian (dopisek: mikrofon i język obowiązują też w rozmowie). Rail → mikrofon i mikrofon panelu otwierają „Dyktowanie”, zębatka kuleczki „Rozmowę”, błąd kuleczki otwiera zakładkę, której brakuje.
- `src/voice/TalkSettings.tsx`: mózg (modele z Czatu z wykrytymi `discover`, grupa CLI z dopiskiem „bez narzędzi, wolniejszy start”, domyślnie pierwszy model), silniki mowy (szablony OpenAI / Lokalny serwer / Piper; `speech`: adres, model, klucz; `piper`: program, plik `.onnx`), głos/mówca, „Posłuchaj” (synteza przez `voiceSpeak` + czas), „Mam słuchawki”. Zapis od razu do `voice.json`/`tts.json`.
- `resolveBrain` (`voice.ts`): model wykryty przez `GET /models` działa także jako mózg, choć nie ma go w `chat.json`.
- Kuleczka ma `z-index: 19` (pod `.overlay`): okno ustawień ją przykrywa.
- Sprawdzone w ukrytym oknie Electrona na mocku: zakładka „Rozmowa”, Posłuchaj (ton z mocka, czas syntezy). Sprawdzenia: typecheck, `pnpm test` (571 + 1 pominięty), electron typecheck + build – przechodzą.
- Niesprawdzone: „Posłuchaj” z prawdziwym Piperem/API, klucz TTS w sejfie na żywo.

## Głos Etap 3: kuleczka i rozmowa na żywo – 2026-10-01 (Claude, gałąź `glos`)

- Zmiana planu: VAD własny po energii (`src/voice/vad.ts`) zamiast `@ricky0123/vad-web` (ładuje `.onnx`/`.wasm` przez `fetch`, a strona stoi na `file://`). Próg = szum tła × 3, 300 ms kalibracji, start po 60 ms mowy, koniec po 600 ms ciszy, < 240 ms = szum; w trakcie odtwarzania (bez słuchawek) próg × 6 i start po 160 ms. Preroll 300 ms, wypowiedź → WAV 16 kHz → istniejące `sttTranscribe(…, "audio/wav")`.
- `src/voice/session.ts` (`VoiceSession`, bez DOM): transkrypcja → `chatSend` (`voiceRequest`: HTTP = `messages`, CLI = `prompt` z całą rozmową, bez sesji) → `splitSentences` → `speakable` → `voiceSpeak` od razu dla każdego zdania, granie po kolei. Mowa albo klik w trakcie odpowiedzi = Stop mózgu, `voiceCancel` zdań, cisza. Bez silnika TTS odpowiedź jest tylko tekstem.
- `src/voice/audio.ts`: `Mic` (AudioContext 16 kHz, AudioWorklet z blob, echo/szum/AGC), `Player` (`decodeAudioData`, `AnalyserNode`). `useVoiceSession.ts` czyta `stt.json`/`voice.json`/`tts.json`/`chat.json` raz na start (mózg = `voice.json.brain` albo pierwszy model z Czatu).
- `VoiceOrb.tsx` + `voice.css`: pasek z kuleczką w prawym dolnym rogu (skala z głośności co klatkę przez `--lvl`, oddech/obrót/pierścień wg stanu, `prefers-reduced-motion` i `motion-lite`), wycisz, zapis rozmowy z czasami kroków (`exchangeTimes`), ustawienia, Zakończ (Esc). Przycisk „Rozmowa głosowa” w stopce Raila. Backend: `voiceConfig`, `ttsConfig`, `voiceSpeak`… (mock: cichy ton długości zdania).
- Sprawdzone w ukrytym oknie Electrona poza ekranem (offscreen, wyciszone, sztuczny mikrofon z pliku WAV mowy z Pipera, podgląd na mocku): słucha → słyszy → myśli → mówi, czasy w zapisie; stan błędu bez silnika transkrypcji. Zrzuty w motywie D.
- Sprawdzenia: typecheck, `pnpm test` (570 + 1 pominięty), electron typecheck + build – przechodzą.
- Niesprawdzone: prawdziwy mikrofon i echo z głośników, VAD w hałasie, cała pętla z prawdziwym whisperem/Claude/Piperem, jasne motywy. Kuleczka nie jest przeciągalna (plan mówił „przeciągalna”).

## Głos Etap 2: silniki TTS – 2026-10-01 (Claude, gałąź `glos`)

- `electron/src/voice/tts.ts`: `speakHttp` (`POST {baseUrl}/audio/speech`, JSON, `response_format: "wav"`, tekst w jednej linii, limit 4000 znaków), `Piper` (jeden proces `--output_dir` na rozmowę: linia → ścieżka WAV na stdout, odpowiedzi po kolei; przerwane zdanie czeka i jest wyrzucane; śmierć procesu odrzuca czekające z ostatnią linią stderr), `TtsService` (silnik i głos czytane z `tts.json`/`voice.json` przy każdym zdaniu, Piper wymieniany po zmianie programu/modelu/głosu).
- Silnik Piper ma pole `command` (domyślnie `piper` z PATH, `~` rozwijane); głos liczbowy = `--speaker`.
- IPC w `main.ts`: `tts_config(_save)`, `tts_key_status`, `tts_set_key` (sejf `tts-<id>`), `voice_config(_save)`, `voice_speak(reqId, text)` → bajty audio, `voice_cancel`, `voice_end`. Przeładowanie strony i wyjście zamykają Pipera.
- Testy: serwer HTTP i atrapa `fixtures/fake-piper.mjs` (kolejność, abort w środku kolejki, śmierć procesu, brak programu/modelu, `close` zabija proces). `tts-live.test.ts` z prawdziwym Piperem przy `AW_PIPER` + `AW_PIPER_MODEL`: przeszedł na wydaniu 2023.11.14-2 z `pl_PL-gosia-medium` (199 ms ze startem, 154 ms drugie zdanie).
- Sprawdzenia: typecheck, `pnpm test` (551 + 1 pominięty na żywo), electron typecheck + build – przechodzą.
- Niesprawdzone: `/audio/speech` na żywo (OpenAI, speaches, Kokoro); strona jeszcze nie woła `voice_*` (etap 3). Piper nie jest zainstalowany w systemie (test na wydaniu w katalogu tymczasowym).

## Głos Etap 1: logika rozmowy – 2026-10-01 (Claude, gałąź `glos`, eksperyment z `docs/plan-glos.md`)

- `src/voice/voice.ts`: `parseTtsConfig` (`tts.json`, silniki `speech` = `/audio/speech` i `piper`, szablony OpenAI / lokalny / Piper, klucze `tts-<id>`), `parseVoiceConfig` (`voice.json`: mózg `ModelRef`, silnik TTS, głos, słuchawki).
- `splitSentences(buffer, final)`: zdania ze strumienia dla TTS. Granica wymaga białego znaku po sobie, skróty („np.”, „m.in.”), inicjały i liczebniki nie tną, w bloku kodu nie tnie, zdanie > 200 znaków tnie na przecinku. Test: strumień kawałkami = całość.
- `speakable(md)`: markdown → tekst do czytania (kod pominięty, linki = opis, bez emoji).
- `voiceReducer`: stany `idle/listening/transcribing/thinking/speaking`, przerwanie zostawia tylko zagrane zdania, zdarzenia mają numer wymiany (spóźnione z przerwanej odpowiedzi są ignorowane), transkrypt w trakcie dalszego mówienia dokleja się do następnego. Znaczniki czasu kroków w `VoiceExchange.t`.
- `voiceTurns` / `voiceCliPrompt` / `voicePrompt` (krótkie odpowiedzi mową; z listą paneli opisuje `open_panes`).
- Sprawdzenia: typecheck, `pnpm test` (51 plików, 544 testy; 25 nowych w `src/voice/voice.test.ts`), electron typecheck + build – przechodzą.
- Niesprawdzone: nic z tego nie jest jeszcze podpięte (etapy 2–3).

## Dyktowanie głosem (2026-10-01, poza planem M5)

- Mikrofon w nagłówku każdego panelu (`Pane.tsx`, `useDictation.ts`): klik = nagrywa, drugi klik = transkrypcja, tekst wchodzi do terminala wklejką **bez Entera**. Rail → „Dyktowanie” (`VoiceDialog.tsx`) wybiera silnik.
- Silnik = serwer z `POST {baseUrl}/audio/transcriptions` (`electron/src/stt.ts`): szablony OpenRouter, cortecs.ai, OpenAI i „Lokalny serwer” (whisper.cpp / speaches), adres i model edytowalne. Konfiguracja w `stt.json`, klucze w sejfie jako `stt-<id>`.
- Sprawdzone: `pnpm typecheck`, `pnpm test` (508), `(cd electron && npm run typecheck && npm run build)`. Testy z prawdziwym serwerem HTTP w `electron/src/stt.test.ts`.
- **Niesprawdzone** (AGENTS.md zabrania uruchamiania Electrona): prawdziwy mikrofon w Electronie na Wayland/KDE, wygląd przycisku w motywach, żywe API.
- Mowa Wszędzie nie jest zależnością: jej lokalny faster-whisper to demon D-Bus bez HTTP, więc lokalnie trzeba postawić serwer zgodny z OpenAI.

## Do sprawdzenia przez użytkownika (w oknie Tauri, po etapie 11)

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

## M5 Etap 11: sprawdzenie w oknie – lista dla użytkownika (2026-10-01)

Przed sprawdzeniem: zamknij aplikację i przebuduj AppImage (`pnpm electron:dist` → `electron/release/Agents-0.0.1.AppImage`) – obecny jest sprzed etapów 9–10. Uwagi zapisuj przy punktach; poprawki wchodzą do commitu `M5 Etap 11: sprawdzenie w oknie`.

**Kreator**
- [ ] Kreator → „zrób mi bota, który co rano przegląda newsy o Ruście i mówi jak pirat” → najwyżej 3 pytania, potem karta zgody z podglądem bota (nie JSON)
- [ ] „Zezwól raz” → bot od razu na liście, pod kartą narzędzia „Porozmawiaj z …” otwiera jego powitanie
- [ ] zadanie od Kreatora jest w karcie bota → Harmonogram, **wyłączone**
- [ ] „zrób <bota> mniej gadatliwym” → podgląd z wyróżnionym polem „Styl”, po zgodzie zmiana widoczna w karcie bota
- [ ] „Odrzuć” przy `bot_create` → bot nie powstaje, Kreator pyta, co zmienić

**Rozmowa z narzędziami – każdy rodzaj dostawcy**
- [ ] claude (subskrypcja): bot czyta plik z folderu bez pytania, `bash` pyta o zgodę
- [ ] ChatGPT / codex (subskrypcja): to samo
- [ ] model lokalny (llama-server z `--jinja`): wywołania narzędzi; bez `--jinja` – nagłówek „bez narzędzi”
- [ ] API (OpenRouter / Anthropic), jeśli masz klucz
- [ ] zgoda: Enter = „Zezwól raz”, Esc = „Odrzuć”; „Zezwalaj w tej rozmowie” nie pyta drugi raz o to samo polecenie
- [ ] odmowa: bot nie próbuje obejść jej innym narzędziem, pyta, co dalej
- [ ] Stop w trakcie czekania na zgodę: karta znika, rozmowa kończy się bez błędu

**Pamięć i skille**
- [ ] „zapamiętaj, że wolę krótkie odpowiedzi” → w karcie bota → Pamięć widać wpis; w **nowej** rozmowie bot odpowiada krótko
- [ ] zadanie wymagające wielu kroków → bot zapisuje skill (karta → Skille, autor „bot”); podobne zadanie w nowej rozmowie → bot czyta skill (`skill_view`)
- [ ] import skilla z `~/.claude/skills` w karcie bota; okno wyboru obrazka awatara i folderu

**Harmonogram**
- [ ] nowe zadanie „co 5 minut”, polecenie bez zapisu plików → przez godzinę: przebiegi z zegarem na liście rozmów, CPU w spoczynku między przebiegami (`top`), powiadomienie po każdym przebiegu przy oknie bez fokusu, brak przy oknie w fokusie
- [ ] kliknięcie powiadomienia przywraca okno i otwiera przebieg (KDE: czy powiadomienie ma przycisk/klik „Otwórz”)
- [ ] zadanie z poleceniem spoza listy zgód (np. „uruchom `ls ~`”) → powiadomienie „Czeka na twoją zgodę” także przy oknie w fokusie; kliknięcie otwiera przebieg z kartą zgody; po zgodzie przebieg kończy się
- [ ] „Uruchom teraz” na wyłączonym zadaniu działa; włączenie zadania po jego godzinie nie uruchamia go od razu
- [ ] zamknięcie aplikacji w trakcie przebiegu → po starcie przebieg oznaczony „Przerwane…”; zaległe zadanie dzienne rusza raz po starcie
- [ ] uśpienie komputera w trakcie zadania „co 5 minut” → po wybudzeniu jeden przebieg, nie seria
- [ ] Ctrl+R (przeładowanie) przy pracującym przebiegu: przebieg pracuje dalej, jego prośba o zgodę wraca na liście

**Przełączanie zakładek**
- [ ] Code ↔ Czat ↔ Bot (Ctrl+Alt+C) przy pracujących agentach w panelach i odpowiadającym bocie: nic nie przerywa się, odpowiedź bota dopływa w tle
- [ ] dwa boty odpowiadają naraz; kropki „pracuje” / „czeka na zgodę” przy właściwych botach
- [ ] wygląd zakładki Bot i karty bota w kilku motywach (jasny, ciemny, Kreślarnia, Pulpit95)

## M5 Etap 10: harmonogram w zakładce Bot – 2026-10-01 (Claude, konta)

- Karta bota, zakładka **Harmonogram** (`src/bot/Routines.tsx`): zadanie = przełącznik, nazwa, `scheduleLabel`, „następne: dziś/jutro/pn 5 paź 08:00” (`runWhen`, `routineNext`), ostatni przebieg z pierwszym zdaniem wyniku (z 30 najnowszych plików `runs/`; klik zamyka kartę i otwiera przebieg), „pracuje…” / „czeka na twoją zgodę” z `bot_run`. „Uruchom teraz” (`Scheduler.runNow` – przed terminem i wyłączone, kolejka jak zwykle; drugi raz w trakcie = błąd), edycja: nazwa, polecenie, „Codziennie o…” (godzina + dni, żaden/wszystkie = codziennie) albo „Co N minut” (≥ 5), zgody z góry: pisanie w `work/` i prefiksy poleceń. Zapis od razu.
- Włączenie zadania zapisuje `Routine.enabledAt`; termin liczy się od niego, gdy późniejszy niż ostatni przebieg (włączone o 10:00 z terminem 8:00 rusza jutro). `BotStore.routinesSave` bierze późniejszy `lastRun` z dysku i z zapisu – karta otwarta przed przebiegiem nie cofnie terminu.
- Lista rozmów bota: rozmowy i przebiegi razem po dacie, przebieg z ikoną zegara (tarcza z wykrzyknikiem przy „czeka na zgodę”), kropka „pracuje” przy bocie także dla przebiegu; przebiegu w toku nie da się usunąć. Otwarty przebieg odświeża się z dysku po każdym `bot_run`.
- Powiadomienia (`main.ts` → `runNotify`, `runNotice` w `src/bot.ts`): po `done`/`error` tylko gdy okno nie ma fokusu (pierwsze zdanie wyniku bez markdownu albo „Nie udało się: …”), przy `waiting_approval` zawsze. `notify-send -A default=Otwórz` – kliknięcie przywraca okno i wysyła `bot_open_run`; `App.tsx` przełącza na Bot, `BotView` wybiera bota i otwiera przebieg (karta zgody na dole wątku). IPC/preload: `bot_runs`, `bot_run_now`, `bot_run`, `bot_open_run`. Mock: „Uruchom teraz” robi przebieg w 2,5 s.
- Zrzuty (Electron offscreen, mock) w motywach D i Kreślarnia: lista z przebiegami, harmonogram, edycja z dniami, „pracuje…”, po przebiegu, otwarty przebieg. 0 błędów konsoli.
- Sprawdzenia: `pnpm typecheck`, `pnpm test` (59 plików, 644 testy + 9 pominiętych), `electron` typecheck + build – przechodzą.
- Niesprawdzone: prawdziwe powiadomienie i kliknięcie w nie na KDE (`-A` wymaga demona z akcjami), przebieg czekający na zgodę otwarty z powiadomienia (w mocku przebiegi nie proszą o zgodę) – etap 11.

## M5 Etap 9: harmonogram – 2026-10-01 (Claude zamiast lokalnego modelu, za zgodą użytkownika; konta)

- `electron/src/bot/scheduler.ts` (`Scheduler`): zegar co 30 s (`TICK_MS`) + tyknięcie po `powerMonitor` „resume”; każde tyknięcie czyta `routines.json` wszystkich botów i porównuje czas ścienny (`routineDue`/`routineNext` w `src/bot.ts` – od `lastRun`, bez niego od `created`; `lastRun` z przyszłości liczy się jak teraz). Zaległe terminy = jeden przebieg, bo `lastRun` zapisuje się w `routines.json` przy starcie przebiegu (i w pamięci, gdy pliku nie da się zapisać).
- Najwyżej 2 przebiegi w stanie `running`; przebieg „czeka na zgodę” nie zajmuje miejsca (inaczej dwie nocne prośby blokowałyby resztę). Kolejka bez duplikatów zadania.
- Przebieg = rozmowa w `runs/` z `routine`, `title` = nazwa zadania i nowym polem `BotChat.state` (`running` / `waiting_approval` / `done` / `error`, `RUN_STATES`, sprawdzane w `parseBotChat`). Model: `runModel` (model bota albo pierwszy z listy; brak dostawcy = przebieg z błędem bez wywołania). `BotService.send(…, routine)` daje narzędziom `allow` zadania i prompt „# Zadanie z harmonogramu”. Plik zapisywany przy starcie, po każdym wyniku narzędzia, przy zmianie stanu i na końcu.
- `main.ts`: start po `ready`, `stop` przy `will-quit` (trwające zapisane jako przerwane; po twardym zamknięciu `recover` przy następnym starcie oznacza ostatnie 20 przebiegów „w trakcie” jako przerwane). Przeładowanie strony nie przerywa przebiegów (`abortAll(keep)` po prefiksie `run:`) ani ich próśb o zgodę (`denyAll(keep)`). Zmiana stanu → zdarzenie `bot_run` do okna (bez preload – etap 10).
- Testy na sztucznym zegarze i atrapie usługi (`scheduler.test.ts`, 7) + `routineDue`/`runModel`/`state` w `bot.test.ts` + przebieg w `service.test.ts`. Sprawdzenia: `pnpm typecheck`, `pnpm test` (59 plików, 636 testów + 9 pominiętych), `electron` typecheck + build – przechodzą.
- Niesprawdzone: prawdziwy przebieg z modelem i uśpienie komputera w działającej aplikacji (etap 11). Zadanie włączone długo po utworzeniu ruszy od razu, jeśli termin od `created` już minął – etap 10 może przy włączaniu ustawiać `lastRun`. Zapis harmonogramu z UI (etap 10) musi zachować `lastRun`.

## M5 Etap 8: Kreator botów – 2026-10-01 (Claude, konta)

- Prompt Kreatora (`botSystemPrompt`, sekcja „Jak budujesz boty” + „Istniejące boty” z `PromptContext.bots`): najwyżej 3 pytania, potem `bot_create` z pełną definicją, startowymi skillami i zadaniami (wyłączonymi); foldery tylko podane przez użytkownika; `model` pominięty = model rozmowy z Kreatorem (`ToolContext.model` z `service.ts`).
- `tools.ts`: `planCreate`/`planUpdate` sprawdzają definicję **przed** prośbą o zgodę (zła definicja wraca do modelu, użytkownik jej nie widzi; też nieznana grupa narzędzi i dwa skille o tej samej nazwie), `applyPlan` zapisuje po zgodzie. `bot_update` liczy zmienione pola, „nic się nie zmienia” = błąd.
- Karta zgody: `ApprovalRequest.preview` (`BotPreview`) zamiast JSON-a – `src/bot/BotPreview.tsx` (awatar, powitanie, charakter, styl, ton, model, narzędzia, foldery, skille, harmonogram; przy `bot_update` zmienione pola wyróżnione). Po `tool_result` z `bot_create`/`bot_update` lista botów wczytuje się od nowa; pod kartą udanego `bot_create` przycisk „Porozmawiaj z <imię>” (`createdBot`). Mock: Kreator dopytuje, potem proponuje bota „Bosman”.
- Zrzuty (Electron offscreen, mock) w motywach D i Kreślarnia: pytania, zgoda z podglądem, po Enter bot na liście i przycisk, powitanie nowego bota. 0 błędów konsoli.
- Na żywo (`AW_LIVE=1 pnpm vitest run electron/src/bot/creator-live.test.ts`, claude haiku przez most MCP): bot newsowy z harmonogramem (zadanie wyłączone, sieć), bot do przeglądu kodu z folderem projektu, bot-postać bez narzędzi, `bot_update` „Rusty mniej gadatliwy” – 4/4. Za pierwszym razem przy przeglądzie kodu pierwsze `bot_create` wróciło z błędem walidacji, model poprawił się sam (treść błędu niezapisana; test teraz ją wypisuje).
- Sprawdzenia: `pnpm typecheck`, `pnpm test` (53 pliki, 541 testów + 8 na żywo pominiętych), `electron` typecheck + build – przechodzą.
- Niesprawdzone: Kreator na dostawcach HTTP (pętla) i codex; podgląd `bot_update` tylko w teście, bez zrzutu; otwarta karta bota nie odświeża się po `bot_update` Kreatora.

## M5 Etap 7: karta bota – 2026-10-01 (Claude, master)

- `src/bot/BotCard.tsx`: przycisk „Karta bota” w nagłówku (nagłówek widać teraz też przy pustej rozmowie; „Nowy bot” otwiera kartę od razu). Zakładki: **Osobowość** (imię, emoji z listy albo własne, obrazek, kolor, charakter, styl, czego unika, suwak tonu 3 poziomy, podgląd „Tak się przedstawi” z `botGreeting`), **Pamięć** (dwa pola z licznikiem / limitem, zapis każdego osobno), **Skille** (nazwa, opis, kto utworzył, data; podgląd treści w markdownie; usuń z potwierdzeniem; import z `~/.claude/skills`), **Ustawienia** (menu modeli z Czatu – `ModelMenu` wyeksportowane, Esc zamyka samo menu; foldery z okna wyboru; przełączniki 6 grup narzędzi; „Usuń bota” z potwierdzeniem, nie dla Kreatora). Osobowość i ustawienia zapisuje „Zapisz” w stopce.
- `BotStore`: autor skilla w `skills/<nazwa>/.author` (`bot` z `skill_create`/`bot_create`, `user` z karty, `import`), ustawiany tylko przy tworzeniu; `skillSources(dir)` i `skillImport` (kopia całego katalogu, dowiązania jako pliki, ≤ 5 MB, źródło bez zmian); `avatarImport` (PNG/JPG/WebP/GIF ≤ 2 MB → `avatar.<ext>`, poprzedni usunięty) i `avatar` → data URL. IPC: `bot_skill_sources`, `bot_skill_import` (nazwa sprawdzona `isSkillName`), `bot_avatar_import`, `bot_avatar`, `pick_image`.
- `src/bot/Avatar.tsx`: obrazek, emoji albo pierwsza litera; data URL raz na plik.
- Zrzuty (Electron offscreen, mock) w motywach D i Kreślarnia: cztery zakładki, otwarte menu modeli, podgląd skilla i lista importu. Na żywo w podglądzie: zapis zmienia awatar na liście, Esc w menu nie zamyka karty, usunięcie bota zostawia pozostałe. 0 błędów konsoli.
- Sprawdzenia: `pnpm typecheck`, `pnpm test` (53 pliki, 538 testów + 4 na żywo pominięte), `electron` typecheck + build – przechodzą.
- Niesprawdzone: okna wyboru obrazka i folderu (natywne, w podglądzie ich nie ma) i import z prawdziwego `~/.claude/skills` – etap 11.

## M5 Etap 6: zakładka Bot – 2026-10-01 (Claude, master)

- Trzecia karta **Bot** (`ModeTabs`, `ui.mode = "bot"`, Ctrl+Alt+C po kolei Code → Czat → Bot przez `nextMode`); Czat i Bot montowane przy pierwszym wejściu i zostają. `src/bot/BotView.tsx`: lista botów z kropką (pracuje / czeka na zgodę), pod wybranym jego rozmowy, na dole „Nowy bot” (tworzy domyślnego – edycja w etapie 7) i Kreator; powitanie z awatarem i `botGreeting`; nagłówek z awatarem i imieniem. Kilka botów może odpowiadać naraz (trwające odpowiedzi po id rozmowy).
- Wątek i pole z Czatu: `Thread` dostał `renderBody` (tekst pocięty `messageSegments` + karty narzędzi), `Composer` – `searchToggle`/`placeholder`. Dostawcy i wykrywanie modeli wydzielone do `chat/useProviders.ts` (Czat używa tego samego). Model wybrany w zakładce zapisuje się w bocie.
- `src/bot/Cards.tsx`: karta narzędzia (wiersz z `toolLabel`, stan, decyzja o zgodzie; rozwinięta: argumenty i wynik) i karta zgody (polecenie / diff `edit_file` w kolorach, trzy przyciski, Enter = raz, Esc = odrzuć – tylko na widocznej zakładce i nie gdy w polu jest tekst).
- Proces główny: `electron/src/bot/service.ts` (`BotService`: prompt bota jako migawka z pierwszej odpowiedzi w rozmowie, zgody „w rozmowie” per rozmowa, HTTP → `runBotTurn` z FreeToken, claude/codex → most MCP startowany przy pierwszym użyciu, `cwd` = `work/` bota), IPC `bot_send`/`bot_abort`/`bot_event`, `bot_approval` w preload. Typ `ApprovalRequest` przeniesiony do `src/bot.ts`.
- Mock: skryptowana odpowiedź (read_file → bash z prośbą o zgodę → wynik) i zgody bez procesu głównego.
- Zrzuty (Electron offscreen, podgląd z mockiem) w motywach D i Kreślarnia: rozmowa z narzędziami (karta rozwinięta), czekająca zgoda, po Enter („zezwolono raz”, 12/12), pusta lista z Kreatorem; Czat z menu modeli bez zmian. 0 błędów konsoli.
- Sprawdzenia: `pnpm typecheck`, `pnpm test` (53 pliki, 535 testów + 4 na żywo pominięte), `electron` typecheck + build – przechodzą.
- Niesprawdzone: prawdziwa rozmowa z botem w oknie (claude/codex przez most, llama przez pętlę) – etap 11; awatar z obrazka (pokazuje emoji albo pierwszą literę).

## M5 Etap 5: narzędzia bota w claude i codex – 2026-10-01 (Claude, master)

- `electron/src/bot/mcp.ts` (JSON-RPC po liniach: `initialize`, `ping`, `tools/list`, `tools/call`; błąd narzędzia = `isError`) i `mcp-server.ts` → `out/mcp-server.cjs` (nowe wejście w `vite.config.ts`). Serwer odpowiada bez kolejki, więc `ping` przechodzi w trakcie czekania na zgodę; koniec stdin albo zamknięte gniazdo = wyjście.
- `bridge.ts`: `ToolBridge.start()` – gniazdo `$XDG_RUNTIME_DIR/agents-bot-<pid>.sock` (umask → od razu 0600), `register({tools, call})` → env `AW_BOT_SOCKET`/`AW_BOT_TOKEN` + `dispose`, `serverSpec(execPath, script, env)` z `ELECTRON_RUN_AS_NODE=1`. Klient gniazda w `bridge-client.ts` (bez Electrona).
- `ChatRequest.mcp`: claude dostaje `--mcp-config` (plik 0600 w prywatnym katalogu tymczasowym, usuwany po odpowiedzi), `--allowedTools mcp__bot__*` (+ WebSearch/WebFetch przy `search`), `MCP_TOOL_TIMEOUT` 6 h; wbudowane narzędzia dalej tylko `--tools`. Codex: `-c mcp_servers.bot.{command,args,env,tool_timeout_sec}` i `default_tools_approval_mode="approve"` – bez tego `codex exec` odrzuca każde wywołanie MCP („zgody wyłączone”).
- Zmiana wobec planu: zdarzenia `tool_call`/`tool_result` wysyła sesja mostu (`reportedCall` wydzielone z `loop.ts`), nie parser wyjścia CLI – most zna decyzję o zgodzie i pełne argumenty. Parsery claude/codex bez zmian (wywołania `mcp__bot__*` ignorują).
- Na żywo (`AW_LIVE=1 pnpm vitest run electron/src/bot/cli-live.test.ts`, 4/4): claude (haiku) i codex (gpt-5.6-luna) ładują serwer, wołają narzędzie i czekają 75 s bez zerwania; Stop w trakcie wywołania zabija CLI i serwer MCP (oba).
- Sprawdzenia: `pnpm typecheck`, `pnpm test` (50 plików, 519 testów + 4 na żywo pominięte), `electron` typecheck + build – przechodzą. `bridge.test.ts` uruchamia zbudowany `out/mcp-server.cjs` (jak test linii statusu).
- Niesprawdzone: serwer z AppImage (`app.asar/out/mcp-server.cjs` – ta sama droga co działający `statusline.cjs`, bez `asarUnpack`); podpięcie mostu w `main.ts` i `botSystemPrompt` jako `--system-prompt` – etap 6.

## M5 Etap 4: pętla narzędzi – 2026-10-01 (Claude, master)

- `electron/src/bot/loop.ts`: `runBotTurn(req, tools, step, run, signal, emit)` – model → wywołania → `runTool` po kolei → model, najwyżej 25 kroków, potem tekst „Przerwałem po 25 krokach”. Zamiast `broker` z planu dostaje `run` (runTool z kontekstem, zgoda jest w nim). Tekst kolejnego kroku od nowego akapitu.
- `openaiBody`/`anthropicBody` biorą `req.tools` i `req.turns` (nowe pola `ChatRequest`); `streamOpenAI`/`streamAnthropic` zwracają wywołania złożone z kawałków (`CallParts` w `http.ts`, zły JSON = `bad` → błąd do modelu bez uruchamiania). `httpError` niesie `status`; `Adapter` w `service.ts` zwraca `Promise<unknown>`.
- Brak obsługi narzędzi: 400/422/500/501 na pierwszym kroku z `tools` = ten sam krok bez narzędzi i zdarzenie `tools_unsupported`; tak samo szablon `<tool_call>` wypisany tekstem. 401/404/429 i błąd po udanym kroku z narzędziami idą dalej jako błąd.
- `src/bot.ts`: `applyBotEvent` (tekst do odpowiedzi, `tool_call`/`tool_result` do `calls` z pozycją `at` w tekście, flaga `toolsUnsupported`) i `botTurns` (historia: odpowiedź rozpada się na kroki, wyniki ≤ 4 KB z zapisu, wywołanie bez wyniku = „przerwane (Stop)”). Model w trakcie tury dostaje pełne wyniki, zdarzenie skrót 4 KB.
- Fixtures: `openai-tools-{1,2}.sse` nagrane na żywo z llama-server (Qwen, `--jinja`, oba kroki działają); `anthropic-tools.sse` napisane ręcznie wg formatu API (bez klucza nie nagrane).
- Sprawdzenia: `pnpm typecheck`, `pnpm test` (48 plików, 499 testów), `electron` typecheck + build – przechodzą. Ostrzeżenie Node o `localStorage` (`--localstorage-file`) w `pnpm test` było wcześniej, nie z tego etapu.
- Niesprawdzone: Anthropic API na żywo; pętla nie jest jeszcze podpięta pod IPC (etap 6 – tam też FreeToken z `service.ts` i kreator żądania z `botTurns`). Zdarzenie `approval` idzie przez `ApprovalBroker.onChange`, nie przez `ChatEvent`.

## M5 Etap 3: narzędzia bota i zgody – 2026-10-01 (Claude, master)

- `electron/src/bot/tools.ts`: rejestr 15 narzędzi (`toolDefs(bot)` = włączone grupy, Kreator dodatkowo `bot_create`/`bot_update`) i `runTool(name, args, ctx)`, który nigdy nie rzuca – błąd i odmowa wracają do modelu jako `ok: false`. Ścieżki: względne od `work/`, `~` rozwinięte, zawsze `realpath` (też dla nieistniejącego pliku przez najbliższego przodka) przed `needsApproval`, więc dowiązanie z folderu bota na zewnątrz pyta o zgodę.
- `approvals.ts` (`ApprovalBroker`): prośba czeka na `once`/`chat`/`deny`; Stop (abort) = odmowa, „w tej rozmowie” dla bash bez prostego prefiksu (`;`, `|`, `$()`…) liczy się jako „raz”. W `main.ts`: zdarzenie `bot_approval` do okna, `bot_approve`, `bot_approvals`; przeładowanie strony i zamknięcie = odmowa wszystkich.
- `proc.ts`: `bash` i `rg` we własnej grupie procesów, limit 120 s / 30 s, wyjście ≤ 64 KB, Stop i limit zabijają całą grupę (procesy w tle po zakończeniu polecenia też – opisane modelowi). Środowisko bez `AW_CHAT_API_KEY`, `AW_BOT_*` i zmiennych Electrona.
- `web.ts`: `web_search` z HTML DuckDuckGo (bez klucza, bez modelu – zmiana względem planu, plan poprawiony), `web_fetch` = HTML→tekst ≤ 30 KB, tylko http(s), ≤ 2 MB pobrania. Sprawdzone na żywo: wyszukiwanie „Vintage Story modding wiki” (trafne wyniki z wiki), blog Rusta jako tekst. Odpowiedzi DDG zapisane w `fixtures/`.
- Harmonogram: `bash` z prefiksem z góry przechodzi tylko w `work/` i folderach bota; gdzie indziej pyta.
- Sprawdzenia: typecheck (frontend i electron), vitest 463/463 (nowe: tools 24, approvals 4, proc 6, web 6), build electron – OK.
- Niesprawdzone: zdarzenie `bot_approval` w oknie (UI w etapie 6); nikt jeszcze nie woła `runTool` z modelu (etapy 4–5).

## M5 Etap 2: boty na dysku – 2026-10-01 (Claude, master)

- `electron/src/bot/store.ts` (`BotStore`): `~/.config/dev.majke.agents/bots/<id>/` z `bot.json`, `memory.md`, `user.md`, `skills/<nazwa>/SKILL.md`, `routines.json`, `chats/`, `runs/`, `work/`. Kreator powstaje przy pierwszym `list()`, nie da się go usunąć, a zapis nie zdejmie ani nie nada `builtin`. Usunięcie = przeniesienie do `bots-trash/<id>-RRRR-MM-DD-GGMMSS`.
- Pamięć ponad limit, zły `SKILL.md`, złe `routines.json` i id spoza `[a-z0-9-]` (np. `../x`) są odrzucane. Zepsuty bot/skill zostaje na liście jako błąd, pliku nie ruszamy. Rozmowy bota używają `ChatStore` z M3 (rozmowa → `chats/`, przebieg z `routine` → `runs/`).
- IPC `bot_*` w `main.ts`, metody `bot*` w `Backend` (`backend.ts`, `backend-electron.ts`). Podgląd: `src/bot-mock.ts` w localStorage (`aw-bots`) z Rustym (pamięć, skill `rust-news`, zadanie pn–pt 08:00, rozmowa z wywołaniami narzędzi, przebieg), Olą (bez narzędzi) i Kreatorem; te same odmowy co na dysku.
- `src/bot.ts`: `isBotId`, `isSkillName` (id ≤ 64 znaki).
- Sprawdzenia: typecheck (frontend i electron), vitest 423/423 (nowe: store 11, mock 3), build electron – OK.
- Niesprawdzone: IPC w działającej aplikacji (nie ma jeszcze UI, które by je wołało).

## M5 Etap 1: model bota – 2026-10-01 (Claude, master)

- `src/bot.ts` (czyste funkcje): `BotDef` z osobowością (imię, awatar, kolor, persona, styl, czego unika, ton), modelem, folderami i przełącznikami **grup** narzędzi (`web`, `read`, `write`, `bash`, `memory`, `skills`; zamiast przełącznika na każde narzędzie, plan poprawiony). Kreator jako `creatorBot()` (`builtin: "creator"`).
- `parseBot`, `parseRoutines` (`every` ≥ 5 min, `daily` GG:MM z dniami), `nextRun` (czas lokalny; 02:30 przy zmianie na letni → 03:30, przy zmianie na zimowy uruchamia się raz), `scheduleLabel`.
- `parseSkill` / `skillMarkdown` (frontmatter Agent Skills), `memoryEdit` (wpisy rozdzielone `§`, wskazanie fragmentem, limit z całą pamięcią w błędzie), `botSystemPrompt` (stała kolejność, data bez godziny – ten sam tekst przez cały dzień), `botGreeting`.
- `needsApproval`: reguły zgód z planu. Prefiksy bash (`commandPrefix`, `matchesPrefix`) odrzucają `;`, `&`, `|`, `$`, `` ` ``, przekierowania i nową linię – zgoda na `git pull` nie przepuści `git pull; rm …`. Ścieżki mają przychodzić po `realpath` (to robi etap 3).
- `vitest.config.ts`: `env.TZ = Europe/Warsaw`, żeby testy zmiany czasu nie zależały od strefy maszyny.
- Sprawdzenia: typecheck (frontend i electron), vitest 404/404 (nowe 42), build electron – OK.

## M3: zakładka Czat (etapy 1–7b) – 2026-10-01 (Claude, master)

- Przełącznik **Code | Czat** na górze lewej kolumny (`src/chat/ModeTabs.tsx`), skrót Ctrl+Alt+C, `ui.mode` w workspace.json. Siatka zostaje zamontowana pod czatem (`display:none`, terminale robią `fit()` po powrocie). W Czacie skróty siatki są wyłączone (Ctrl+Shift+C/V zostają dla pola tekstowego).
- Czat (`src/chat/`): lista rozmów z grupami dni i szukaniem, powitanie, kolumna 740 px, dymki pytań, markdown + tabele + shiki (dwa motywy wg `data-tone`, ładowany leniwie), Stop, Ponów, Edytuj ostatnie pytanie, przypisy `[n]` jako znaczki, karty źródeł, zwijane „Przemyślenia” i „Przeszukano N stron”. Rozmowy w `~/.config/dev.majke.agents/chats/` (+ `index.json`).
- Dostawcy (`electron/src/chat/`): `openai.ts` (SSE, llama-server/FreeToken/OpenRouter/OpenAI), `anthropic.ts` (Messages API), `claude.ts` (`claude -p` stream-json, `--session-id`/`--resume`, katalog `chat-cwd`), `codex.ts` (`codex exec --json`, `exec resume`), `pi.ts` (wyszukiwanie dla lokalnych i API: `pi -p --mode json` z samym pi-web-access, własny `pi-agent/`, klucz przez `$AW_CHAT_API_KEY`). Dostawcy z `~/.pi/agent/models.json` dochodzą automatycznie (tylko odczyt).
- Klucze API: `chat-keys.json` zaszyfrowany `safeStorage`. Na tej maszynie KWallet jest wyłączony (`kwalletrc: Enabled=false`), a Electron i tak go wybierał (szyfrowanie niedostępne) – `passwordStore()` przełącza wtedy na `gnome-libsecret` (gnome-keyring działa, sprawdzone).
- Sprawdzone na żywo (poza UI, przez `ChatService`): Haiku z wyszukiwaniem (2 zapytania, 9 stron, źródło z przypisem), wznowienie sesji claude, codex Luna + wznowienie wątku („Figa”→„Figa”), lokalny Qwen z wyszukiwaniem Exa przez pi w 3,8 s (z historią jako tłem). Podgląd UI zrzutami (mock): powitanie, strumień, menu modeli, źródła, okno Dostawcy, jasny motyw.
- Zauważone: `codex exec` nie strumieniuje tekstu (odpowiedź w całości po ~5 s); `gpt-5.5` zwraca 404 w tej subskrypcji – na liście tylko GPT-5.6 Luna i Terra. Haiku przez `claude -p` nie pokazuje treści myślenia (tylko podpis), więc „Przemyślenia” są puste.
- Sprawdzenia: typecheck (frontend i electron), vitest 362/362, build electron – OK.
- Niesprawdzone w prawdziwym oknie (etap 8): całość w `pnpm desktop`, zapis klucza przez okno Dostawcy (libsecret w działającej aplikacji), przełączanie Code↔Czat z pracującymi agentami, długie odpowiedzi i CPU, wygląd w jasnych motywach na żywych danych.

## Motywy: 21 makiet z „Nowych wyglądów” + wzór D w oknie „Wygląd” – 2026-10-01 (Claude, master)

- `ui.theme` (domyślnie `d`, czyli bez zmian dla istniejących `workspace.json`) i nowy akcent `theme` („Z motywu”). Wybór motywu przywraca akcent motywu (`uiPatch`), własny akcent można potem wybrać jeszcze raz.
- Motyw zmienia tylko wygląd tego samego układu, nie układ. Rzeka, Cisza, Metro, Konstelacja, Wieża, Akwarium i reszta biorą z makiet kolory, fonty, ramki i ozdoby. Oś czasu, radar, akwarium ze stworzeniami czy karuzela 3D nie są zrobione.
- `src/themes.ts`: lista, akcent, próbka do kafelka, kolory xtermu (jasne motywy mają paletę ANSI na jasne tło) i font terminala. `src/themes.css`: tokeny `:root[data-theme=…]` i ozdoby. App ustawia `data-theme`/`data-tone` na `<html>` i `--term-bg` z themes.ts. Terminal dostaje `look` (ITheme + font) zamiast `accent`; zmiana fontu w locie najpierw doczytuje font, potem robi `fit()`.
- Fonty z fontsource (`src/theme-fonts.ts`), 22 paczki; przeglądarka pobiera plik dopiero, gdy motyw go użyje.
- Przy okazji: `.settings` miało `content-box`, przez co padding wypychał wysokie okno „Wygląd” nad krawędź; teraz `border-box`.
- Sprawdzone zrzutami (Electron offscreen + podgląd z mockiem): wszystkie 22 motywy, okno „Wygląd” w 4 motywach. Przełączenie w locie z D na Cisza zmienia font xtermu, tło i zapisuje się w workspace. Testy 286/286, typecheck czysty.
- Niesprawdzone w prawdziwym oknie: TUI claude/pi na jasnych terminalach (Kreślarnia, Metro, Konstelacja, Składanka, Zeszyt, Shōnen). Claude ma własny motyw kolorów (`/theme` → light), który może być potrzebny do czytelności.

## Electron dogania Tauri: pasek tytułu, krawędzie, AppImage – 2026-10-01 (Claude, master)

- Sterowanie oknem przeniesione do backendu: `WindowControls` (`backend.window`) w `src/backend.ts`; Tauri `getCurrentWindow()` w `backend-tauri.ts`, Electron przez IPC `win_*` w `electron/src/main.ts`. `TitleBar`/`ResizeEdges` nie importują `@tauri-apps`, pokazują się przy każdym backendzie z oknem (w podglądzie nadal nie).
- Okno Electrona: `frame: false`, `transparent: true` (rogi z `.shell`), przeciąganie przez `-webkit-app-region: drag` na `.titlebar` (przyciski i uchwyty `no-drag`).
- Krawędzie: Electron nie ma `startResizeDragging` – uchwyt łapie wskaźnik, proces główny liczy granice (`electron/src/window.ts`, `resizedBounds`, testy). Na Wayland okno nie zmienia położenia, więc uchwyty w UI tylko dół/prawo/róg dolny-prawy (`--aw-wayland` z `additionalArguments`); góra/lewo zostają ramce okna. Na X11 wszystkie 8.
- AppImage: electron-builder (`npm run dist` w `electron/`), `StartupWMClass=agents-workspace`, ikona z `branding/`. Sprawdzone na zbudowanej AppImage: start, pty, brak zmiennych AppImage w panelu, `python3` działa, pomocnik linii statusu z `app.asar` zapisuje limity.
- Sprawdzone przez CDP w oknie: róg −200×−100 i prawa +150 px dokładnie, maksymalizacja/przywrócenie (`is-max`, uchwyty znikają, ikona), tytuł okna. Testy 273/273, typecheck (frontend i electron) czysty.
- Niesprawdzone (potrzebna prawdziwa mysz): przeciąganie za pasek, dwuklik na pasku (przy `app-region: drag` strona nie dostaje `dblclick` – zależy od Chromium/KWin), góra/lewo natywną ramką na Wayland, powiadomienie na pulpicie, okno wyboru folderu.

## Płynność 2: przewijanie – bez warstwy nad terminalem – 2026-10-01 (Claude, master)

- Po `4d09f48` w oknie: CPU 38% (było 67–92%), ale użytkownik: „skrolowanie terminala nadal laguje”. Okno ma 1921×1363, głębia 32 (przezroczyste), monitory 5120×2160@165 Hz i 3440×1440@240 Hz.
- Stanowisko rozszerzone o przewijanie: `WheelEvent` co klatkę na `.xterm-screen`, czasy `requestAnimationFrame` przez 4 s, okno 1921×1363; mock w `aw-bench` wypisuje na start 1500 linii historii.
- Wnioski: każdy krok poświaty przemalowywał wszystkie pracujące panele naraz (p95 klatki 35 ms nawet bez przewijania). Nawet **statyczny** rozmyty cień `.glow` nad terminalem kosztuje (p95 37 ms), bo WebKit maluje go przy każdej zmianie terminala pod spodem. Zewnętrzny blask panelu też (+4 ms p95).
- Sprawdzony i odrzucony: `@xterm/addon-webgl` 0.19 (WebGL2 jest mimo braku kompozycji) – przewijanie bez zysku (p95 37 vs 36 ms, bez animacji 23 vs 23), nie zostaje w zależnościach.
- Zmiana: „Poświata” = ostra ramka 1 px w kolorze agenta, bez rozmycia i animacji; „oddycha” napis stanu w nagłówku (`.pane-state`, mały obszar, wyłączony przy `motion-lite`/reduced motion). `breatheGlow` usunięte.
- Wynik 1921×1363, 3 pracujące panele: przewijanie średnio 29,9 → 18,5 ms/klatkę, p95 38 → 29 ms; CPU WebKita 95,5% → 43,5%. Podłoga bez animacji i ramki: 31,6% – reszta to xterm DOM (spinnery 10×/s).
- Sprawdzenia: typecheck, vitest 216/216, cargo test 39/39, cargo build – OK.
- Niesprawdzone: odczucie w prawdziwym oknie; koszt przezroczystego okna (32 bit, KWin) – stanowisko poza ekranem go nie mierzy.

## Płynność: animacje bez kompozycji WebKita – 2026-10-01 (Claude, master)

- Objaw: lagi. Pomiar w oknie (AppImage `8f86ac8`): `WebKitWebProcess` 67–92% jednego rdzenia, gdy agent tylko „pracuje” (spinner). Cały koszt w głównym wątku: przy `WEBKIT_DISABLE_COMPOSITING_MODE=1` + `LIBGL_ALWAYS_SOFTWARE=1` każda klatka animacji to malowanie na CPU.
- Stanowisko: WebKitGTK 4.1 z PyGObject w `Gtk.OffscreenWindow` (niewidoczne), te same zmienne co `set_webview_env`, podgląd `pnpm dev`, workspace wstrzyknięty do localStorage. Nowy tryb mocka: `localStorage["aw-bench"]="1"` – claude/pi wypisują spinner 10×/s i linię co 2 s (panel stale `st-working`).
- Wnioski: koszt = powierzchnia przemalowania × liczba klatek. Poświata (`.glow`, cały panel z terminalem pod spodem, 60 kl./s) to ~2/3 obciążenia; kropki na szynie ~6 pkt (samo planowanie klatek).
- Zmiana (tylko `styles.css`): pętle `infinite` idą `steps(…, jump-none)` – poświata 12 kroków na pół oddechu (~9 zmian/s), kropki 4, puls streszczenia 6; skan jeździ płynnie, ale `.glow` przy `work-scan` ma 2 px wysokości zamiast całego panelu.
- Wynik (3 pracujące panele, CPU procesu WebKit): poświata 69,9% → 30,7%, skan 46,5% → 23,9%. Bez żadnych animacji ~12% (to już xterm DOM + React).
- Sprawdzenia: typecheck, vitest 216/216, cargo test 39/39, cargo build – OK.
- Niesprawdzone: jak „schodkowe” oddychanie poświaty wygląda w oknie na oko; zysk w prawdziwym oknie (przezroczyste okno, KWin) – zmierzyć po instalacji tym samym `/proc/<pid>/stat`.

## Tytuły rozmów z terminala – 2026-10-01 (Claude, master)

- Użytkownik gubił się w panelach: nagłówek i szyna pokazywały tylko „Claude”, tytuł był wyłącznie w pulpicie. W zwykłej konsoli claude ustawia tytuł terminala (OSC 0/2, „✳ temat”), a xterm go tu łapał, tylko nikt tego nie odczytywał.
- `Terminal` → `onTitle` (`x.onTitleChange`), `PaneActions.title` → `ephemeral[paneId].termTitle` po `cleanTermTitle` (`src/context.ts`: bez znaczka ✳/spinnera, „Claude Code”/„pi”/puste = brak). Render tylko przy nowym temacie, nie przy klatce spinnera.
- `paneTitles`: tytuł terminala wygrywa, plik sesji (`sessionTitles`) uzupełnia. Tytuł widać w nagłówku panelu (`.pane-title`), w wierszu panelu na szynie (zamiast nazwy agenta; kolor kropki zostaje) i w pulpicie.
- Tytuł okna = temat panelu w fokusie + „ — Agents” (`TitleBar` → `setTitle`, uprawnienie `core:window:allow-set-title`; w podglądzie `document.title`).
- Sprawdzenia: typecheck, vitest 216/216, cargo test 39/39, cargo build — OK.
- Niesprawdzone w oknie: jak wygląda nagłówek z długim tytułem, czy KDE pokazuje tytuł okna na pasku zadań, jakie tytuły ustawia pi i powłoka.

## Uchwyty zmiany rozmiaru + instalacja – 2026-10-01 (Claude, master)

- Użytkownik w oknie (AppImage `c69831e`): pasek i rogi OK, krawędzie „średnio łapią”, zwłaszcza rogi. Tauri ma na sztywno 5 px (`BORDERLESS_RESIZE_INSET`).
- `ResizeEdges` w `TitleBar.tsx`: 8 niewidocznych `.resize-edge` (`position: fixed`, z-index 1000), `startResizeDragging(kierunek)`; krawędzie 7 px (góra 4 px), rogi dolne 18 px, górne 10 px (przyciski paska). Brak po maksymalizacji. Uprawnienie `core:window:allow-start-resize-dragging`.
- Potwierdzone w nowej AppImage: w panelu brak zmiennych `mount_Agents`, `python3` działa.
- Instalacja: `pnpm tauri build` w czystym środowisku → `~/.local/bin/Agents-<commit>.AppImage`, `Exec`/`TryExec` w `~/.local/share/applications/agents-56a554c-wip.desktop` przestawione (stare pliki zostają do cofnięcia).
- Niesprawdzone: uchwyty w oknie (wersja `3fb81ad`).

## Środowisko AppImage nie przecieka do paneli – 2026-10-01 (Claude, master)

- Błąd w zainstalowanej AppImage: panele dziedziczyły środowisko AppRun (`LD_LIBRARY_PATH`, `PATH`, `PYTHONHOME`/`PYTHONPATH`, `PERLLIB`, `GTK_*`, `GTK_THEME=Adwaita:dark`…, wszystko na `/tmp/.mount_Agents…`) – `python3` w panelu nie startował („No module named 'encodings'”), stąd obejście `env -u PYTHONHOME -u PYTHONPATH pnpm desktop`.
- Rust `appimage.rs`: `child_env_fixes` (czysta, 2 testy) – tylko gdy są `APPDIR` i `APPIMAGE`: usuwa `APPDIR`, `APPIMAGE`, `ARGV0`, `OWD`, `PYTHONDONTWRITEBYTECODE`, `GTK_THEME`; z list `a:b` wycina wpisy z `$APPDIR`, pusta lista = zmienna usunięta. Użyte w `pty.rs` (panele) i `summary.rs` (`claude -p`).
- Pasek tytułu po scaleniach M4 przejrzany w kodzie: `.shell`/`TitleBar`/`html, body { transparent }`/uprawnienia bez zmian. Zmiana rozmiaru bez ramki: tauri-runtime-wry 2.12 ma na Linuksie strefę 5 px przy krawędzi (`undecorated_resizing.rs`).
- Sprawdzenia: typecheck czysty, vitest 212/212, cargo test 39/39, cargo build 0 ostrzeżeń.
- Niesprawdzone: okno (pasek, rogi, krawędzie) – po instalacji nowej AppImage u użytkownika.

## Pasek tytułu w UI + zaokrąglone rogi – 2026-10-01 (Claude, master, commit `5325bd3`)

- Zrobione: okno bez dekoracji systemowych (`tauri.conf.json`: `decorations: false`, `transparent: true`), własny pasek `src/TitleBar.tsx` (przeciąganie `data-tauri-drag-region`, dwuklik = maksymalizacja, min/max/przywróć/zamknij przez `getCurrentWindow()`), ramka `.shell` w `App.tsx` (kolumna: TitleBar + `.app`), rogi `--r-win: 10px`, po maksymalizacji `is-max` = proste. Uprawnienia w `capabilities/default.json`: `allow-minimize`, `allow-toggle-maximize`, `allow-close`, `allow-start-dragging`, `allow-is-maximized`. Pasek tylko w Tauri (`inTauri`), w podglądzie go nie ma.
- Pułapka: `html, body { background: transparent }` musi wygrać z dawnym `body { background }` – ta druga reguła została usunięta; inaczej rogi są zamalowane na kwadrat.
- Sprawdzenia: typecheck czysty, vitest 212/212. Użytkownik potwierdził w oknie (`pnpm desktop`), że pasek i rogi działają – przed scaleniami M4.
- Niesprawdzone: wygląd po scaleniach M4 (nikt nie uruchomił `pnpm desktop` po nich); zmiana rozmiaru za krawędzie/rogi bez ramki systemowej (jeśli uchwyt łapie słabo – własne uchwyty); dialogi przyciemniają tylko `.app`, nie pasek.
- Jak uruchomić: w osobnym terminalu, poza aplikacją Agents: `env -u PYTHONHOME -u PYTHONPATH pnpm desktop` (wcześniej zamknąć okno Agents i stary Vite na porcie 5183, inaczej „Port 5183 is already in use”). Sesja Claude działająca *w* panelu Agents nie może jej zrestartować.
- Zrzut ekranu na KDE/Wayland: `spectacle -b -n -f -o plik.png` (`grim` nie działa – brak protokołu wlroots).

## M4 Etap 5 – 2026-10-01 (użytkownik, okno Tauri)

- Przeciąganie paneli działa. Shift = przekazanie: w celu wkleiło się streszczenie Haiku (nagłówek, 3 punkty, „Moje polecenie: ” bez Entera). Źródłem była krótka rozmowa testowa – na długiej sesji jeszcze nie sprawdzone.

## M4 Etap 4b – 2026-10-01 (Claude, master)

- Powód: użytkownik w oknie – „przerzuca całość, a nie skompaktowany kontekst”. Wybrał streszczenie przez Haiku.
- Rust `summary.rs`, komenda `claude_summary(command, system, input)`: `claude -p --model haiku --no-session-persistence --tools "" --strict-mcp-config --disable-slash-commands --setting-sources "" --system-prompt …`, wyciąg na stdin, cwd = katalog tymczasowy (bez CLAUDE.md), limit 60 s (potem kill), błąd = kod + pierwsza linia stderr. `--bare` odpada – nie czyta logowania OAuth (subskrypcji). 4 testy na `sh`.
- TS `handoff.ts`: `SUMMARY_SYSTEM` (punkty, po polsku, cel/zrobione/decyzje/pliki/otwarte, „tak krótko jak się da”, maks. `SUMMARY_MAX_CHARS` = 1500), `digestText` (wejście), `summaryText` (nagłówek „Streszczony kontekst…”, ucięcie, bez `\r`, „Moje polecenie: ”), `handoffText(…, max)` – zapasowy wyciąg 2500 znaków. 4 nowe testy.
- App `sendContext`: panel celu `data-busy="summary"` (pulsująca ramka + plakietka „streszczam…”, bez pulsu przy `motion-lite`/reduced motion), toast „Streszczam rozmowę „X” (Haiku)…”; po odpowiedzi ponowne sprawdzenie bracketed paste celu. Błąd = skrócony wyciąg + toast z powodem. Jedno streszczenie naraz na panel. Streszcza program claude z agents.json także dla źródła pi.
- Sprawdzenia: typecheck czysty, vitest 212/212, cargo test (summary 4/4), cargo build 0 ostrzeżeń. Ręcznie `claude -p` z tym poleceniem: wyciąg ~1,2 tys. znaków → 5 punktów, ~450 znaków, 12 s.
- Niesprawdzone: w oknie Tauri (plakietka, czas, prawdziwa rozmowa). Mock podglądu: 1,5 s, stałe streszczenie.

## M4 Etap 4 – 2026-10-01 (Claude, gałąź `worktree-m4`)

- `drag.ts`: `dragMode(shift, maRozmowę)` → `swap | handoff | blocked`, `modeTarget` (kontekst przyjmuje tylko panel, który może go wkleić) + testy.
- `usePaneDrag`: Shift z `pointermove` i z `keydown/keyup` (bez ruchu myszy też przełącza; Shift i Esc w locie nie trafiają do terminala). Duch `data-mode`: akcent + ikona `Send` (SVG lucide wklejony, duch jest poza Reactem) + etykieta „kontekst →”; źródło bez rozmowy – szara kulka „brak rozmowy”, upuszczenie = powrót. Cel: `data-drag="handoff"` (obrys + plakietka „wklej kontekst” pod nagłówkiem). Upuszczenie: kulka wsiąka w cel, cel dostaje falę `wave` (`data-drag="soak"`, 700 ms).
- **Bezpieczeństwo wklejenia:** `xterm.paste` zamienia `\n` na `\r`, więc bez bracketed paste każda linia poszłaby jako Enter. `TerminalHandle.bracketedPaste()` (`modes.bracketedPasteMode`), `PaneActions.acceptsPaste` – panel bez tego trybu nie jest celem, a `sendContext` sprawdza to jeszcze raz przed wklejeniem. Nigdy nie wysyłamy `\r`.
- App `sendContext`: `sessionHandoff` → `handoffText` → `paste` do celu → fokus celu, toast „Wklejono kontekst z „X” – dopisz polecenie i wciśnij Enter”, w „Na żywo” „przekazał kontekst → Y”; błąd odczytu = toast, nic nie wklejamy.
- Mock: claude/pi włączają bracketed paste (`\x1b[?2004h`) jak prawdziwe, udawana powłoka nie; wklejony blok nie „wciska” Entera.
- Sprawdzenia: typecheck czysty, vitest 196/196, cargo test 29/29, cargo build 0 ostrzeżeń. Podgląd (BiDi, headless Firefox): Shift claude→pi wkleja wyciąg bez Entera, fokus na pi, toast i zdarzenie; Shift z powłoki = „brak rozmowy”, bez zmian; Shift nad powłoką bez bracketed paste = brak celu; Shift wciśnięty/puszczony w locie przełącza cel `target`↔`handoff`; bez Shiftu dalej zamiana. 0 duchów po każdym locie.
- Niesprawdzone: prawdziwe claude/pi w oknie (czy pi przyjmuje 8000 znaków blokiem, jak claude zwija wklejenie).

## M4 Etap 3 – 2026-09-30 (Claude, gałąź `worktree-m4`)

- Rust `handoff.rs`: `session_handoff(kind, session_id) -> Option<{prompts, replies, files, commands}>`, ogon 1 MB (`context::read_last`; 256 KB mierników bez zmian). Z `context.rs` tylko `pub(crate)` dla `Kind`, `valid_id`, `find_session` + `read_last` – bo `user_prompt`/`session_title` z niezacommitowanych zmian głównej kopii nie ma jeszcze w `HEAD` (osobny moduł = mniej konfliktów przy scalaniu).
- Wyciąg: 5 promptów (≤ 800 znaków, claude bez linii od `<` i `isMeta`), 3 teksty asystenta (≤ 1500), pliki z Edit/Write/MultiEdit/NotebookEdit (pi: edit/write) najnowsze pierwsze bez powtórzeń (≤ 20), 5 poleceń Bash/bash w jednej linii (≤ 120). Bez `isSidechain`. Ucięcia na granicy znaku + „…”. Pusta rozmowa = `None`. 4 testy na fixture (bez prawdziwego `~/.claude`/`~/.pi`).
- TS `src/handoff.ts` + testy: `handoffText` – nagłówek „Kontekst przekazany z innej sesji (agent · projekt)…”, sekcje (puste pominięte), ścieżki względem projektu (przez `tildify`), na końcu „Moje polecenie: ”, ≤ 8000 znaków (najpierw odpadają stare odpowiedzi, potem stare prompty), bez `\r`. `backend.sessionHandoff` (Tauri + stały wyciąg w mocku).
- Sprawdzenia: typecheck czysty, vitest 194/194, cargo test 29/29, cargo build 0 ostrzeżeń.
- Niesprawdzone: wyciąg z prawdziwych plików claude/pi (format ustalony z etapów 8–9).

## M4 Etap 2 – 2026-09-30 (Claude, gałąź `worktree-m4`)

- `src/drag.ts` + testy: próg 6 px, `dropTarget` (pudełka w układzie okna, własny panel/przerwa = brak), sprężyna `follow` liczona od `dt`, `stretch` (≤ 1,15), `shrinkTo` (pudełko → kulka 48 px; `border-radius: 50%` + skala niejednorodna = koło).
- `src/usePaneDrag.ts`: pointer na `.pane-head` bez `.tools`/przycisków; nasłuchy okna w jednej instancji na komponent (`createDrag`), lot bez renderów Reacta (duch w `.app`, `data-drag` na komórkach). Obrys panelu zwija się w kulkę (WAAPI, 240 ms), kulka goni kursor i rozciąga się w ruchu, wlot w cel 160 ms, powrót + rozwinięcie przy Esc / upuszczeniu obok / `blur` / `pointercancel`. Esc nie trafia do terminala.
- Wyłączone przy 1 panelu i maksymalizacji. „Oszczędny” i `prefers-reduced-motion`: żeton przy kursorze bez zwijania, sprężyny i powrotu.
- CSS: nagłówek `user-select: none; cursor: grab`. Przygaszenie i obrys celu na `.pane-cell` (+ `position: relative`), bo `paneIn` z `both` trzyma `opacity` na `.pane`.
- Sprawdzenia: typecheck czysty, vitest 191/191. Podgląd (headless Firefox przez WebDriver BiDi, 4 panele, pełny i oszczędny ruch): a→d zamienia miejsca, DOM stały (`order`), treść terminala claude zostaje, po upuszczeniu 0 duchów / `data-drag`, Esc = bez zmian, klik bez ruchu = tylko fokus. Zrzuty klatek: zwijanie, lot, cel, po zamianie.
- Niesprawdzone: płynność na WebKitGTK (programowe rysowanie), canvas WebGL xterm po zamianie w oknie Tauri.

## M4 Etap 1 – 2026-09-30 (Claude, gałąź `worktree-m4`)

- `workspace.ts`: akcje `swap {a, b}` i `swapDir {dir}` (panel z fokusem ↔ sąsiad z `neighbor`); przy maksymalizacji, tym samym albo nieznanym id – ten sam `ws`. Fokus idzie z panelem.
- `keys.ts`: Ctrl+Alt+Shift+strzałka = `swap`; App → `swapDir`.
- `Grid.tsx`: komórki w DOM w kolejności utworzenia (`mountOrder` w `motion.ts`), miejsce w siatce przez `order`; `maxOrigin` i opóźnienie wjazdu liczone od miejsca. FLIP bez zmian (`layoutKey` ma kolejność, `offsetLeft` uwzględnia `order`).
- Sprawdzenia: typecheck czysty, vitest 183/183. Rust bez zmian.
- Niesprawdzone: okno Tauri. Ctrl+Alt+Shift+strzałki mogą być zajęte przez pulpit (przenoszenie okna między obszarami roboczymi w części środowisk).

## M2 Etap 10 – 2026-09-30 (Claude)

- Źródło: wariant 1. Claude Code 2.1.286 daje linii statusu `rate_limits.five_hour` / `seven_day` (`used_percentage`, `resets_at`; tylko subskrypcja, po pierwszej odpowiedzi API). Wariant 2 (token z `.credentials.json`, `/api/oauth/usage`) niepotrzebny, więc nie ma go w kodzie ani ustawienia „Pokaż limity Claude”. Brak „Tydzień · Opus” ze wzoru – linia statusu go nie podaje.
- Rust `limits.rs`: panele claude dostają `--settings {"statusLine":{"type":"command","command":"'<exe>' --aw-statusline '<config>/claude-limits.json'"}}` (`claude_settings_arg`). `main.rs` w trybie pomocnika czyta stdin, zapisuje tylko okna + czas (tmp z PID + rename), nic nie wypisuje, zawsze kod 0 (~30 ms na wywołanie). Nic nie dodajemy, gdy `~/.claude/settings.json` ma własne `statusLine` (tylko odczyt). `claude_limits` czyta plik. 5 testów.
- TS `src/limits.ts` + testy: `withClaudeSettings` (tylko program `claude`, nie gdy argumenty mają już `--settings`), `resetText` („reset o 22:40”, „reset jutro 02:05”, „reset w pon. 09:00”), `limitMeters` (okno po resecie znika). Pane pyta o argument raz na aplikację.
- Dock: `.meter` ze wzoru, nagłówek „linia statusu · N min temu” + przycisk odśwież (`RotateCw`). App czyta plik tylko przy otwartym pulpicie: od razu, co 30 s (zamiast 5 min z planu – to lokalny plik, nie sieć) i na przycisk.
- Sprawdzenia: typecheck czysty, vitest 178/178, cargo test 25/25, cargo build 0 ostrzeżeń. Pomocnik sprawdzony na zbudowanej binarce (JSON z `rate_limits`, śmieci na wejściu). Podgląd: dwa mierniki, czas odczytu, przycisk.
- Niesprawdzone: prawdziwy claude w oknie Tauri (testy nie uruchamiają claude). Działa tylko w panelach uruchomionych po tej zmianie (stare trzeba zrestartować). `--settings` ma pierwszeństwo przed `statusLine` w `.claude/settings.json` projektu.

## M2 Etap 9 – 2026-09-30 (Claude, za zgodą użytkownika zamiast lokalnego modelu)

- pi: format wywołań ustalony z typów `pi-ai` 0.99.1 (bez czytania cudzych sesji): `message.content[]` `{"type":"toolCall","id","name","arguments":{path|command}}`; claude: `{"type":"tool_use","id","name","input":{file_path|command}}`.
- Rust `context.rs`: ten sam odczyt ogona co w etapie 8 zwraca też `tools` – do 10 najnowszych wywołań (bez `isSidechain`), komenda w jednej linii, ucięta do 60 znaków. 3 nowe testy na fixture.
- `src/feed.ts` + testy: `relativeTime` („teraz”, „40 s temu”, „3 min temu”, „2 godz. temu”, „2 d temu”), `newTools` (pierwszy odczyt rozmowy = linia bazowa, stare wywołania to nie zdarzenia), `toolText` (ścieżka względem projektu), `pushFeed` (najnowsze pierwsze, 30), `exitedText`.
- App: zdarzenia „uruchomiony” (nowy `onStart` w Terminal → `actions.started`), „skończył pracę” (po odczycie pliku, żeby ostatnie narzędzia były przed nim), „proces zakończony (kod N / sygnał X)”, narzędzia z odczytów. Odczyt bazowy wszystkich rozmów przy zmianie ich zbioru, potem co 5 s aktywny projekt + pracujące panele schowanych projektów. Numer odczytu na sesję – spóźniona odpowiedź nie dubluje zdarzeń. Stan ulotny.
- Dock: `.feed` / `.feed-item` (przycisk; klik = fokus panelu i jego projekt, zamknięty panel = sam projekt), `feedIn` wyłączone przy `motion-lite` i `prefers-reduced-motion`. Odstępstwo od wzoru: `.feed` przewija się (`overflow-y: auto`), bo 30 zdarzeń się nie mieści.
- Sprawdzenia: typecheck czysty, vitest 173/173, cargo test 20/20, cargo build 0 ostrzeżeń. Podgląd (headless Firefox, mock: co drugi odczyt nowe narzędzie): starty 5 paneli z 2 projektów, narzędzia co 5 s, `fail` w powłoce → „proces zakończony (kod 1)”, „10 s temu” po 11 s, klik zdarzenia z „beta” przełącza projekt i fokus.
- Niesprawdzone: prawdziwe pliki claude/pi w oknie Tauri, zdarzenie „skończył pracę” w podglądzie (mock nie symuluje pracy agenta). Przy starcie aplikacji każdy panel daje „uruchomiony” – przy wielu panelach to zapełnia listę.

## M2 Etap 8 – 2026-09-30 (Claude, za zgodą użytkownika zamiast lokalnego modelu)

- pi: plik sesji to `~/.pi/agent/sessions/<katalog>/<czas>_<sessionId>.jsonl` (ustalone z nazw plików i typów `pi-coding-agent` 0.99.1, bez czytania cudzych sesji); wpis `{"type":"message","message":{"role":"assistant","model","usage":{input,cacheRead,cacheWrite,…}}}`.
- Rust `src-tauri/src/context.rs`: `session_context(kind, session_id) -> Option<{tokens, model}>` (async), tylko ostatnie 256 KB, ucięta pierwsza linia odrzucana; pomija `isSidechain` i tury z samymi zerami; id tylko `[0-9a-f-]`; znaleziona ścieżka w pamięci (pi = skan katalogów). 5 testów na plikach w katalogu tymczasowym.
- Okno kontekstu (poprawka po zrzucie użytkownika: claude na Sonnet 5.5 pokazywał /200k, pi z lokalnym modelem /128k zamiast 262k): `contextLimit` = `context` z agents.json > model ostatniej tury > 200k / 128k. pi: Rust bierze `contextWindow` modelu (`provider` + `id`) z `~/.pi/agent/models.json`, potem `models-store.json` (tylko odczyt, parsowane ponownie po zmianie pliku). claude: `claudeWindow(model)` – Opus/Sonnet od 4.6 oraz Fable/Mythos = 1M, Haiku i starsze = 200k.
- TS `src/context.ts` + testy: `contextKind` (po programie `claude`/`pi`, wymaga `session`), `contextLimit`, `claudeWindow`, `contextTargets`, `formatTokens`, `contextMeter` (≥ 80% = `is-warn`), `paneMeter`. `agents.ts`: pole `context` (dodatnia liczba całkowita, inaczej błąd).
- App: odczyt co 5 s tylko paneli aktywnego projektu (od razu po przełączeniu projektu i zmianie rozmów) + zaraz po `finished` dla tych paneli; `null` nie kasuje ostatniego odczytu. Stan ulotny według `sessionId`.
- UI: `.ctx` w nagłówku panelu (`–` przed pierwszym odczytem), `src/Dock.tsx` (`.dock` 300 px): „Limity Claude” i „Na żywo” = „wkrótce”, „Kontekst” = `.ctx-row` paneli aktywnego projektu (model w `title`). Przycisk „Pulpit” (`Gauge`, `is-on`) + Ctrl+Alt+D → `ui.dock`. CSS dosłownie ze wzoru (`--on-ag-track` zamiast `rgba` na `fh-fill`), `dockIn`/`barIn` wyłączone przy `motion-lite` i `prefers-reduced-motion`.
- Sprawdzenia: typecheck czysty, vitest 152/152, cargo test 17/17, cargo build 0 ostrzeżeń. Podgląd (headless Firefox, mock rośnie o 1,5k na odczyt): mierniki w nagłówkach i pulpicie, odświeżenie po 5 s, Ctrl+Alt+D i przycisk zapisują `ui.dock`, projekt bez claude/pi pokazuje „Brak paneli z claude albo pi”.
- Niesprawdzone: odczyt prawdziwych plików claude/pi w oknie Tauri (testy nie czytają `~/.claude` ani `~/.pi`) – zgodność liczby z `/context` w claude do sprawdzenia przez użytkownika; pulpit przy wąskim oknie (< 900 px) zabiera dużo miejsca siatce.

## M2 Etap 7 – 2026-09-30 (Claude, za zgodą użytkownika zamiast lokalnego modelu)

- `src/write-queue.ts` + 11 testów (fałszywy zegar): `WriteQueue` na panel – paczki do `BATCH_BYTES` 64 KB (duże kawałki cięte, małe sklejane), następna paczka w callbacku `x.write(data, cb)`; panel z `clientWidth === 0` pisze najwyżej co `HIDDEN_INTERVAL_MS` 250 ms, nic nie gubi; `dispose` przy odmontowaniu.
- Poza planem, bo sama kolejka nie wystarczyła: `WriteGate` – jedna paczka w xterm naraz dla wszystkich paneli, po kolei. Pomiar pokazał, że skoki robi parsowanie (także przy panelach bez rysowania): 16 timerów xterm wypada naraz i klik czeka na całą serię. `dispose` zwalnia bramkę (zamknięty xterm nie woła callbacku).
- Aktywność: `onOutput` wołane przy przyjściu kawałka z PTY, przed kolejką (`Terminal.tsx`).
- Szczyt kolejki: `peak` na panel, `peakQueueBytes()` globalnie, w konsoli devtools okna `awPeakQueueMB()`; > 50 MB = jednorazowy `console.warn`.
- Pomiar w podglądzie (headless Firefox, temp strona 16 xterm × 20 MB „y\r\n” paczkami po 64 KB, usunięta; opóźnienie = najgorsze spóźnienie timera 16 ms): bez kolejki 530 ms, sama kolejka 447 ms, kolejka + bramka **31 ms** (0 skoków > 100 ms). Cena: całość w xterm 85 s zamiast 57 s. Szczyt kolejki 19,7 MB (< 50 MB, bez etapu z wstrzymywaniem PTY), przy strumieniu szybszym niż prawdziwy PTY.
- Sprawdzenia: typecheck czysty, vitest 140/140, cargo test 11/11, cargo build 0 ostrzeżeń.
- Niesprawdzone: test 16 × `yes | head -c 20M` w oknie Tauri (lista wyżej) – wynik i `awPeakQueueMB()` dopisać tutaj.

## M2 Etap 6 – 2026-09-30 (Claude)

- `src/motion.ts` (czyste) + 12 testów: `flipTransform` (próg 1 px / 1%), `maxOrigin` (środek komórki w `gridShape`), `enterClass` (dalej na szynie = `enter-next`), `enterDelayMs` (60 ms na panel przez 700 ms), `motionAllowed`; stałe `FLIP_MS` 340, `FLIP_EASE` ze wzoru.
- `Grid.tsx`: FLIP komórek (`element.animate`, `transform-origin: 0 0`) po dodaniu/zamknięciu/przywróceniu, tylko przy zmianie listy paneli lub maksymalizacji w tym samym projekcie. Pudełka z `offset*` (bez transformacji), odświeżane `ResizeObserver`em siatki (okno, szyna) – FLIP nie startuje ze starych pudełek.
- Maksymalizacja: `.pane-cell.is-maxed` = `grow` 0,44 s z `transform-origin` = miejsce panelu w siatce; przywrócenie = FLIP z pełnego obszaru do komórki. Przełączenie projektu: `enter-next`/`enter-prev` na siatce (`slideNext`/`slidePrev`), panele kolejno przez `--enter-delay` → `animation-delay` `.pane`.
- `motion-lite` (prop `motion` z `ws.ui`) i `prefers-reduced-motion` wyłączają FLIP (w JS), `grow` i wjazd (w CSS).
- `fit()`: transformacje nie ruszają `ResizeObserver` ani wymiaru z `getComputedStyle`; xterm 6 mierzy komórkę przez `offsetWidth`/OffscreenCanvas – skala w trakcie animacji go nie myli. Maksymalizacja zmienia rozmiar raz → jeden `fit()` na starcie `grow`.
- Sprawdzenia: typecheck czysty, vitest 129/129, cargo test 11/11, cargo build 0 ostrzeżeń. Podgląd w headless Firefoksie przez WebDriver BiDi (skrypt w scratchpadzie, świeży profil): `getAnimations()` pokazał FLIP po zamknięciu i dodaniu, `grow` z `75% 50%`, FLIP przy przywróceniu, `slideNext`/`slidePrev` z opóźnieniem 60 ms drugiego panelu, klasa wjazdu zdjęta po 700 ms, przy `motion-lite` zero animacji; zrzuty w połowie `grow` i wjazdu.
- Użytkownik w oknie Tauri: ruch „może nie 60 fps, ale jest ok” (WebKitGTK, rysowanie programowe). Przy 16 panelach niesprawdzone.

## M2 Etap 5 – 2026-09-30 (lokalny model, dokończył Claude)

- Wspólny `src/Dialog.tsx`: `.overlay` > `.backdrop` + `.dialog` (`pop`), Esc/klik w tło = anuluj i oddanie fokusu; `scrim={false}` = przezroczyste tło (popover). „Nowy panel” i „Presety” na nim; kafelki `.tile` z `tileDelayMs(i)` = 80 + 55·i ms (`new-pane.ts`, test).
- Okno „Wygląd” (`AppearanceDialog.tsx`, `.settings` ze wzoru) ze stopki szyny: wiersze z `UI_ROWS` w `ui.ts` (akcent = kółka `ACCENT_HEX`, reszta = `.seg`; `dock` pominięty do etapu 8), klik = `setUi` przez `uiPatch`, zapis ze zwykłym zapisem `workspace.json`. Przy niskim oknie karta się przewija (`max-height`).
- Komunikaty: `.toast` w prawym dolnym rogu, znikają po `TOAST_MS` = 4 s (`toast.ts`); błędy konfiguracji zostają w `.config-errors` z ✕. Podpowiedzi klawiszy w stopkach okien jako `<kbd>`.
- Claude po przejęciu: `toastText` faktycznie użyty w `applyPreset`, Enter w polu nazwy presetu respektuje `canSave`, wcięcia w `App.tsx`. Lokalny model zawiesił się na temp stronie seed (obserwator `MutationObserver` budził sam siebie → headless Firefox nie kończył ładowania); strona poprawiona na czas zrzutów i usunięta.
- Sprawdzenia: typecheck czysty, vitest 117/117, cargo test 11/11, cargo build 0 ostrzeżeń. Zrzuty headless Firefox (animacje wyłączone na czas zrzutu): „Nowy panel” (3 kafelki), „Presety” (wbudowane, własne z ✕, zapis), „Wygląd” (8 wierszy), toast „Brak agentów w konfiguracji: codex”.
- Niesprawdzone: animacje `pop`/`tileIn`/`toastIn` na żywo, znikanie toastu po 4 s, okno Tauri. W podglądzie toast nachodzi na napis „podgląd – bez prawdziwych procesów” (tylko podgląd).

## M2 Etap 4 – 2026-09-30 (Claude)

- Panel według wzoru D: `.glow`, `.ag-badge` (pierwsza litera agenta), `.pane-name`/`.pane-state` (mono, wersaliki), `.tools` przygaszone do 0,3 (pełne przy fokusie, najechaniu i `:focus-within`), miejsce na `.ctx` (komentarz, etap 8).
- `paneStatus()` w `activity.ts` zastępuje `rowState`/`dotClass`/`dotTitle`: `st-working` > `st-done` > `st-unread` > `st-exited` > `st-idle`; ten sam stan na szynie i w nagłówku.
- `done` w `PaneState`: App ustawia go na zdarzenie `finished` i zdejmuje po `DONE_MS` = 1600 ms (fala `wave`). Timery App w jednym `later()`, czyszczone przy odmontowaniu.
- Zamykanie: `closing` w App → `is-closing` (`paneOut` 190 ms, `PANE_OUT_MS` w `Pane.tsx`), dopiero potem `forget` + `close`; drugi klik w trakcie ignorowany.
- Proces zakończony: pasek `.pane-exit` „Proces zakończony (kod N) · Uruchom ponownie Ctrl+Alt+R”; szara linia w xterm usunięta z `Terminal.tsx`.
- Siatka: `.project-grid` → `.grid`, odstępy `var(--gap)`, ścieżki `minmax(0, 1fr)`. Stare `.dot*` i `.pane-tools` usunięte.
- Sprawdzenia: typecheck czysty, vitest 109/109 (usunięte testy `dotClass`/`dotTitle`), `vite build` OK. Podgląd w headless Firefoksie: nagłówek, plakietki, `fh-fill` OK.
- Niesprawdzone: pasek `.pane-exit`, fala `st-done` i `paneOut` na żywo (headless robi zrzut przed wyjściem procesu z mocka). Headless Firefox czasem nie rysuje tekstu Geist Mono 10,5 px (`kbd`, `.pane-state`) – DOM jest poprawny, w Tauri sprawdzić.

## M2 Etap 3 – poprawki (Claude)

- `--accent-hover` przeniesiony z `:root` na `.app` (na `:root` zawsze dawał pomarańcz, niezależnie od `acc-*`).
- `.btn.primary:disabled`: przygaszony cały przycisk (wcześniej `--muted` na tle akcentu – nieczytelne).
- Zwinięta szyna: stopka w kolumnie (dwie ikony 26 px nie mieściły się w 44 px); `PanelLeft` ma etykietę „Rozwiń/Zwiń szynę”.

## M2 Etap 3 – 2026-09-30 (lokalny model)

- `Rail.tsx` przepisany na wzór D: `.rail-head` (marka „AGENTS" + `PanelLeft`), `.rail-label`, `.proj` / `.proj-row` (`<kbd>` z numerem, nazwa, ścieżka `~/…`, `.proj-dot`), `.proj-panes` tylko pod aktywnym projektem (animacja `fold`), `.rail-foot` (`FolderPlus` + `SlidersHorizontal` „Wygląd", nieaktywny do etapu 5).
- Stan wiersza panelu: `rowState()` w `src/activity.ts` (`st-working|st-unread|st-exited|st-idle` + tekst po prawej), kropka projektu: `projectState()` (`has-work` pulsujące, `has-unread` akcent) + jednorazowy `ping` (App: tick 1 Hz, projekt ≠ aktywny, `PING_MS` = 1000 ms).
- Zwijanie szyny: Ctrl+Alt+B (`keys.ts`: `toggleRail`) → `ui.rail` (`open|closed`, zapis w `workspace.json`, klasa `rail-closed`); CSS `.rail-closed .rail { width: 56px }` wygrywa z media 720 px, w 56 px zostają `<kbd>` i kropki.
- Nagłówek obszaru: `.area-head` 70 px, `.area-name` Bricolage 32 px (`--title-size`, 16 px w `title-compact`), `.area-path`, `.area-count`, przyciski `.btn` / `.btn.primary` (zamiast `.btn-ico`; `.btn-ico`, stare `.rail-*` i `.dot--hidden` usunięte). `.area-name` ma `flex: none` — ścieżka zwija się pierwsza (priorytet wzoru); przy 11–12 px użyty `--muted` zamiast `--faint` dla kontrastu.
- `prefers-reduced-motion` wyłącza `breathe` (kropki), `ping` i `fold` (razem z `.glow` z etapu 1); `motion-lite` obejmuje `.proj-panes` (lista z etapu 1).
- Sprawdzenia: typecheck czysty, vitest 111/111, cargo test 11/11, cargo build 0 ostrzeżeń, `ui_audit` @1000/390: 0 wysokich, 16 średnich (wszystkie to wartości dosłowne ze wzoru: tekst 10,5/11/11,5 px, odstępy 9/10/7/6/5/3 px), 2 niskie (4 fonty i 4 barwy = z planu). Podgląd @1000 i @460 px na seedowanym `workspace` (temp pliki usunięte): szyna otwarta i zwinięta.
- Niesprawdzone: okno Tauri; Ctrl+Alt+B i `ping` na żywo (sprawdzone logiką i testami `commandFor`, nie klikaniem).

## M2 Etap 2 – 2026-09-30 (Claude)

- `lucide-react@^1.48.0` (zgodne z `^1.47.0` z planu); `src/IconButton.tsx`: 26×26, ikona 15 px, `strokeWidth 1.75`, `aria-label`/`title` ze skrótem, klasa `.icon` ze wzoru.
- Panel: `MessageSquarePlus`, `RotateCw` (Ctrl+Alt+R), `Maximize2`/`Minimize2` (Ctrl+Alt+Enter), `X` (Ctrl+Alt+W); „Na pewno?” zostaje tekstem.
- Szyna: `FolderPlus` (Ctrl+Alt+P), `X` przy projekcie; górny pasek: `LayoutGrid` Presety, `Plus` Panel; pusty ekran: `FolderPlus` Projekt; komunikat i presety: `X`.
- „Pulpit”, „Wygląd”, zwijanie szyny – ikony dojdą w etapach 3, 5, 8 (tych przycisków jeszcze nie ma).
- Sprawdzenia: typecheck czysty, vitest 106/106, cargo test 11/11, cargo build OK; zrzut podglądu (Firefox headless) – ikony na miejscu.
- Niesprawdzone: okno Tauri.

## M2 Etap 1 – 2026-09-30 (lokalny model, dokończył Claude)

- Fonty Geist, Geist Mono, Bricolage Grotesque (`@fontsource-variable/*@^5.3.0`), import w `main.tsx`.
- `styles.css`: tokeny ze wzoru D w `:root`, klasy `acc-*`, `fh-*`, `work-scan`, `edge-soft`, `title-compact`, `bg-grid`, `motion-lite`; kolory tylko w tokenach i `.acc-*` (grep czysty).
- `src/ui.ts` (`Ui`, `DEFAULT_UI`, `parseUi`, `uiClasses`, `ACCENT_HEX`) + testy; `workspace.ts`: pole `ui`, akcja `setUi`, stary plik bez `ui` wczytuje się bez błędów.
- `agents.ts`: `color` (`#rrggbb`) + `agentColor()`; `--ag` na panelach i wierszach szyny; `.app` dostaje `uiClasses(ws.ui)`.
- Terminal: tło `#0d0e11`, tekst `#c6ced8`, kursor = akcent; zmiana akcentu podmienia `x.options.theme` bez restartu.
- Sprawdzenia: typecheck czysty, vitest 106/106, cargo test 11/11, cargo build OK.
- Niesprawdzone: wygląd w oknie Tauri (brak jeszcze okna „Wygląd” – ustawienia zmienia się w `workspace.json` do etapu 5).

## Pomiar obciążenia (lokalny model, podgląd) – 2026-09-30
- Rdzeń PTY (Rust): 16 procesów × 20 MB w 8,05 s.
- Podgląd, 16 xterm × 20 MB: przy realnym tempie wyjścia UI żyje (0 longtasków); przy
  jednoczesnym zrzucie wszystkiego naraz UI się zacina. Na później (M2): dławienie zapisu do
  xterm (callback `write`, paczki na klatkę), zwłaszcza w schowanych siatkach.
- Filtr raportów fokusu (DECSET 1004): w oknie nadal do potwierdzenia.

## M1 Etap 11 – 2026-09-30
Porządki: scrollback xtermu 5000 → 3000 (limit pamięci przy 16 panelach) + komentarz przy warunku
`el.clientWidth === 0` w `ResizeObserver`. `fit()` dla ukrytych paneli zmierzony w podglądzie (temp strona
seed, usunięta): panel w schowanej siatce startuje z 5 wierszami (fit słusznie nic nie robi na elemencie
0 px), a po przełączeniu projektu ma 32 wiersze i te same 761 px co panel widoczny — czyli observer
strzela po zdjęciu `display: none`; po maksymalizacji wymiary bez zmian (siatka 1×1 = ten sam obszar).
Do tego w `Terminal.tsx` leżała w drzewie niezacommitowana zmiana z poprzedniej sesji (odfiltrowanie raportów
fokusu DECSET 1004 w `onData`, żeby TUI odświeżane w panelu bez fokusu nie wyglądały jak praca agenta) —
wpisana tu razem z etapem 11, przeżyła typecheck i testy, w oknie niesprawdzona.
Nowy `README.md` (uruchomienie, `agents.json` z przykładem codexa, skróty, presety), lista wyżej do
sprawdzenia w oknie, `PLAN.md`: M1 oznaczone jako zrobione. Sprawdzania: typecheck czysto, vitest 93/93,
cargo test 11/11, cargo build 0 ostrzeżeń, `tauri` w `Cargo.lock` 2.12.0, `ui_audit` :5183 bez nowych flag
(0 wysokich / 6 średnich = te same co w etapach 8–10). Niesprawdzone: cała lista powyżej (okno Tauri);
BrowserOS w tej sesji niedostępny, więc klikanie po podglądzie zastąpione temp stronami seed ze skryptem.

## M1 Etap 10 – 2026-09-30
Presety: `src/presets.ts` = `BUILT_IN_PRESETS` (Claude + pi / 2× Claude + 2× pi / 4× Claude) i czysty
`planPreset(preset, knownIds, slots)` → `{agents, skipped, dropped}` (nieznani agenci nie jedzą miejsc) + 9 testów.
`reduce`: `savePreset {name}` (panele aktywnego projektu w ich kolejności, nazwa po `trim()`, ta sama nazwa
nadpisuje, pusty projekt / pusta nazwa = brak zmiany) i `deletePreset {name}` + 5 testów (własne w `workspace.presets`,
już parsowane w etapie 4). `src/PresetMenu.tsx` (nakładka jak „Nowy panel”, Esc zamyka): wbudowane, kreska,
własne z ✕, na końcu pole nazwy + „Zapisz obecny układ…” (wyłączony bez paneli); wbudowany o nazwie własnej
jest ukrywany (nie dublujemy wierszy). App: `applyPreset` dodaje panele na koniec aktywnego projektu (`add` w pętli,
sessionId jak przy „+ Panel”), komunikat o pominiętych agentach i o limicie; Grid: w pustym projekcie presety
wbudowane jako przyciski obok „+ Panel”. Sprawdzania: typecheck czysto, vitest 93/93, cargo test 11/11, cargo build
0 ostrzeżeń, `tauri` w `Cargo.lock` 2.12.0. `ui_audit` :5183 (1000 px + 390 px): 0 wysokich / 6 średnich — te same
co w etapach 8–9 (kompaktowe 4/8 px w chrome, siatka komórek xtermu); po naprawie zniknęły dwie nowe flagi
(wysokości 36/20 px w wierszu z ✕, przesunięty `.pm-hint`). Niesprawdzone: okno Tauri (presety tylko TS/UI);
BrowserOS znów niedostępny (`MCP server "browseros" not available`) → menu, pusty projekt i zapis presetu obejrzane
zrzutami `look` na temp stronach seed (usunięte): wiersz presetu dodaje panele, przy 15 panelach komunikat
„Pominięto 1 z powodu limitu 16 paneli na projekt”, przy braku agenta „Brak agentów w konfiguracji: codex”,
zapis + usunięcie widoczne w `localStorage` (`duo=claude,pi`).

## Przegląd etapów 8–9 (Claude) – 2026-09-30
- Panel z fokusem, który coś wypisał, gdy okno było w tle, zostawał z akcentową kropką po
  powrocie do okna (fokus panelu się nie zmienia, więc nic jej nie kasowało). Teraz kasuje ją
  zdarzenie `focus` okna.
- Poprawka w opisie etapu 9: `notify.rs` usuwa zmienne `own_env()` ze środowiska `notify-send`.

## M1 Etap 9 – 2026-09-30
Aktywność: `src/activity.ts` (czyste `onOutput`/`onResize`/`tick`, progi 2000/3000/500 ms, `dotClass`/`dotTitle`)
+ 11 testów. `Terminal` zgłasza każdy chunk od procesu (`onOutput`) i zmianę rozmiaru xtermu (`onRedraw`);
`App` trzyma czasy w `useRef(Map)` (chunki nie restartują Reacta), `setInterval` 1 s → `tick`, a stan ulotny
panelu to teraz `PaneState {exited, working, unread}` (zastąpił mapę `exited` w `Rail`/`Grid`/`Pane`).
`unread` = wyjście panelu bez fokusu lub bez fokusu okna (`document.hasFocus()`), kasowane przy fokusie
(też przy przejściu strzałką na inny projekt). Kropki: `.dot--working` (puls, `prefers-reduced-motion` wyłącza),
`.dot--unread` (akcent), `.dot--hidden` (rezerwuie miejsce w wierszu projektu; akcent, gdy któryś panel ma `unread`).
Powiadomienie: `src-tauri/src/notify.rs` = `notify-send -a Agents <tytuł> <treść>` (spawn, `wait` w wątku, bez `own_env`,
błąd na stderr), mock = `console.info`; `notify` w `Backend` — bez nowej zależności i bez wpisu w capability (komenda aplikacji).
Sprawdzenia: typecheck czysto, vitest 78/78, cargo test 11/11, cargo build 0 ostrzeżeń, `tauri` w `Cargo.lock` 2.12.0.
`ui_audit` :5183 (1000 px + 390 px): 0 wysokich / 6 średnich (te same co w etapie 8: kompaktowe 4/8 px w chrome
i siatka komórek xtermu). `x.onResize` w `Terminal.tsx` łączy `pty.resize` ze zgłoszeniem `onRedraw` (resize nie zmienia zachowania PTY).
Niesprawdzone: BrowserOS znów niedostępny (`MCP server "browseros" not available`) → kropki obejrzane zrzutem `look`:
`unread` na panelu pi i na wierszach Projekt A/B, `działa` na czytanym panelu; `working` (2 s po wyjściu) i `finished`
(seria ≥ 3 s) nie do uchwycenia zrzutem — logika w testach, ścieżka renderowania ta sama co dla `unread`.
W oknie Tauri `notify-send` i `document.hasFocus()` wołane po raz pierwszy.
Ręcznie (użytkownik): długie zadanie w drugim panelu → pulsująca kropka; po ≥ 3 s ciszy powiadomienie
„Agents: Claude — skończył pracę w <projekt>”; klik w panel kasuje akcentową kropkę; fokus okna = brak powiadomień.

## M1 Etap 8 – 2026-09-30
Skróty: `src/keys.ts` (`commandFor`, table Ctrl+Alt+←/→/↑/↓, Enter, N, W, R, P, 1–9 oraz
Ctrl+Shift+C/V; reszta → `null`, więc Ctrl+C i Ctrl+V zostają dla terminala). App: jeden
`keydown` na `window` w fazie capture + `preventDefault` dla rozpoznanych; handler w `useRef`
(ma aktualny stan, subskrypcja efektu z `[]`). `Terminal.tsx`:
`attachCustomKeyEventHandler(e => commandFor(e) === null)` (xterm nie wysyła naszych skrótów
do procesu) oraz uchwyt `copySelection()/paste()` przez `useImperativeHandle` → `Pane` rejestruje
go w mapie App (`registerTerminal` w `PaneActions`, klucz = id panelu, kopiowanie z panelu
z fokusem modelu). `closePane` z klawiatury używa tej samej reguły co ✕ (`confirmClick`, 3 s);
`armedPane` w App podświetla „Na pewno?” w nagłówku. Schowek: `Backend.copyText/pasteText`
tauri-plugin-clipboard-manager ~2.4 / `@tauri-apps/plugin-clipboard-manager` 2.4.0
(`clipboard-manager:allow-read-text|write-text` w capability, plugin w `lib.rs`; mock =
`navigator.clipboard` z buforem awaryjnym). Na szynie numery 1–9 przy nazwach (`.rail-key`).
Sprawdzenia: typecheck czysto, vitest 66/66 (8 nowych `keys.test.ts` + kopiuj→wklej w mocku),
cargo test 10/10, cargo build 0 ostrzeżeń, `tauri` w `Cargo.lock` nadal 2.12.0.
`ui_audit` :5183 (stan z 2 projektami i 3 panelami, seed przez temp `seed-preview.html` — usunięty):
0 wysokich / 8 średnich / 0 niskich. Wysoki (kontrast `rail-count` 4,4:1 na aktywnym wierszu)
naprawiony; średnie to `text-touches-edge` w kompaktowym chrome (wiersz szyny 28 px, nagłówek
panelu 26 px, padding 4/8 px) i wewnątrz warstwy xtermu (0 px — siatka komórek xtermu, nasza
reguła by ją rozjechała) — zostawione celowo.
Niesprawdzone: **klawiatura interaktywnie** (BrowserOS niedostępny w tej sesji: `fetch failed`,
brak chromium na PATH → w podglądzie sprawdzony tylko rendering: szyna z numerami, 3 panele,
fokus; logika mapowania w testach, Wiring `preventDefault`/dispatch tylko z przeglądu diffu),
oraz okno Tauri: plugin schowka i uprawnienia po raz pierwszy wołane, Ctrl+Alt u WebKitGTK.
Ręcznie (użytkownik): Ctrl+Alt+N → okno panelu, Ctrl+Alt+Enter maksymalizacja, Ctrl+Alt+W
dwukrotnie = zamknięcie, Ctrl+Alt+2 zmiana projektu, zaznacz tekst → Ctrl+Shift+C, w drugim
panelu Ctrl+Shift+V, plain Ctrl+V w claude nadal wkleja, plain Ctrl+C nadal przerywa.

## Przegląd etapu 7 (Claude) – 2026-09-30
- Usunięty drugi, stary efekt `loadAgents` w `App.tsx`: biegł równolegle ze startem i jego
  `setErrors(r.errors)` kasował błędy parsowania `workspace.json`.
- Błąd odczytu pliku (np. nie-UTF-8) robi teraz kopię `.bak` przed pierwszym zapisem; wcześniej
  pusty stan nadpisywał plik bez kopii.
- Data kopii liczona lokalnie, nie w UTC (po 22:00 wychodził jutrzejszy dzień).

## M1 Etap 7 – 2026-09-30
Zapis/wznowienie: Rust `config.rs` – `workspace_load` (brak pliku → `None`), `workspace_save` przez
`write_atomic`, `workspace_backup(date)` → kopie `workspace.<RRRR-MM-DD>.bak` obok, bez nadpisywania
istniejącej (datę liczy TS, Rust validating `[0-9-]` – bez nowej zależności). TS: `loadWorkspace`/
`saveWorkspace`/`backupWorkspace` w `Backend`; mock w `localStorage` (try/catch). `App.tsx`: start
`loadAgents` → `loadWorkspace` → `parseWorkspace` → `load` (przed wczytaniem napis „Wczytywanie…”,
błędy parsowania/JSON → `backupWorkspace` przed pierwszym zapisem), zapis `useEffect` na `[ws, loaded]`
(`JSON.stringify(ws, null, 2)`, bez debounce). Panel z `session` ma „+” (Nowa rozmowa) w nagłówku →
`newConversation` (nowe sessionId + run+1). Naprawiony błąd: `Terminal` montował się przy „Nowa rozmowa”
ze **starymi** args (efekt liczy args po macie; spawn czyta args raz przy montażu) – `Pane` stempluje
args `{run, sessionId}` i renderuje `Terminal` tylko gdy stempl pasuje do panelu (znaleziono w podglądzie:
banner pokazywał stare id, localStorage już nowe).
Sprawdzenia: typecheck czysto, vitest 57/57 (round-trip `Workspace→JSON→parseWorkspace` z etapu 4),
cargo test 10/10 (nowy: backup kopiuje raz, brak źródła = brak kopii), cargo build 0 ostrzeżeń.
Podgląd :5183 (BrowserOS): start bez pliku → pusty stan; zapis → reload → projekt + panele claude/pi
wracają, claude dostaje zapisane sessionId, „+” → proces z nowym id w bannerze (przed naprawą: ze starym),
reload → oba panele na miejscu. `ui_audit` :5183: 0 wysokich / 0 średnich / 0 niskich.
Niesprawdzone: okno Tauri (`workspace.json`, `write_atomic`, backup z prawdziwą datą – po raz pierwszy
wołane); ręczny test użytkownika: dwa projekty, panele claude + pi z wiadomością, zamknij/otwórz →
rozmowy na miejscu. Uwaga: podgląd dzieli `localStorage` z poprzednimi stanami – start ze śmieciami
parsuje `parseWorkspace`, czysty stan = skasować klucz `aw-workspace`.

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
