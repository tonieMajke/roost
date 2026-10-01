# HANDOFF

Najnowszy wpis na górze. Każdy etap z `docs/plan-m1.md` dopisuje tu 3–8 linii.

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
