# Plan „Rozmowa głosowa” – kuleczka na żywo (eksperyment)

Dopisane 2026-10-01 z rozmowy z użytkownikiem. **To jest test, poza planem M5.** Jeśli
będzie działać średnio, wycinamy go w całości (patrz „Jak wyciąć”). Dlatego cały kod
siedzi w osobnych folderach, a w istniejących plikach są tylko pojedyncze punkty
zaczepienia.

Wzór: tryb głosowy ChatGPT i Claude'a. Mówisz normalnie, odpowiedź przychodzi po
około sekundzie, możesz mu wejść w słowo i nic nie klikasz.

Co ma działać po tym planie:
1. Przycisk w Railu → w rogu okna pojawia się **kuleczka**. Pulsuje, gdy mówisz,
   „myśli”, gdy model pracuje, i faluje, gdy on mówi. Klik = wycisz, drugi przycisk = koniec.
2. **Rozmowa na żywo:** mikrofon otwarty cały czas, koniec wypowiedzi wykrywany ciszą
   (VAD), odpowiedź czytana od pierwszego zdania i **przerywanie**: gdy zaczynasz
   mówić, on milknie.
3. **Głos i mózg wybierane osobno:**
   - słuchanie (STT): lokalny serwer albo API, te same silniki co dyktowanie (`stt.json`),
   - mówienie (TTS): lokalnie (Piper) albo API (`/audio/speech`),
   - mózg: dowolny model z Czatu (`chat.json`), czyli Claude (API albo `claude` CLI)
     albo model lokalny (llama-server).
4. **„OK, deploy”:** rozmówca rozpisuje omówiony plan na zadania i pokazuje kartę
   („2× claude: A – backend, B – testy”). Po potwierdzeniu otwiera panele w aktywnym
   projekcie i wkleja każdemu jego zadanie. Potem może przeczytać, co robią, i streścić to głosem.

Poza planem: wywoływanie głosem bez przycisku („hej …”), modele mowa↔mowa
(Realtime, Gemini Live: mają wbudowany mózg, więc nie da się pod nie podpiąć Claude'a),
STT strumieniowane w trakcie mówienia, głos w zakładce Bot.

## Decyzje

- **Łańcuch, nie model mowa↔mowa:** `mikrofon → VAD → STT → mózg → TTS → głośnik`.
  Między częściami płynie zwykły tekst, więc każdą część można wymienić osobno.
- **STT na całą wypowiedź, nie strumieniowo.** VAD wycina wypowiedź, a my wysyłamy ją
  istniejącym `transcribe()` z `electron/src/stt.ts`. Krótka wypowiedź (2–5 s) trwa na
  whisperze około 0,2–0,6 s. Strumieniowanie dorobimy dopiero, gdy pomiar pokaże,
  że STT jest wąskim gardłem.
- **TTS zdanie po zdaniu.** Strumień tekstu z mózgu jest cięty na zdania
  (`splitSentences`). Pierwsze zdanie idzie do TTS od razu, kolejne trafiają do kolejki
  odtwarzania. Przed wysłaniem do TTS usuwamy markdown (`speakable`).
- **Silniki TTS** (`tts.json`, klucze w sejfie jako `tts-<id>`, wzór jak `stt.json`):
  - `kind: "speech"`: `POST {baseUrl}/audio/speech` w formacie OpenAI. Szablony: OpenAI
    i „Lokalny serwer” (speaches / Kokoro-FastAPI mówią tym samym API).
  - `kind: "piper"`: lokalny proces `piper --model <plik.onnx> --output_dir <tmp>`: zdanie
    jako linia na stdin, ścieżka gotowego WAV-a na stdout, w kolejności (`--output_raw` nie
    ma granic między zdaniami). Uruchamiany raz na rozmowę i trzymany przy życiu.
    Zmierzone (etap 2, wydanie 2023.11.14-2, `pl_PL-gosia-medium`): ~0,15–0,2 s na zdanie.
- **Mózg = ta sama droga co Czat** (`chatSend` / `chat_send`, `ChatRequest`). Prompt
  systemowy rozmówcy (`voicePrompt`) każe odpowiadać krótko, mową, bez list i kodu,
  i pytać, gdy coś jest niejasne.
  - Dostawcy HTTP (`anthropic`, `openai`): pełne strumieniowanie i narzędzia (etap 5).
  - `claude-cli` / `codex-cli`: działa, ale tylko rozmowa, bez narzędzi (serwer MCP
    z M5 etapu 5 jeszcze nie istnieje), z większym opóźnieniem na start procesu.
    UI to mówi.
- **VAD własny, po energii** (`src/voice/vad.ts`; zmiana w etapie 3, wcześniej `@ricky0123/vad-web`):
  tamta biblioteka ładuje `.onnx`/`.wasm` przez `fetch`, a strona Electrona stoi na `file://`.
  Ramki 20 ms przy 16 kHz z AudioWorkleta (moduł z adresu blob), próg = szum tła × 3 (szum
  uczony z ciszy, 300 ms kalibracji na start), koniec po 600 ms ciszy. Bez nowej zależności.
  Silero można dołożyć później, wymiana dotyczy tylko `vad.ts`.
  Mikrofon z `echoCancellation`, `noiseSuppression` i `autoGainControl`. Gdy rozmówca mówi,
  próg wykrycia mowy idzie w górę, żeby nie przerywał sam sobie przez głośniki.
  Przełącznik „mam słuchawki” wyłącza tę ochronę i daje szybsze przerywanie.
- **Przerwanie:** początek mowy w trakcie odtwarzania = stop odtwarzania, abort żądania
  do mózgu i TTS. Do historii trafia tylko to, co zdążył powiedzieć, z dopiskiem
  „[przerwano]”, tak samo jak przy Stop w czacie.
- **Narzędzia rozmówcy działają w oknie, nie w procesie głównym**, bo panele i reducer
  workspace żyją w `App.tsx`. Przy dostawcach HTTP pętla jest po stronie strony:
  model → `tool_call` → handler w oknie → wynik → model, najwyżej 8 kroków.
  - `list_panes()`: panele aktywnego projektu (id, agent, czy pracuje, z `activity.ts`).
  - `open_panes(tasks: {agent: "claude"|"pi", title, prompt}[])`: **zawsze z kartą
    potwierdzenia.** „Tak” (głosem albo kliknięciem) = `addPane` dla każdego zadania,
    a po starcie procesu `paste(prompt + "\r")`. Limit: `MAX_PANES` z workspace.
  - `send_to_pane(id, text)`: z potwierdzeniem, wkleja i wysyła Enterem.
  - `read_pane(id)`: ostatnie około 60 linii z bufora xterm (nowa metoda `TerminalHandle.tail`).
- **Dane:** `voice.json` w `configDir()`:
  `{ brain: ModelRef | null, tts: string | null, voice: string, headphones: boolean }`.
  STT bierze aktywny silnik ze `stt.json`. Rozmowy nie są zapisywane (to test).
  W panelu kuleczki widać transkrypt bieżącej rozmowy, który znika po zamknięciu.

## Budżet opóźnienia (cel: < 1,5 s od końca mowy do pierwszego dźwięku)

| krok | lokalnie | API |
|---|---|---|
| VAD: cisza = koniec | 0,4 s | 0,4 s |
| STT wypowiedzi | 0,2–0,6 s | 0,3–0,8 s |
| mózg: pierwsze zdanie | 0,3–1 s (Qwen) | 0,5–1 s (Claude API), 3+ s (`claude` CLI) |
| TTS pierwszego zdania | 0,1–0,3 s (Piper) | 0,3–0,6 s |

Etap 3 mierzy każdy krok i pokazuje czasy w transkrypcie (mały szary dopisek).
Bez tych liczb nie da się zdecydować, czy eksperyment zostaje.

## Ryzyka do sprawdzenia na początku etapów

- Echo przez głośniki mimo `echoCancellation` (Chromium na PipeWire). Jeśli przerywa
  sam siebie, domyślnie włączamy „mam słuchawki = nie” z wyższym progiem albo
  half-duplex (podczas jego mowy przerwanie tylko klikiem).
- Piper: czy jest w repozytoriach CachyOS/AUR (`piper-tts-bin`) i czy polski głos
  (`pl_PL-gosia`/`darkman`) brzmi znośnie. Sprawdzić ręcznie przed etapem 2.
- Lokalny Qwen może słabo rozpisywać plan na zadania w `open_panes`. To akceptujemy:
  karta potwierdzenia pokazuje zadania przed uruchomieniem.

## Kto robi

Jak w M5: **L** – lokalny model, **C** – Claude. Zasady z `AGENTS.md` bez zmian.
Praca na osobnej gałęzi `glos` (od `konta` po zacommitowaniu dyktowania).
Bez nowych zależności (VAD własny, patrz „Decyzje”).

## Postęp

- [x] Etap 1 (L) – logika rozmowy bez UI
- [x] Etap 2 (C) – silniki TTS w procesie głównym
- [x] Etap 3 (C) – kuleczka: rozmowa na żywo bez narzędzi
- [x] Etap 4 (C) – ustawienia rozmowy
- [x] Etap 5 (C) – narzędzia: panele i „deploy”
- [x] Etap 6 (C + użytkownik) – próba w oknie i decyzja: zostaje albo wycinamy (2026-10-01: działa, zostaje)
- [x] Etap 7 (C) – rozmówca jako asystent całej aplikacji

---

## Etap 1 (L) – logika rozmowy bez UI

Nowy `src/voice/voice.ts` (czyste funkcje, testy w `src/voice/voice.test.ts`):

- `parseVoiceConfig(text | null)` → `{ config, errors }`, a `parseTtsConfig` jak `parseSttConfig`
  (szablony `TTS_PRESETS`: OpenAI `tts-1`/`gpt-4o-mini-tts`, „Lokalny serwer”, Piper).
- `splitSentences(buffer)` → `{ ready: string[], rest: string }`. Granice: `.?!…` + spacja
  albo nowa linia, bez cięcia na skrótach („np.”, „itd.”, „m.in.”, „dr.”) i liczbach
  („3.5”). Bardzo długie zdanie (> 200 znaków) tnie na przecinku.
- `speakable(md)`: bez markdownu, linków (zostaje tekst), bloków kodu („[kod pominięty]”)
  i emoji.
- `voiceReducer(state, event)`: stany `idle | listening | transcribing | thinking |
  speaking`, zdarzenia `speech_start`, `speech_end`, `transcript`, `delta`,
  `audio_start`, `audio_end`, `interrupt`, `error`, `stop`. Test: przerwanie w każdym
  stanie daje `listening` i poprawną historię.
- `voiceTurns(history)` → `turns` do `ChatRequest`. Przerwana odpowiedź = tylko
  wypowiedziana część + „[przerwano]”. Najwyżej 30 ostatnich wymian.
- `voicePrompt(now, panes?)`: stały tekst + lista paneli, gdy są narzędzia.

Sprawdzenia z `AGENTS.md`. Commit: `Głos Etap 1: logika rozmowy`.

## Etap 2 (C) – silniki TTS w procesie głównym

- `electron/src/voice/tts.ts`: `ttsConfigLoad/Save` (`tts.json`) i
  `speak(provider, key, text, voice, signal)` → `{ pcm | encoded, mime, sampleRate }`.
  - `speech`: `POST /audio/speech` `{ model, input, voice, response_format: "wav" }`.
  - `piper`: `PiperProcess` trzymany na rozmowę, kolejka zdań, zamykany przy `voice_end`
    i przy zamknięciu okna (zabijanie po PID, jak `proc.ts`).
- IPC: `tts_config_load/save`, `voice_speak(reqId, text)` (abort przez `voice_cancel`),
  `voice_end`. Klucze przez istniejący sejf (`tts-<id>`).
- Testy: prawdziwy serwer HTTP (jak `stt.test.ts`), sztuczny `piper` (skrypt w `fixtures/`,
  który oddaje stałe PCM). Abort w połowie nie zostawia procesu.

Commit: `Głos Etap 2: silniki TTS`.

## Etap 3 (C) – kuleczka: rozmowa na żywo bez narzędzi

- `src/voice/vad.ts` (VAD i WAV), `src/voice/session.ts` (przebieg bez DOM), `src/voice/audio.ts`
  (mikrofon przez AudioWorklet, głośnik z `AnalyserNode`).
- `src/voice/useVoiceSession.ts`: VAD → `transcribe` (istniejące IPC dyktowania) →
  `chatSend` ze strumieniem → `splitSentences` → `voice_speak` → kolejka odtwarzania
  w Web Audio (`AnalyserNode` daje głośność do animacji). Przerwanie zgodnie z „Decyzjami”.
  Czasy kroków zapisywane przy każdej wymianie.
- `src/voice/VoiceOrb.tsx` + `voice.css`: kuleczka w prawym dolnym rogu (przeciągalna),
  kolor z motywu, skala/fala z głośności. Rozwijany transkrypt z czasami. Przyciski:
  wycisz, zakończ.
  Szanuje `prefers-reduced-motion` (tylko zmiana koloru).
- Punkty zaczepienia: przycisk „Rozmowa” w `Rail.tsx`, `<VoiceOrb>` w `App.tsx`,
  metody w `backend.ts` / `backend-electron.ts` / `backend-mock.ts` (mock: sztuczna mowa
  i odpowiedź, żeby wygląd dało się sprawdzić w `pnpm dev`).
- Testy: hook z udawanym VAD i backendem (przerwanie, abort, kolejność zdań).

Commit: `Głos Etap 3: kuleczka i rozmowa na żywo`.

## Etap 4 (C) – ustawienia rozmowy

- `VoiceDialog.tsx` dostaje zakładki **Dyktowanie | Rozmowa**. W „Rozmowie”: mózg (lista
  modeli z Czatu, przy CLI dopisek „bez narzędzi, wolniejszy start”), silnik TTS
  (szablony, adres, model, klucz, głos), „mam słuchawki”, przycisk **Posłuchaj**
  (czyta zdanie próbne i pokazuje czas).
- Bez ustawionego mózgu albo TTS klik w kuleczkę otwiera tę zakładkę (jak mikrofon w dyktowaniu).

Commit: `Głos Etap 4: ustawienia rozmowy`.

## Etap 5 (C) – narzędzia: panele i „deploy”

- `src/voice/tools.ts`: definicje 4 narzędzi (`list_panes`, `open_panes`, `send_to_pane`,
  `read_pane`) i ich wykonanie na `ProjectActions` / `PaneActions` z `App.tsx`.
- `TerminalHandle.tail(lines)` w `Terminal.tsx` (tekst z bufora xterm).
- Pętla narzędzi w oknie (najwyżej 8 kroków). Format wywołań z `ChatEvent` (`tool_call`) –
  sprawdzić, czy `chat_send` przekazuje `req.tools` do `openaiBody`/`anthropicBody`;
  jeśli nie, dopisać to w `service.ts`.
- **Karta deploy** nad kuleczką: lista zadań (agent, tytuł, pierwsze linie promptu),
  „Uruchom” / „Popraw” / „Anuluj”. Głosowe „tak/uruchom/OK” zatwierdza tylko wtedy,
  gdy karta jest widoczna. Wklejenie promptu dopiero po `started(paneId)` + 1,5 s
  (TUI claude musi się narysować) albo gdy `acceptsPaste` zwróci prawdę.
- Testy: wykonanie narzędzi na udawanych akcjach, odrzucenie karty = wynik
  „użytkownik odmówił”, limit paneli.

Commit: `Głos Etap 5: panele i deploy z rozmowy`.

## Etap 6 (C + użytkownik) – próba w oknie

Użytkownik w oknie sprawdza i zapisuje w HANDOFF:
- [ ] czasy (lokalny głos + Qwen, API + Claude), czy rozmowa „płynie”,
- [ ] przerywanie przez głośniki i na słuchawkach,
- [ ] jakość polskiego głosu: Piper i API,
- [ ] scenariusz: omówienie pomysłu → „OK, deploy” → 2 panele claude dostają zadania.

Decyzja: **zostaje** (plan na poprawki) albo **wycinamy**.

## Etap 7 (C) – rozmówca jako asystent całej aplikacji

Dopisane 2026-10-01 po próbie: „działa, brakuje możliwości działania w Agents”. Użytkownik wybrał
sterowanie panelami, projekty, konta i modele, boty i Czat oraz informacje o postępach („co robią
agenci, które wymagają uwagi”). Akcje bez skutków (pokaż, przełącz) działają od razu, reszta przez kartę.

- Narzędzia (`src/voice/tools.ts`): `overview` (wszystkie projekty, stan paneli, „wymaga uwagi”),
  `read_pane`, `show` (projekt / panel / zakładka, bez karty), `list_agents` (konta, modele, presety),
  `open_panes` (projekt, konto, model), `send_to_pane`, `pane_control` (stop/restart/nowa rozmowa/
  zamknij), `continue_elsewhere`, `apply_preset`, `ask_bot` (`src/voice/askBot.ts`).
- Prompt rozmówcy zawiera przegląd aplikacji z chwili pytania.
- Komunikat głosem, gdy agent skończy pracę w trakcie rozmowy (w ciszy; mowa użytkownika go ucisza).

Commit: `Głos Etap 7: rozmówca steruje aplikacją`.

## Jak wyciąć

1. Usuń `src/voice/`, `electron/src/voice/`, `docs/plan-glos.md`.
2. Cofnij punkty zaczepienia: przycisk w `Rail.tsx`, `<VoiceOrb>` w `App.tsx`, metody
   głosu w `backend*.ts`, IPC w `main.ts`/`preload.ts`, zakładkę „Rozmowa” w
   `VoiceDialog.tsx`, `TerminalHandle.tail`.
3. Pliki `voice.json` i `tts.json` w `configDir()`
   można zostawić albo skasować ręcznie.

Prościej: nie scalać gałęzi `glos`.
