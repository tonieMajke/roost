# Plan M5 – zakładka „Bot”

Dopisane 2026-10-01 z rozmowy z użytkownikiem. Rozwija tryb „Agent” z BridgeMind
opisany w `PLAN.md` („nazwani współpracownicy z briefem, pamięcią, skillami,
na harmonogramie”). Wzory: Hermes Agent (Nous Research): pamięć, skille pisane przez
samego agenta, harmonogram; Grok: postać z charakterem.

Co ma działać po M5:
1. Trzecia zakładka **Code | Czat | Bot**. W lewej kolumnie lista botów użytkownika.
2. **Boty tworzy użytkownik**: ręcznie (formularz) albo **z opisu**, czyli rozmową
   z wbudowanym Kreatorem („zrób mi bota, który co rano przegląda newsy o Rust
   i mówi jak pirat”). Każdy bot jest do czego innego.
3. Bot ma **osobowość**: imię, awatar, kolor, opis charakteru i styl wypowiedzi.
4. Bot ma **pamięć**, która przetrwa rozmowy: sam zapisuje fakty o użytkowniku
   i o swojej pracy. Użytkownik może ją przejrzeć i poprawić.
5. Bot ma **skille**. Po udanym, nietrywialnym zadaniu sam zapisuje przepis jako skill,
   a następnym razem z niego korzysta.
6. Bot ma **harmonogram**: zadania cykliczne, które działają, gdy aplikacja jest
   otwarta. Wynik trafia do historii bota i do powiadomienia.
7. Bot ma **narzędzia**: sieć, pliki i powłokę. Odczyt działa od razu, a zapis i polecenia
   dopiero po „Zezwól”.

Poza M5 (lista na później): bramka Telegram/Discord, głos, awatar generowany obrazem,
bot otwierający panele w zakładce Code, boty rozmawiające ze sobą, harmonogram przy
zamkniętej aplikacji (usługa systemd).

## Decyzje

- **Silnik własny, na dostawcach z Czatu.** Bez instalowania Hermesa. Bot wybiera model
  z tej samej listy co Czat (`chat.json`): Claude i ChatGPT z subskrypcji, modele lokalne
  i API.
- **Narzędzia bota = jeden rejestr w procesie głównym** (`electron/src/bot/tools.ts`).
  Model dostaje je dwiema drogami, a implementacja i potwierdzanie są w jednym miejscu:
  - **Dostawcy HTTP** (`openai`, `anthropic`): własna pętla tool-calling
    (function calling, najwyżej 25 kroków na wiadomość).
  - **CLI** (`claude -p`, `codex exec`): rejestr wystawiony jako serwer MCP `bot`
    (`electron/src/bot/mcp-server.ts`, stdio JSON-RPC pisany ręcznie, bez SDK).
    Serwer uruchamiamy jako `process.execPath` z `ELECTRON_RUN_AS_NODE=1`. Wywołania
    przekazuje do procesu głównego przez gniazdo unix w `$XDG_RUNTIME_DIR`.
    Claude: `--mcp-config <plik> --strict-mcp-config --tools "WebSearch,WebFetch"
    --allowedTools "mcp__bot__*,WebSearch,WebFetch"`, więc wbudowane Bash/Edit są wyłączone.
    Codex: `-c mcp_servers.bot.command=…` i `-s read-only`.
- **Potwierdzenie żyje w narzędziu, nie w CLI.** Narzędzie z zapisem czeka na decyzję
  z UI (`bot_approval` → „Zezwól raz” / „Zezwalaj w tej rozmowie” / „Odrzuć”).
  Dzięki temu działa tak samo przy każdym dostawcy. Limit czasu MCP podnosimy
  (`MCP_TOOL_TIMEOUT` dla claude, `tool_timeout_sec` dla codex). Odmowa wraca do modelu
  jako wynik narzędzia: „użytkownik odmówił”.
- **Dostęp do plików:** każdy bot ma własny katalog roboczy (`work/`) i listę folderów
  od użytkownika. Czytanie wewnątrz nich nie wymaga pytania. Czytanie poza nimi,
  każdy zapis poza `work/` i każde `bash` wymagają potwierdzenia. `bash` ma limit 120 s
  i 64 KB wyjścia. Ścieżki sprawdzamy po `realpath`, więc dowiązania nie wyprowadzą poza folder.
- **Harmonogram nie ma kogo zapytać.** Zadanie z harmonogramu dostaje tylko narzędzia
  bez potwierdzenia, plus to, co użytkownik zaznaczył przy zadaniu („może pisać
  w `work/`”, „może uruchamiać: `git pull`, `cargo test`”: lista prefiksów). Inna prośba
  o zgodę = zadanie staje na „czeka na zgodę” i wysyła powiadomienie. Nie odpowiadamy
  za użytkownika automatycznie.
- **Pamięć jak w Hermesie:** dwa pliki z limitem znaków. `memory.md` (≤ 2200 znaków,
  notatki bota) i `user.md` (≤ 1400 znaków, kim jest użytkownik). Do promptu systemowego
  trafiają jako migawka z chwili startu rozmowy, więc zmiany w trakcie rozmowy widać
  dopiero w następnej (prefiks się nie zmienia, cache działa). Przy przekroczeniu limitu
  narzędzie zwraca błąd z treścią pamięci, a bot sam ją skraca.
  Dodatkowo `history_search`: szukanie tekstu w dawnych rozmowach tego bota.
- **Skille w formacie Agent Skills** (`skills/<nazwa>/SKILL.md`, frontmatter `name`,
  `description`), zgodnym z claude i pi. W prompcie są tylko nazwy i opisy, a treść
  model czyta narzędziem `skill_view` (stopniowe odsłanianie). Bot tworzy i poprawia
  skille narzędziami `skill_create` / `skill_patch`. Prompt zachęca go do tego po
  zadaniu, które wymagało ≥ 5 wywołań narzędzi albo poprawki od użytkownika.
- **Osobowość = część promptu systemowego** z pól bota (imię, charakter, styl, czego
  unika) plus suwak „powaga ↔ luz” (3 poziomy). Awatar: emoji albo obrazek z dysku,
  kopiowany do folderu bota.
- **Kreator to zwykły bot wbudowany**, z dodatkowymi narzędziami `bot_create` /
  `bot_update` (każde z potwierdzeniem i podglądem karty bota). Nie da się go usunąć,
  da się go edytować.
- **Wszystko w plikach**, bez bazy:
  ```
  ~/.config/dev.majke.agents/bots/<id>/
    bot.json        imię, awatar, charakter, model, foldery, narzędzia
    memory.md       user.md
    skills/<nazwa>/SKILL.md
    routines.json   zadania z harmonogramu
    chats/<id>.json rozmowy (format Chat z M3 + wywołania narzędzi)
    runs/<id>.json  przebiegi z harmonogramu
    work/           katalog roboczy
  ```
- **Wspólny format zdarzeń** rozszerza `ChatEvent` o `tool_call` (id, nazwa, argumenty),
  `tool_result` (id, skrót wyniku, błąd), `approval` (id, opis, szczegóły do pokazania).
- Zakładka Bot korzysta z wątku i pola tekstowego Czatu (`Thread`, `Composer`, `Markdown`),
  nie kopiuje ich. Dochodzą karty narzędzi i karta zgody.

## Ryzyka do sprawdzenia na początku etapów

- Modele lokalne: tool calling w llama-server wymaga `--jinja`. Gdy serwer go nie wspiera,
  bot działa bez narzędzi i mówi to w nagłówku rozmowy.
- `codex exec` w `-s read-only` nadal ma własną powłokę do odczytu. Akceptujemy to
  (odczyt), ale sprawdzamy, czy MCP z `-c` w ogóle się ładuje.
- Wyszukiwanie dla dostawców HTTP: narzędzie `web_search` woła jednorazowo
  `pi -p` z pi-web-access (jak etap 7b M3) i zwraca listę wyników. `web_fetch` jest własne
  (fetch + HTML→tekst, ≤ 30 KB).

## Kto robi

Jak w M3: etapy **L** – lokalny model, **C** – Claude. Zasady z `AGENTS.md` bez zmian.
Nowe zależności dozwolone tylko w etapie, który je wymienia.

## Postęp

- [x] Etap 1 (L) – model bota bez UI
- [ ] Etap 2 (L) – magazyn botów, pamięć i skille na dysku
- [ ] Etap 3 (C) – rejestr narzędzi i potwierdzenia
- [ ] Etap 4 (C) – pętla tool-calling dla dostawców HTTP
- [ ] Etap 5 (C) – serwer MCP `bot` dla claude i codex
- [ ] Etap 6 (C) – zakładka Bot: lista, rozmowa, karty narzędzi i zgody
- [ ] Etap 7 (C) – karta bota: osobowość, pamięć, skille, ustawienia
- [ ] Etap 8 (C) – Kreator: bot z opisu
- [ ] Etap 9 (L) – harmonogram w procesie głównym
- [ ] Etap 10 (C) – harmonogram w UI, przebiegi, powiadomienia
- [ ] Etap 11 (C + użytkownik) – sprawdzenie w oknie

---

## Etap 1 (L) – model bota bez UI

Nowy `src/bot.ts` (czyste funkcje, testy w `src/bot.test.ts`):

```ts
type BotDef = { version: 1; id: string; name: string; avatar: { emoji?: string; image?: string };
                color: string; persona: string; style: string; avoid: string;
                tone: "serious" | "balanced" | "playful"; model: ModelRef;
                folders: string[]; tools: Record<ToolGroup, boolean>; builtin?: "creator" };
// ToolGroup: web, read, write, bash, memory, skills (przełączniki w ustawieniach bota)
type Routine = { id: string; name: string; prompt: string; schedule: Schedule;
                 allow: { writeWork: boolean; bash: string[] }; enabled: boolean;
                 lastRun?: number };
type Schedule = { kind: "every"; minutes: number }        // ≥ 5
              | { kind: "daily"; at: string; days?: number[] }   // "08:00", 0=nd
type BotChat = Chat & { calls: ToolCallRecord[] };
```

- `parseBot` / `serializeBot` (złe pola = wartości domyślne + `errors`, jak `parseUi`).
- `botSystemPrompt(bot, memory, user, skills, now)`: stała kolejność sekcji (osobowość,
  zasady narzędzi, pamięć, profil użytkownika, lista skilli, data). Ten sam wejściowy
  stan daje ten sam tekst co do bajtu (test).
- `nextRun(schedule, after)`: kolejne uruchomienie. Testy: przejście przez północ,
  dni tygodnia, zmiana czasu (Europe/Warsaw, marzec i październik).
- `parseSkill(md)`: frontmatter `name`, `description`, nazwa `[a-z0-9-]{1,64}`.
- `memoryEdit(text, op, limit)`: `add` / `replace(old,new)` / `remove(old)`. Przy
  przekroczeniu limitu zwraca błąd z aktualną treścią i liczbą znaków.
- `needsApproval(tool, args, bot, ctx)`: reguły z „Decyzji” (folder, `work/`, bash,
  harmonogram z `allow`). To czysta funkcja z kompletem testów, w tym przypadkiem `../`
  i dowiązaniem (ścieżki przychodzą już po `realpath`).

**Commit:** `M5 Etap 1: model bota`

## Etap 2 (L) – magazyn botów, pamięć i skille na dysku

- `electron/src/bot/store.ts`: układ katalogów z „Decyzji”, zapis atomowy (`writeAtomic`),
  lista botów (id, imię, awatar, kolor), tworzenie (z `work/`), usuwanie do
  `bots-trash/<id>-<data>` (nie `rm -rf`). Kreator powstaje przy pierwszym starcie.
- Rozmowy bota: ten sam `ChatStore` z M3 z innym katalogiem.
- IPC: `bot_list`, `bot_load`, `bot_save`, `bot_create`, `bot_delete`, `bot_memory`,
  `bot_memory_save`, `bot_skills`, `bot_skill`, `bot_skill_delete`, `bot_chat_*`
  (jak `chat_*`). `preload.ts`, `src/backend.ts`, `backend-electron.ts`, `backend-mock.ts`
  (mock: dwa boty i Kreator z przykładową pamięcią i skillem).

**Commit:** `M5 Etap 2: boty na dysku`

## Etap 3 (C) – rejestr narzędzi i potwierdzenia

- `electron/src/bot/tools.ts`: definicje (nazwa, opis, schemat JSON argumentów) i
  implementacje: `read_file`, `list_dir`, `grep` (rg), `write_file`, `edit_file`
  (stary→nowy, unikalne dopasowanie), `bash`, `web_fetch`, `web_search`,
  `memory` (add/replace/remove, cel `memory` | `user`), `skill_view`, `skill_create`,
  `skill_patch`, `history_search`. Kreator dodatkowo: `bot_create`, `bot_update`.
- `ApprovalBroker`: `request(botId, chatId, opis) → Promise<"once" | "chat" | "deny">`,
  zdarzenie `bot_approval` do strony, `bot_approve(id, decyzja)` z IPC. Zgody „w tej
  rozmowie” pamiętane per (rozmowa, narzędzie, prefiks polecenia). Stop rozmowy =
  wszystkie czekające prośby kończą się `deny`.
- `bash`: `/bin/sh -c` w `work/` albo w podanym folderze bota, grupa procesów zabijana
  po czasie i przy Stop (jak sprzątanie w `pty.ts`), środowisko bez kluczy aplikacji.
- Testy: każde narzędzie na katalogu tymczasowym, odmowa, przekroczenie czasu, ucięcie
  wyjścia, ścieżka poza folderem przez dowiązanie.

**Commit:** `M5 Etap 3: narzędzia bota i zgody`

## Etap 4 (C) – pętla tool-calling dla dostawców HTTP

- `electron/src/bot/loop.ts`: `runBotTurn(req, tools, broker, signal, emit)`.
  OpenAI: `tools` + `tool_calls` w strumieniu (składanie argumentów z kawałków),
  Anthropic: `tool_use` / `tool_result`. Dwie istniejące funkcje body/events z M3
  dostają parametr narzędzi zamiast kopii.
- Najwyżej 25 kroków, potem odpowiedź „przerwałem po 25 krokach” i zapis rozmowy.
- Wywołania zapisane w rozmowie (`calls`), żeby po wznowieniu historia zawierała
  wyniki narzędzi (skrócone do 4 KB w historii).
- Wykrycie braku obsługi narzędzi (400 / brak `tool_calls` w odpowiedzi na prośbę o
  narzędzie): rozmowa idzie dalej bez narzędzi, z flagą `toolsUnsupported`.
- Testy na zarejestrowanych strumieniach (`fixtures/`), jak `openai.test.ts`.

**Commit:** `M5 Etap 4: pętla narzędzi`

## Etap 5 (C) – serwer MCP `bot` dla claude i codex

- `mcp-server.ts`: `initialize`, `tools/list`, `tools/call` po stdio. Każde wywołanie idzie
  przez gniazdo unix (token w zmiennej środowiskowej, gniazdo z prawami 0600) do rejestru
  w procesie głównym z kontekstem (bot, rozmowa).
- Budowanie: osobny plik wyjściowy w `electron/dist/`, w AppImage obok `main.js`
  (sprawdzić `asarUnpack`, jak pomocnik linii statusu).
- `claude.ts` i `codex.ts` dostają tryb bota (argumenty z „Decyzji”, plik `--mcp-config`
  w katalogu tymczasowym, `--system-prompt` z `botSystemPrompt`). Parser zamienia
  `tool_use` / `tool_result` z `mcp__bot__*` na zdarzenia `tool_call` / `tool_result`.
- Sprawdzić na żywo: claude czeka na zgodę dłużej niż 60 s bez zerwania; codex ładuje
  serwer z `-c`; Stop zabija CLI i serwer MCP.

**Commit:** `M5 Etap 5: narzędzia bota w claude i codex`

## Etap 6 (C) – zakładka Bot: lista, rozmowa, karty narzędzi i zgody

- `ModeTabs`: trzecia karta **Bot** (ikona `Bot` z lucide). `ui.mode` przyjmuje `"bot"`.
  Ctrl+Alt+C przechodzi po kolei Code → Czat → Bot. Siatka i Czat zostają zamontowane.
- Lewa kolumna: boty (awatar, imię, kropka: pracuje / czeka na zgodę / błąd ostatniego
  przebiegu), pod wybranym botem jego rozmowy, na dole „+ Nowy bot” i Kreator.
- Środek: `Thread` + `Composer` z Czatu. Nagłówek z awatarem i imieniem, a powitanie
  w stylu bota (pierwsze zdanie z pola `persona`, bez wywołania modelu).
- Karta narzędzia: zwinięta jednym wierszem („Czyta `src/main.rs`”, „Uruchamia
  `cargo test`”), rozwinięta pokazuje argumenty i wynik. Karta zgody: polecenie lub diff
  pliku, trzy przyciski, Enter = „Zezwól raz”, Esc = „Odrzuć”.
- Zrzuty w podglądzie (mock) w dwóch motywach: rozmowa z narzędziami, czekająca zgoda,
  pusta lista.

**Commit:** `M5 Etap 6: zakładka Bot`

## Etap 7 (C) – karta bota: osobowość, pamięć, skille, ustawienia

- Przycisk w nagłówku otwiera kartę bota z zakładkami:
  - **Osobowość**: imię, awatar (emoji albo obrazek), kolor, charakter, styl, czego unika,
    suwak tonu. Podgląd: jak bot się przedstawi.
  - **Pamięć**: dwa pola tekstowe z licznikiem znaków / limitem, zapis ręczny.
  - **Skille**: lista (nazwa, opis, kto utworzył, data), podgląd markdown, usuń,
    „Importuj z `~/.claude/skills`” (kopia, nie dowiązanie; tylko odczyt źródła).
  - **Ustawienia**: model (menu z Czatu), foldery (okno wyboru), przełączniki narzędzi,
    „Usuń bota”.

**Commit:** `M5 Etap 7: karta bota`

## Etap 8 (C) – Kreator: bot z opisu

- Prompt Kreatora: dopytuje maksymalnie 3 razy (do czego, jaki charakter, czy coś
  cyklicznego), potem woła `bot_create` z pełną definicją, startowymi skillami (jeśli
  zadanie tego wymaga) i propozycją zadań z harmonogramu (wyłączonych do potwierdzenia).
- Karta zgody dla `bot_create` pokazuje podgląd karty bota zamiast JSON-a.
- Po utworzeniu: nowy bot na liście, przycisk „Porozmawiaj z <imię>”.
- `bot_update`: Kreator poprawia istniejącego bota („zrób Rusta mniej gadatliwym”).
- Sprawdzić na żywo trzy opisy: bot newsowy z harmonogramem, bot do przeglądu kodu
  z folderem projektu, bot-postać bez narzędzi.

**Commit:** `M5 Etap 8: Kreator botów`

## Etap 9 (L) – harmonogram w procesie głównym

- `electron/src/bot/scheduler.ts`: jeden zegar (co 30 s) liczy `nextRun` dla włączonych
  zadań wszystkich botów. Przebiegi idą najwyżej 2 naraz, kolejne czekają.
- Zaległe przy starcie aplikacji: każde zadanie uruchamia się **raz**, nawet gdy
  ominęło kilka terminów.
- Przebieg = nowa rozmowa w `runs/`, prompt zadania + reguły zgód z `allow`. Stany:
  `running`, `done`, `error`, `waiting_approval`.
- Uśpienie komputera: zegar porównuje czas ścienny, nie liczy tyknięć.
- Testy na sztucznym zegarze.

**Commit:** `M5 Etap 9: harmonogram`

## Etap 10 (C) – harmonogram w UI, przebiegi, powiadomienia

- Zakładka **Harmonogram** w karcie bota: lista zadań (nazwa, kiedy następne,
  ostatni wynik), dodaj/edytuj (czytelny wybór „co N minut” / „codziennie o …” z dniami),
  „Uruchom teraz”, włącz/wyłącz.
- Przebiegi na liście rozmów bota z ikoną zegara. Przebieg czekający na zgodę otwiera się
  z kartą zgody na wierzchu.
- Powiadomienie na pulpicie (`notify.ts`) po przebiegu: pierwsze zdanie wyniku. Kliknięcie
  otwiera przebieg. Przy „czeka na zgodę” powiadomienie wysyłamy zawsze, nawet przy oknie
  w fokusie.

**Commit:** `M5 Etap 10: harmonogram w zakładce Bot`

## Etap 11 (C + użytkownik) – sprawdzenie w oknie

Lista do odhaczenia w `HANDOFF.md`: utworzenie bota Kreatorem, rozmowa z narzędziami
na każdym rodzaju dostawcy, zgoda i odmowa, pamięć widoczna w kolejnej rozmowie,
skill zapisany przez bota i użyty ponownie, zadanie co 5 minut przez godzinę (CPU,
powiadomienia), przełączanie zakładek przy pracujących agentach i bocie.

**Commit:** `M5 Etap 11: sprawdzenie w oknie`
