# Plan M3 – zakładka „Czat”

Dopisane 2026-10-01 z rozmowy z użytkownikiem. Zastępuje szkic M3 z `PLAN.md`
(„Chat = UI Pi Code przez sidecar”), który powstał jeszcze dla wersji Tauri.

Co ma działać po M3:
1. W pasku tytułu przełącznik **Code | Czat**. „Code” to dzisiejsza siatka terminali,
   „Czat” to zwykła rozmowa jak w claude.ai: lista rozmów po lewej, wątek, pole wpisywania.
2. Przy polu wpisywania **wybór modelu**, pogrupowany według dostawcy:
   - **Claude (subskrypcja)** – przez program `claude`,
   - **ChatGPT (subskrypcja)** – przez program `codex`,
   - **API** – klucz API (Anthropic, OpenAI, OpenRouter, dowolne API zgodne z OpenAI),
   - **Lokalne** – `llama-server`, FreeToken i inne serwery zgodne z OpenAI na localhost.
3. Model można zmienić w środku rozmowy; każda odpowiedź pokazuje, który model ją napisał.
4. Rozmowy zostają po restarcie aplikacji.
5. **Wygląd i odczucie jak czat Claude** (claude.ai): spokojny, ładny, szybki.
6. **Szybki research:** przełącznik „Szukaj w sieci” przy polu wpisywania; odpowiedź
   z przypisami i listą źródeł, w trakcie widać „Szukam: …”.

## Wygląd (wzór: czat claude.ai)

- Pusty czat: powitanie na środku („Dzień dobry, w czym pomóc?”) i duże pole wpisywania
  pod nim; po pierwszej wiadomości pole zjeżdża na dół.
- Wątek w jednej kolumnie na środku (~720–760 px), dużo powietrza. Pytania użytkownika
  w miękkim dymku po prawej, odpowiedzi bez dymka, pełną szerokością kolumny, czytelny
  font tekstowy (w motywie D np. szeryfowy do odpowiedzi, bezszeryfowy do UI).
- Pole wpisywania jako karta z zaokrągleniem: rośnie z tekstem, pod spodem w jednym
  rzędzie: model (menu), „Szukaj w sieci” (przełącznik z ikoną globu), załącznik,
  Wyślij/Stop.
- Lewa kolumna rozmów zwijana, grupy „Dziś / Wczoraj / Ostatnie 7 dni / Starsze”.
- Odpowiedź pojawia się płynnie (strumień), bloki kodu z nagłówkiem języka i „Kopiuj”,
  tabele, listy, cytaty. Akcje pod odpowiedzią widoczne po najechaniu.
- Research: nad odpowiedzią zwijany pasek „Przeszukano N stron” z zapytaniami;
  w tekście przypisy `[1]`, na dole karty źródeł (favicon, tytuł, domena).
- Kolory i fonty z tokenów aktywnego motywu, więc czat pasuje do reszty aplikacji;
  w motywie D domyślnie ciepły, stonowany wygląd zbliżony do claude.ai.
- Szybkość: start zakładki bez opóźnień (lista rozmów z indeksu, nie z plików),
  pierwszy token widoczny od razu, markdown najwyżej raz na klatkę, shiki leniwie.

## Decyzje

- **Własny czat, kawałki z Pi Code.** UI Pi Code (~12,6 tys. linii) jest skrojone pod pi
  (narzędzia, zatwierdzenia, sloty, dyktowanie). Bierzemy z niego pojedyncze pliki:
  `src/lib/code-block.tsx` (bloki kodu, przycisk kopiuj), renderowanie markdownu
  z `Transcript.tsx`, `format.ts`, `images.ts`, `FindBar.tsx`, `Lightbox.tsx`, wygląd
  `Providers.tsx`. Kopie trafiają do `src/chat/` z nagłówkiem „z Pi Code `<commit>`”
  i są przerabiane pod tutejsze tokeny motywów. Licencja Pi Code to GPL-3.0 – do użytku
  własnego bez znaczenia, przy publikacji repo musi być zgodne z GPL.
- **Bez sidecara.** Backend Electrona to już Node: adaptery działają w procesie głównym,
  strona dostaje strumień przez IPC (`chat_send` → zdarzenia `chat_delta` / `chat_done` /
  `chat_error`, `chat_abort`) – jak `pty_data` dziś.
- **Subskrypcje tylko przez oficjalne programy.** Claude z subskrypcji = `claude -p`,
  ChatGPT z subskrypcji = `codex exec`. Nie wyciągamy tokenów logowania do własnego
  klienta HTTP (regulaminy obu firm). Program pracuje w katalogu tymczasowym, bez narzędzi.
- **Trzy rodzaje adapterów** za jednym interfejsem `ChatProvider`:
  `cli-claude`, `cli-codex`, `openai-compat` (HTTP SSE: lokalne, OpenAI, OpenRouter)
  i `anthropic` (HTTP, Messages API). Bez SDK – sam `fetch`.
- **Historia jest nasza.** Rozmowa trzymana w `~/.config/dev.majke.agents/chats/<id>.json`
  (wiadomości, model każdej odpowiedzi, tytuł, data). Dostawcy HTTP dostają za każdym
  razem całą historię. CLI mają własne sesje (`--resume`): id sesji zapisany przy
  rozmowie i przy modelu; gdy model zmienia się na CLI w środku rozmowy, dotychczasowa
  historia idzie jako kontekst w pierwszej wiadomości nowej sesji (jak `handoffText` z M4).
- **Rozmowy globalne**, nie przypisane do projektu (jak claude.ai). Projekt można dodać
  później jako filtr.
- **Konfiguracja:** `~/.config/dev.majke.agents/chat.json` – dostawcy, adresy, modele.
  Klucze API osobno, szyfrowane `safeStorage` Electrona (KWallet/libsecret), nigdy
  w `chat.json` ani w `workspace.json`. Przy pierwszym starcie import dostawców
  z `~/.pi/agent/models.json` i wykrycie modeli z `/v1/models` (tylko odczyt `~/.pi`).
- Siatka terminali zostaje zamontowana pod zakładką Czat (schowana), agenci pracują dalej.
- **Research przez narzędzia, które już są**, bez nowego klucza do wyszukiwarki:
  - Claude (subskrypcja): `claude -p --tools "WebSearch,WebFetch"` – tylko te dwa narzędzia,
  - ChatGPT (subskrypcja): `codex exec --search` (natywne `web_search`),
  - modele lokalne i API: przez `pi --mode rpc` z rozszerzeniem `pi-web-access`
    (już zainstalowane, DuckDuckGo + Exa wg `~/.pi/agent/web-search.json`),
    z innymi narzędziami wyłączonymi. Bez researchu – zwykły `openai-compat`/`anthropic`.
  - Wspólny format zdarzeń: `chat_search` (zapytanie), `chat_source` (url, tytuł),
    potem tekst z przypisami.

## Kto robi

Jak w M2: etapy **L** – lokalny model, **C** – Claude. Zasady z `AGENTS.md` bez zmian.
Nowe zależności dozwolone tylko w etapie, który je wymienia.

## Postęp

- [x] Etap 1 (L) – model czatu bez UI
- [x] Etap 2 (L) – adapter `openai-compat` i zapis rozmów
- [x] Etap 3 (C) – przełącznik Code | Czat i szkielet zakładki
- [x] Etap 4 (C) – wątek: markdown, kod, strumień, Stop
- [x] Etap 5 (L) – adapter Claude (subskrypcja)
- [x] Etap 6 (L) – adapter ChatGPT (subskrypcja)
- [x] Etap 7 (C) – API: klucze, adapter `anthropic`, okno „Dostawcy”
- [x] Etap 7b (C) – research: „Szukaj w sieci”, źródła, przypisy
- [ ] Etap 8 (C + użytkownik) – sprawdzenie w oknie

---

## Etap 1 (L) – model czatu bez UI

Nowy `src/chat.ts` (czyste funkcje, testy w `src/chat.test.ts`):

```ts
type ProviderKind = "cli-claude" | "cli-codex" | "openai-compat" | "anthropic";
type ProviderDef = { id: string; name: string; kind: ProviderKind; group: "sub" | "api" | "local";
                     baseUrl?: string; command?: string; models: ChatModel[]; keyRef?: string };
type ChatModel = { id: string; name: string };
type Message = { id: string; role: "user" | "assistant"; text: string; at: number;
                 model?: { provider: string; id: string }; error?: string; images?: string[] };
type Chat = { version: 1; id: string; title: string; created: number; updated: number;
              messages: Message[]; model: { provider: string; id: string };
              cliSessions: Record<string, string> }; // "provider/model" -> id sesji CLI
```

- `parseChatConfig(raw)` – jak `parseAgents`: złe wpisy pominięte i opisane w `errors`,
  pusty wynik = domyślni dostawcy (Claude subskrypcja, ChatGPT subskrypcja, lokalny
  `http://127.0.0.1:8080/v1`).
- `importPiProviders(modelsJson)` – dostawcy z `~/.pi/agent/models.json` → `openai-compat`.
- `parseChat` / `serializeChat`, `chatTitle(firstPrompt)` (≤ 60 znaków, granica słowa),
  `sortChats` (najnowsze pierwsze).
- `historyFor(chat, kind)` – wiadomości w formacie dostawcy (OpenAI `messages`,
  Anthropic `messages` + `system`); odpowiedzi z błędem pomijane.
- `cliPrompt(chat, key, text)` – gdy dla `key` nie ma sesji CLI, a rozmowa ma historię:
  tekst z kontekstem („Wcześniejsza rozmowa: …”, ≤ 8000 znaków, ucinamy od najstarszych),
  inaczej sam `text`.

**Commit:** `M3 Etap 1: model czatu`

## Etap 2 (L) – adapter `openai-compat` i zapis rozmów

- `electron/src/chat/openai.ts`: `POST {baseUrl}/chat/completions`, `stream: true`,
  parser SSE (`data: …`, `[DONE]`, kawałki przecięte w środku linii i w środku znaku UTF-8),
  `AbortController` na Stop, błędy po polsku („serwer nie odpowiada”, „401 – zły klucz”,
  treść błędu z JSON-a). `listModels(baseUrl)` przez `GET /models`.
- `electron/src/chat/store.ts`: `chats/` w `configDir()`, zapis atomowy (`writeAtomic`),
  lista (id, tytuł, data) bez czytania całych plików przy każdym starcie, usuwanie.
- IPC w `main.ts`: `chat_config`, `chat_list`, `chat_load`, `chat_save`, `chat_delete`,
  `chat_send(reqId, provider, model, payload)` → `chat_delta` / `chat_done` / `chat_error`,
  `chat_abort(reqId)`, `chat_models(provider)`. W `preload.ts` ujścia jak przy `pty_data`.
- `src/backend.ts` + `backend-electron.ts` + `backend-mock.ts` (mock: odpowiedź
  wypisywana po słowie, ~30 słów/s, żeby podgląd pokazywał strumień).
- Testy: parser SSE na fixture'ach, atrapa serwera `node:http` (strumień, błąd 500,
  zerwanie połączenia, abort).

**Commit:** `M3 Etap 2: adapter OpenAI i zapis rozmów`

## Etap 3 (C) – przełącznik Code | Czat i szkielet zakładki

- `ui.mode: "code" | "chat"` w `src/ui.ts` (domyślnie `code`, stare `workspace.json`
  bez zmian). Przełącznik w `TitleBar` i skrót (np. Ctrl+1 / Ctrl+2, sprawdzić kolizje
  w `keys.ts`).
- Zakładka Czat: lewa kolumna z listą rozmów (Nowa, zmiana nazwy, usuń z `confirm`),
  środek – wątek, dół – pole wpisywania (Enter wysyła, Shift+Enter nowa linia) z menu
  modelu pogrupowanym: Subskrypcje / API / Lokalne. Wybrany model zapamiętany w rozmowie
  i jako domyślny dla nowej.
- Siatka nie jest odmontowywana (`display: none` / `hidden`), terminale nie robią `fit()`
  w schowanej zakładce; po powrocie jeden `fit()`.
- Wygląd z tokenów motywów (`themes.css`), działa we wszystkich 22 motywach.
- Podgląd: zrzuty w mocku – pusta lista, rozmowa, menu modeli, 3 motywy (D, Cisza, Metro).

**Commit:** `M3 Etap 3: zakładka Czat`

## Etap 4 (C) – wątek: markdown, kod, strumień, Stop

- Nowe zależności: `react-markdown`, `remark-gfm`, `remark-breaks`, `shiki` (wersje jak
  w Pi Code). Kopie z Pi Code do `src/chat/`: `code-block.tsx`, część `Transcript.tsx`
  (markdown, kopiuj odpowiedź), `format.ts`.
- Strumień: tekst dopisywany na żywo, kursor pisania, przycisk Stop zamiast Wyślij.
  Przerwana odpowiedź zostaje z dopiskiem „(przerwano)”.
- Pod odpowiedzią: nazwa modelu, czas, „Ponów” (ten sam albo inny model), „Kopiuj”.
  Edycja ostatniego pytania = obcięcie rozmowy od tego miejsca i wysłanie od nowa.
- Shiki ładowany leniwie (dopiero przy pierwszym bloku kodu), żeby nie spowalniać startu.
- Wydajność: długi strumień nie renderuje markdownu przy każdym tokenie (najwyżej
  co klatkę, `requestAnimationFrame`).

**Commit:** `M3 Etap 4: wątek czatu`

## Etap 5 (L) – adapter Claude (subskrypcja)

- `electron/src/chat/claude.ts`: `claude -p --output-format stream-json --verbose
  --include-partial-messages --tools "" --strict-mcp-config --disable-slash-commands
  --setting-sources "" --model <id>` + `--session-id <uuid>` (nowa) albo `--resume <uuid>`.
  `cwd` = katalog tymczasowy (bez CLAUDE.md projektu), `env` = `childEnv()`. Prompt na stdin.
- Parser linii stream-json → `chat_delta` (tekst), `chat_done` (koszt/tokeny, jeśli są).
  Stop = `SIGTERM` procesu.
- Modele: `CLAUDE_MODELS` z `agents.ts` + Haiku.
- Testy: parser na nagranych liniach (fixture, nie prawdziwe wywołanie), budowa argumentów.
  Na koniec jedno prawdziwe wywołanie ręcznie (Haiku, krótki prompt) – wynik do HANDOFF.

**Commit:** `M3 Etap 5: Claude z subskrypcji`

## Etap 6 (L) – adapter ChatGPT (subskrypcja)

- Najpierw sprawdzić w `codex exec --help` (wersja 0.153): wyjście JSON (`--json`),
  wznawianie (`codex exec resume <id>`), wybór modelu (`-m`), tryb bez zapisu na dysk
  (`-s read-only`, `--skip-git-repo-check`). Jeśli `exec` nie daje strumienia tekstu,
  rozważyć `codex app-server` – wtedy zatrzymać się i opisać w HANDOFF.
- `electron/src/chat/codex.ts`: jak etap 5 – katalog tymczasowy, parser zdarzeń JSON,
  id wątku codex zapisany w `cliSessions`.
- Modele: lista z `~/.codex/config.toml` / dokumentacji codex, wpisana w domyślną
  konfigurację, edytowalna w `chat.json`.
- Testy jak w etapie 5.

**Commit:** `M3 Etap 6: ChatGPT z subskrypcji`

## Etap 7 (C) – API: klucze, adapter `anthropic`, okno „Dostawcy”

- `electron/src/chat/keys.ts`: klucze w `chat-keys.bin` przez `safeStorage`
  (gdy niedostępne – komunikat, bez zapisu jawnym tekstem). Strona nigdy nie dostaje
  klucza z powrotem, tylko „ustawiony / brak”.
- `electron/src/chat/anthropic.ts`: Messages API ze streamingiem (`x-api-key`,
  `anthropic-version`), te same zdarzenia co `openai.ts`.
- Okno „Dostawcy” (na wzór `Providers.tsx` z Pi Code): lista dostawców z grupą, stan
  (zalogowany `claude` / `codex`, klucz ustawiony, serwer lokalny odpowiada), dodanie
  dostawcy `openai-compat` (adres + opcjonalny klucz), „Wykryj modele”, „Testuj”
  (krótkie zapytanie), usuwanie.
- Gotowe szablony: OpenAI, OpenRouter, Anthropic, lokalny llama-server.

**Commit:** `M3 Etap 7: dostawcy API`

## Etap 7b (C) – research: „Szukaj w sieci”, źródła, przypisy

- `Message` dostaje `sources?: { url: string; title: string }[]` i `searches?: string[]`.
- Claude: przy włączonym przełączniku `--tools "WebSearch,WebFetch"`; z linii stream-json
  wyciągane wywołania narzędzi (zapytanie) i wyniki (url, tytuł).
- Codex: `--search`; zdarzenia `web_search` z `--json` → te same pola.
- Lokalne i API: `electron/src/chat/pi.ts` – `pi --mode rpc --no-session --no-skills
  --no-prompt-templates` z włączonym tylko rozszerzeniem `pi-web-access` i jego narzędziami,
  `--provider`/`--model` z wyboru użytkownika (dostawcy pi muszą znać ten model – dla
  dostawców spoza `~/.pi/agent/models.json` przełącznik nieaktywny z podpowiedzią).
  Historia rozmowy podana jako kontekst (jak `cliPrompt`).
- Polecenie systemowe: krótko, z przypisami `[n]` do źródeł, po polsku, gdy pytanie po polsku.
- UI wg sekcji „Wygląd”: pasek „Szukam: …” / „Przeszukano N stron”, przypisy jako linki
  (otwierane w przeglądarce systemowej, `shell.openExternal`, tylko `http(s)`), karty źródeł.
- Testy: parsery zdarzeń wyszukiwania na fixture'ach (claude, codex, pi), mapowanie
  przypisów na źródła.

**Commit:** `M3 Etap 7b: research`

## Etap 8 (C + użytkownik) – sprawdzenie w oknie

Lista do odhaczenia w HANDOFF:
- [ ] rozmowa z lokalnym modelem (llama-server :8080, FreeToken :1919), Stop w trakcie
- [ ] Claude z subskrypcji: nowa rozmowa, kontynuacja po restarcie aplikacji
- [ ] ChatGPT z subskrypcji: to samo
- [ ] API (OpenRouter albo Anthropic): klucz zapisany, po restarcie działa, nie ma go w plikach JSON
- [ ] zmiana modelu w środku rozmowy (lokalny → Claude → lokalny) – kontekst przechodzi
- [ ] przełączanie Code | Czat nie przerywa agentów w siatce, terminale po powrocie mają dobry rozmiar
- [ ] długa odpowiedź z kodem – płynne przewijanie, CPU w normie
- [ ] czytelność w jasnych motywach
- [ ] „Szukaj w sieci” z Claude, ChatGPT i modelem lokalnym: źródła i przypisy klikalne
- [ ] wygląd obok claude.ai: powitanie, kolumna, dymki, pole wpisywania – zrzut do porównania

**Commit:** `M3 Etap 8: poprawki po sprawdzeniu w oknie`

## Później (poza M3)

- Obrazki ze schowka i pliki w wiadomości.
- Automatyczny tytuł rozmowy lokalnym modelem.
- „Wyślij do panelu”: rozmowa z czatu jako kontekst dla agenta w siatce (wklejenie jak w M4).
- Szukanie w rozmowach (`FindBar` z Pi Code), przypinanie, foldery.
