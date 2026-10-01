# PLAN: statystyki zużycia tokenów

Status: zaimplementowane etapy 1–4 w wersji dialogowej (gałąź `worktree-statystyki-tokenow`, bez commitów).
Odstępstwa od planu:

- Brak `Message.usage`: źródłem prawdy jest dziennik `usage.jsonl` (przeżywa usunięcie czatu).
- Brak cennika i szacowania kosztu: pokazujemy tylko koszt podany przez `claude -p` (Czat i Boty). Koszt wymaga cennika z oficjalnych źródeł, osobny krok.
- Indeks logów jest per plik (przeparsowanie zmienionego pliku), nie przyrostowy po offsetach: pełny skan 560 MB trwa ok. 1,5 s, ponowny 5 ms.
- Napisy w oknie są po polsku wprost: ta gałąź nie ma jeszcze `src/i18n/` (jest w niescommitowanych zmianach `konta`). Przy scalaniu trzeba je przenieść do obszaru `stats`.
- Widget w Docku odrzucony (Dock ma już „Limity Claude” i „Kontekst”): statystyki tylko w oknie z przycisku „Statystyki”.
- Etap 5 (eksport CSV, ustawienie „ekwiwalent API”) niezrobiony.

## Cel

Pokazać w aplikacji, ile tokenów zużywamy, na co i gdzie:

- suma tokenów w czasie (dzień / tydzień / miesiąc / wszystko),
- podział na projekty (Code), czaty, boty,
- podział na modele i na providerów / konta,
- rozbicie na rodzaje: wejście, wyjście, cache (odczyt / zapis), rozumowanie,
- najczęściej używany model,
- koszt tylko tam, gdzie ma sens (klucze API); dla subskrypcji tokeny, ewentualnie „ekwiwalent API".

## Stan obecny (z researchu)

- Aplikacja **nie zapisuje dziś żadnego zużycia**. `ChatEvent` nie ma zdarzenia `usage`, `Message` ma tylko `model` i `ms`.
- Dostawcy zwracają usage w strumieniu, parsery to ignorują:
  - Anthropic SSE: `message_start.message.usage` + `message_delta.usage` (`anthropic.ts`),
  - OpenAI-compat: końcowy chunk `usage`, wymaga `stream_options.include_usage` (`openai.ts`),
  - `claude -p`: linia `result` (`total_cost_usd`, `usage`, `modelUsage`) (`claude.ts`),
  - Codex: `turn.completed.usage`, bez modelu w strumieniu (`codex.ts`),
  - pi: `message_end.message.usage` (`pi.ts`).
- Panele terminalowe (Claude Code, Codex, pi) zapisują pełne usage na dysku:
  - `~/.claude/projects/<cwd>/<sessionId>.jsonl` (ok. 560 MB na tej maszynie),
  - `~/.codex/sessions/**/rollout-*.jsonl` (+ `archived_sessions`),
  - `~/.pi/agent/sessions/--<cwd>--/*.jsonl`,
  - konta: `<account.dir>/projects`, `$CODEX_HOME/sessions`.
- Precedens: `electron/src/context.ts` już czyta usage z logów sesji; `limits.ts` zapisuje dane pomocnicze w `configDir`.
- Brak tabeli cen, brak biblioteki wykresów, brak widoku statystyk.

## Architektura: dwa źródła + jeden model danych

### Wspólny rekord

```ts
type UsageRecord = {
  ts: number;            // ms
  source: "chat" | "bot" | "pane";
  provider: string;      // id providera / "claude-cli" / "codex-cli" / "pi"
  account?: string;      // id konta lub katalog logów
  model: string;         // znormalizowane id
  project?: string;      // Project.id lub ścieżka cwd (dla pane)
  ref?: string;          // chatId / botId / sessionId
  input: number;         // świeże wejście (bez cache)
  output: number;
  cacheRead: number;
  cacheWrite: number;
  reasoning: number;
  costUsd?: number;      // tylko gdy źródło je podaje lub API-key + cennik
};
```

Konwencja: `input` to zawsze tokeny **bez** cache. Codex raportuje `input_tokens` łącznie z cache, więc odejmujemy `cached_input_tokens`.

### Źródło A — żywy zapis (Chat i Bot)

1. Nowe zdarzenie `{type:"usage", input, output, cacheRead, cacheWrite, reasoning, costUsd?, model?}` w `ChatEvent` (`src/chat.ts`).
2. Emitowanie z parserów: `anthropicEvents`, `openaiEvents` (poprawić wczesny `return` przy `choices:[]`), `ClaudeParser` (`result`), `CodexParser` (`turn.completed`, model z `req.model`), `PiParser` (`message_end`).
3. `Message.usage?` ustawiane przy `done` (suma po krokach w `runBotTurn`, bo pętla ma do `MAX_STEPS` kroków). `parseChat` ma zachować nowe pole.
4. `ChatService.send` (`service.ts`) dopisuje rekord do **append-only ledgera** `<configDir>/usage.jsonl`. Ledger przeżywa usunięcie czatu.
5. `stream_options.include_usage`: wysyłać tylko dla providerów, które go akceptują (flaga w definicji providera, domyślnie włączona poza llama-server; sprawdzić, czy lokalne serwery nie zwracają błędu).

### Źródło B — parser logów dla paneli terminalowych

1. Nowy `electron/src/usage.ts` wzorowany na `context.ts`, z czystymi funkcjami parsującymi osobno dla Claude / Codex / pi (testowalne na fixture'ach).
2. Claude:
   - bierzemy linie `type:"assistant"`, **deduplikacja po `(message.id, requestId)`**, z wartością ostatnią/maksymalną, nie sumą (w próbce 34 759 linii → 15 411 unikalnych),
   - pomijamy model `<synthetic>`,
   - subagenci (`isSidechain`) liczą się do sum,
   - projekt z pola `cwd` w linii (kodowanie katalogu jest stratne).
3. Codex: model z ostatniego `turn_context`, usage z `token_count.last_token_usage` (sumować per wywołanie albo wziąć końcowe `total_token_usage`; wybrać jedno i przetestować), cwd z `session_meta`.
4. pi: `message.usage` per wiadomość asystenta, provider i model z wiadomości.
5. **Indeks przyrostowy** w `<configDir>/usage-index.json`: klucz `(plik, mtime, size)` + offset bajtowy; skanujemy tylko nowe bajty. Pełny skan 560 MB przy każdym otwarciu jest niedopuszczalny. Pierwsze skanowanie w tle z paskiem postępu.
6. Mapowanie na projekt aplikacji: `cwd` → `Project.path` z `workspace.json`; brak dopasowania → „Inne (cwd)". Konto: katalog źródłowy logów → `accounts.json`.

### Podwójne liczenie (ważne)

Chat i Bot uruchamiane przez `claude` / `codex` także zostawiają logi sesji (`--session-id`), więc trafiłyby do obu źródeł. Reguła: logi z `cwd` równego `chat-cwd` lub `bots/<id>/work` są **pomijane w źródle B** (liczy je źródło A). Test regresyjny na tę regułę.

### Normalizacja modeli i cennik

- `electron/src/usage-models.ts` (lub plik w `src/`, bo UI też potrzebuje): mapa aliasów → kanoniczne id (`haiku` → `claude-haiku-4-5-20251001` itd.) i etykiety.
- Cennik jako dane (USD / 1M tokenów: input, output, cacheRead, cacheWrite 5m/1h) **edytowalny**, ceny z oficjalnych cenników, nie z pamięci modelu. Ceny trzeba zweryfikować przed wpisaniem.
- Reguły kosztu:
  - źródło podało `total_cost_usd` / `costUSD` → używamy go,
  - provider z kluczem API + model w cenniku → szacunek, oznaczony „~",
  - subskrypcja (claude-cli, codex-cli) → tokeny; koszt jako „ekwiwalent API" tylko po włączeniu w ustawieniach,
  - lokalne modele → tokeny, koszt 0,
  - nieznany model → tokeny bez kosztu i znacznik „brak ceny".

## Agregacja

Czysty moduł `src/usageStats.ts` (+ testy): wejście `UsageRecord[]`, filtr (zakres dat, projekt, model, provider, konto, źródło), wyjście:

- suma i rozbicie na rodzaje tokenów,
- szereg czasowy (dzień / tydzień, strefa `Europe/Warsaw`),
- grupowanie po: model, projekt, provider/konto, źródło,
- top N + „pozostałe",
- „najczęściej używany model" (po tokenach i po liczbie wywołań).

Agregacja po stronie renderera na rekordach z IPC; jeśli rekordów będzie za dużo, przenieść do main i zwracać gotowe agregaty (decyzja po zmierzeniu).

## UI

- `StatsDialog.tsx` na wzór `AccountsDialog.tsx` / `Dialog.tsx` (modyfikator `is-wide`), przycisk w pasku obok Kont i Presetów w `App.tsx`. Pełna zakładka (czwarty `Mode`) dopiero, jeśli dialog okaże się za ciasny.
- Zawartość:
  1. selektor zakresu + filtry (projekt, model, konto),
  2. kafelki: łącznie tokeny, wejście / wyjście / cache, najczęstszy model, (koszt gdy dostępny),
  3. wykres słupkowy w czasie (ręcznie SVG, kolory z zmiennych motywu, zgodnie z zasadą „bez zależności"),
  4. tabele: modele, projekty, konta/providerzy, z paskami udziału,
  5. stan skanowania logów i data ostatniej aktualizacji.
- Opcjonalnie później: mały widget „dziś" w `Dock.tsx` obok Limitów.
- i18n: nowy obszar `stats` w `src/i18n/messages/` (PL źródłowy, EN wymuszony typami), rejestracja w `AREAS` i `Merged`.
- Dostępność: tabele pod wykresami jako alternatywa tekstowa, kontrast w obu motywach.

## IPC (4 punkty styku)

1. `electron/src/main.ts`: `handle("usage_stats", ...)`, `handle("usage_rescan", ...)`.
2. `electron/src/preload.ts`: sprawdzić mostek `call()`.
3. `src/backend.ts` + `src/backend-electron.ts`.
4. `src/backend-mock.ts` (dane przykładowe do dev w przeglądarce i testów).

## Etapy

1. **Fundament danych (Źródło A, bez UI).** Zdarzenie `usage`, parsery, `Message.usage`, ledger. Testy na istniejących fixture'ach (`anthropic-tools.sse`, `claude-text.jsonl`, `codex-search.jsonl`, `pi-search.jsonl`) + nowy fixture OpenAI z `usage`.
2. **Parser logów (Źródło B).** `usage.ts`, dedupe, indeks przyrostowy, reguła anty-duplikatu, testy na zanonimizowanych próbkach z tej maszyny.
3. **Agregacja + cennik + normalizacja modeli.** Czyste funkcje i testy.
4. **IPC + `StatsDialog`** z podziałami: czas, model, projekt, konto.
5. **Szlify:** widget w Docku, eksport CSV, ustawienie „pokaż ekwiwalent API", retencja ledgera.

Każdy etap kończy się osobnym commitem i zielonym `pnpm test`.

## Ryzyka

- **Wydajność:** 560 MB logów. Zmniejszamy indeksem przyrostowym i skanem w tle.
- **Dedupe Claude:** złe liczenie zawyża sumy ok. 2,3×. Testy na prawdziwej próbce obowiązkowe.
- **Format logów to nie kontrakt:** Claude Code / Codex mogą go zmienić. Parsery tolerancyjne, nieznane pola ignorowane, licznik pominiętych linii w UI.
- **Rozjazd modeli:** aliasy vs pełne id, nowe modele bez ceny. Stąd edytowalny cennik i stan „brak ceny".
- **`include_usage` u lokalnych serwerów:** może być odrzucane. Flaga per provider.
- **Prywatność:** ledger i indeks zawierają ścieżki projektów i identyfikatory czatów, ale nie treści. Zostają lokalnie w `configDir`.
- **Rotacja / usuwanie logów** przez narzędzia (Claude czyści stare sesje): indeks trzyma zagregowane sumy dzienne, więc dane nie znikają po usunięciu pliku.

## Do rozstrzygnięcia z użytkownikiem

1. Dialog czy osobna zakładka (czwarty tryb)?
2. Czy pokazywać koszt „ekwiwalent API" dla subskrypcji, czy tylko tokeny?
3. Czy liczyć zużycie wstecz z logów (historia z 560 MB), czy zacząć od dnia wdrożenia? Rekomendacja: wstecz, Źródło B to umożliwia.
4. Czy STT/TTS ma być w statystykach (minuty / znaki, nie tokeny)? Rekomendacja: poza zakresem v1.
5. Czy podsumowania z `summary.ts` (`claude -p --model haiku`) mają być liczone? Wymaga zmiany na `--output-format json`; ruch niewielki, rekomendacja: później.
