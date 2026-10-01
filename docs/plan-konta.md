# Plan – konta agentów i kontynuacja na innym koncie

Dopisane 2026-10-01. Pozycja „Przełączanie kont przy limicie” z `PLAN.md` (wzór: BridgeMind One).
Po publikacji na GitHubie ma to działać dla każdego, kto ma kilka subskrypcji Claude / Codex,
więc funkcja jest opcjonalna: bez dodanych kont aplikacja zachowuje się jak dotąd.

## Co ma działać

1. **Konto** = nazwany, osobny folder logowania agenta.
   - Claude: `CLAUDE_CONFIG_DIR=<folder>` (domyślne konto = `~/.claude`, bez zmiennej).
   - Codex: `CODEX_HOME=<folder>` (domyślne = `~/.codex`).
   - Okno „Konta”: lista, dodaj (nazwa + agent + folder; „Zaloguj” otwiera panel powłoki
     z `claude` / `codex login` w tym folderze), usuń (tylko z listy, folderu nie ruszamy).
2. **Wybór konta** per panel (w „Nowy panel”), z domyślnym per agent i nadpisaniem per projekt.
   Nazwa konta jako plakietka w nagłówku panelu, gdy kont jest więcej niż jedno.
3. **Limity per konto.** Dziś `claude-limits.json` jest jeden; każde konto dostaje własny plik,
   dok pokazuje limity konta wybranego panelu (albo każdego po kolei).
4. **Przy limicie** (okno 5 h lub tygodnia ≥ 100 %) panel dostaje pasek:
   „Limit konta *Praca*. [Poczekaj do 22:40] [Kontynuuj na koncie *Prywatne*] [Kontynuuj w Codex]”.
5. **Kontynuuj** = nowy panel na innym koncie albo w innym agencie, z wklejonym streszczeniem
   (istniejące `handoff.ts` + streszczenie Haiku/pi z M4), bez Entera. Stary panel zostaje.
   To samo jest dostępne ręcznie z menu panelu, nie tylko przy limicie.

## Decyzje

- **Nie kopiujemy ani nie czytamy tokenów.** Aplikacja zna tylko ścieżkę folderu i ustawia zmienną
  środowiskową. Logowanie robi sam agent. Do tego `auth.json` / `.credentials.json` nie trafiają
  do `workspace.json` ani do logów.
- **Wznowienie sesji po stronie innego konta nie istnieje** (sesje leżą w folderze konta), więc
  „kontynuuj” zawsze znaczy nowa sesja + streszczenie, nie `--resume`.
- **Czytanie sesji zależy od konta.** `sessionContext` / `sessionHandoff` szukają dziś w
  `~/.claude/projects`; muszą dostać katalog konta panelu.
- **Zmienne per panel:** `SpawnSpec.env` już istnieje (`pty.ts`), brakuje tylko wypełniania go
  w `App`/`Terminal` z konta panelu.
- **Wykrywanie limitu** tylko dla Claude (mamy `rate_limits` ze statusline). Dla Codexa na razie
  ręczne „Kontynuuj”; automat po ustaleniu, skąd czytać jego limity.
- **Typ konta** (`AccountDef`) żyje w `accounts.json` w katalogu konfiguracji, obok `agents.json`.

## Etapy

- [x] **Etap 1 – model (TS, czysty, testy).** `src/accounts.ts`: `AccountDef {id, name, agent, dir}`,
  `parseAccounts`, `accountEnv(agent, account) -> [k, v][]`, wybór konta (panel > projekt > domyślne),
  test na walidację i na to, że domyślne konto nie ustawia zmiennej.
- [ ] **Etap 2 – dysk i IPC.** `electron/src/accounts.ts` (`accounts.json`), `accounts_load/save`,
  `backend*.ts` + mock. Okno „Konta” (lista, dodaj, usuń) i przycisk „Zaloguj”.
- [ ] **Etap 3 – konto w panelu.** Pole `account` w zapisie panelu (`workspace.json`, wstecznie
  zgodne), wybór w „Nowy panel”, `env` przy `pty_spawn`, plakietka w nagłówku.
- [ ] **Etap 4 – limity per konto.** `--settings` z plikiem limitów konta, `claude_limits(accountId)`,
  dok i `limits.ts` z kontem.
- [ ] **Etap 5 – Kontynuuj.** Pasek przy limicie + pozycja w menu panelu; nowy panel z kontem/agentem
  docelowym i streszczeniem. Dopasować `sessionHandoff` do katalogu konta.
- [ ] **Etap 6 – README i sprawdzenie na żywo.** Opis kont w README (po angielsku dla GitHuba),
  próba z drugim kontem Claude i `CODEX_HOME`, lista do odhaczenia w `HANDOFF.md`.

## Do sprawdzenia na żywo przed Etapem 3

- Czy `CLAUDE_CONFIG_DIR` w v2.1.x przenosi też `settings.json`, skille i `projects/` (tak jest
  w dokumentacji, ale statusline z `--settings` trzeba przetestować).
- Czy Codex 0.153 z `CODEX_HOME` czyta własne `config.toml` (MCP z M5 Etap 5 zależy od tego).
- Co robi Claude, gdy `CLAUDE_CONFIG_DIR` wskazuje pusty folder (ekran logowania w panelu).
