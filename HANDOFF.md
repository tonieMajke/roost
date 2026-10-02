# HANDOFF

Najnowszy wpis na górze. Każdy etap z `docs/plan-m1.md` dopisuje tu 3–8 linii.

## Windows, etap 1: warstwa platformy – 2026-10-02 (Claude, gałąź `worktree-windows`)

- Plan: `docs/plan-multiplatform.md`. Nowy `electron/src/platform.ts` – jedyne miejsce z `process.platform`: `configBase` (Linux bez zmian, macOS `~/Library/Application Support`, Windows `%APPDATA%`), `defaultShell` (`$SHELL`/`/bin/sh`, Windows `powershell.exe`), `resolveCommand` (PATH + `PATHEXT`), `spawnPlan` (Windows: `.exe` wprost, shim npm `.cmd` → `node skrypt.js`, inny `.cmd` → `cmd.exe /d /s /c` z cytowaniem jak `cross-spawn`), `signalTree`/`signalTreeSync` (grupa `-pid`, Windows `taskkill /T /F`), `bridgeSocketPath` (Windows named pipe), `opensAsProgram`.
- Przepięte: `pty.ts`, `bot/proc.ts`, `chat/cli.ts`, `summary.ts`, `bot/bridge.ts`, `config.ts` (bez chmod na Windows), `env.ts` (`$SHELL` bez zmiennej → domyślna powłoka; na Linuksie pusty `SHELL` daje teraz `/bin/sh`), `commands.ts`, `open-path.ts`, `voice/tts.ts` (`piper.exe`), `main.ts` (powiadomienia `Notification` poza Linuksem, `setAppUserModelId`, KWallet tylko Linux), freetoken tylko Linux, `term-links.ts` (`Code.exe` jako edytor).
- Bezpieczeństwo: narzędzie `bash` bota wyłączone na Windows. Ctrl+klik w ścieżkę `.bat`/`.exe`/`.lnk` (Windows) czy `.command`/`.app` (macOS) nie uruchamia jej, tylko pokazuje w folderze.
- Pakowanie: `npm run dist:win` (NSIS + zip x64), skrypty `electron/package.json` bez `../node_modules/.bin` (cmd.exe). CI: macierz ubuntu + windows, job `package-windows` z artefaktem instalatora.
- CI na Windows (PR #1) znalazło prawdziwe błędy: `Nebula.tsx`/`nebula.ts` (i Radar, Scratchpad) różniły się tylko wielkością liter – build frontendu padał; logika ma teraz nazwy `nebula-sim`, `radar-model`, `scratchpad-save`, a `filenames.test.ts` pilnuje, żeby para nie wróciła. **Polityka ścieżek bota porównywała przez `/`: na Windows `read_file ~/.ssh/id_ed25519` przechodził bez blokady.** Teraz `isInside`/`isSensitivePath` bez względu na ukośnik i wielkość liter (`src/bot-paths.test.ts`), `realpathSync.native` (nazwy 8.3), dwukropek strumienia NTFS odrzucany, wrażliwe katalogi Windows (DPAPI `Protect`, profile przeglądarek, historia PSReadLine). `grep` dawał pustkę przez `detached` (osobna konsola, shim `rg` gubił wyjście) – `groupSpawn()` tylko na POSIX. Limit czasu `summary`/`git` i zamknięcie Pipera zabijają drzewo (`killChild`).
- Testy: warianty Windows dla `pty`, `runProc`, Pipera (atrapa przez `.cmd`), `commands`; `skipIf` tylko dla `chmod` i wyłączonego `bash`.
- Interfejs: `src/paths.ts` (`programName`, `baseName`, `isUnder`, `trimSep`) zamiast `split("/")` – rozpoznanie agenta po `claude.exe`/`codex.cmd`, nazwa projektu, `~\x`, cwd w statystykach i handoffie. Ctrl+klik rozpoznaje `C:\…\plik.rs:12:5` i `src\lib.rs`. Kodowanie katalogu sesji Claude'a (`C:\a\b` → `C--a-b`) jest takie samo jak w Claude Code – bez zmian.
- Stop/limit czasu na Windows: `releaseAfterExit` zamyka potoki po śmierci procesu, bo `taskkill /T` nie znajdzie wnuka-sieroty (`sh` → `sleep`), który trzymałby `close`.
- **CI zielone na ubuntu i windows** (PR #1). Testy pty na Windows idą przez `cmd.exe`.
- Test dymny zamiast VM: job `smoke-windows` (`electron/smoke/windows.mjs`) instaluje `Roost-Setup.exe` po cichu na czystej maszynie, uruchamia go z `--remote-debugging-port` (Playwright `connectOverCDP`; bezpiecznik wyłącza `--inspect`, więc `_electron.launch` odpada) i z `ROOST_CONFIG_DIR` na workspace z panelami PowerShell, `claude`, `codex` (z npm) w folderze `Zażółć gęślą\projekt x`. Sprawdza: prompt i polecenie wpisane z klawiatury, start claude/codex, wykrywanie programów, `resolve_files`, `notify`, `cmd.exe` przez ConPTY, konsolę strony, tytuły paneli, zamknięcie okna, na koniec deinstalację. Zrzuty i `wyniki.txt`: artefakt `smoke-windows`.
- **Znalezione przez test dymny: wszystkie panele na Windows były puste.** node-pty na Windows ignoruje `encoding: null` i oddaje tekst, a strona dekoduje bajty – `pty.ts` zamienia tekst na `Buffer`; `pty.test.ts` dekoduje teraz `TextDecoder` jak strona (stary `Buffer.from` maskował błąd). ConPTY ustawia tytuł konsoli na ścieżkę programu („Administrator: C:\…\powershell.exe”) – `cleanTermTitle` go pomija. codex odmawia startu jako administrator (CI) bez `--no-daemon`; u zwykłego użytkownika bez znaczenia.
- Niesprawdzone (CI nie pokaże): SmartScreen, wygląd powiadomień, named pipe bota w spakowanej aplikacji (tylko test jednostkowy na Windows). Po zamknięciu został jeden `OpenConsole.exe`, ale był też przed – nie wiadomo, czy nasz.
- README EN/PL: sekcja „Windows (beta)”: instalator/zip, SmartScreen, `npm`/`winget`, różnice.
- Otwarte: workflow wydań po tagu (AppImage + exe + zip), SignPath, `electron-updater`, macOS (skróty `Cmd`, `titleBarStyle`, dmg).

## AppImage na innych dystrybucjach, ostrzeżenie o braku sandboxa – 2026-10-02 (Claude)

- Kontenery podmana (Ubuntu 22.04/24.04, Debian 12) i VM Ubuntu 24.04 (QEMU/KVM, obraz chmurowy, cloud-init przez HTTP, Xvfb): AppImage startuje, `pty.node` i node-pty działają, okno się rysuje. Szczegóły: `docs/checklista-wydania.md` §0.
- Na 24.04 AppRun z electron-buildera po cichu dodaje `--no-sandbox` (gdy `unshare -Ur` się nie udaje). Nowe `electron/src/sandbox-notice.ts`: jednorazowe okno ostrzeżenia z instrukcją i „Nie pokazuj ponownie” (plik `no-sandbox-ok` w konfiguracji), tylko w spakowanej aplikacji. README EN/PL: profil AppArmor jako blok do wklejenia (sprawdzony w VM), SECURITY.md: znane ograniczenie.
- Sprawdzone: `pnpm typecheck`, `pnpm test` (918 + 10), electron typecheck, `npm run dist`; w VM ostrzeżenie bez profilu, brak ostrzeżenia i sandbox (seccomp=2) z profilem.
- Niesprawdzone: prawdziwy pulpit Ubuntu (GNOME), Mint, polska wersja okna na żywo (tylko test jednostkowy).

## Wydanie 0.0.1 i CI – 2026-10-02 (Claude)

- Release [`v0.0.1`](https://github.com/tonieMajke/roost/releases/tag/v0.0.1) (pre-release) na `97f78a9`: `Roost-0.0.1.AppImage` z czystego klonu + `.sha256`; pobrany plik zgadza się z sumą. README EN/PL: sekcja „Download”/„Pobieranie” z linkiem do Releases.
- CI (`.github/workflows/ci.yml`, ubuntu, Node 26, pnpm 11): ripgrep, `electron npm ci && npm run build` (testy potrzebują `node-pty` i `out/mcp-server.cjs`), typecheck obu części, `pnpm test`. Zielone 2× z rzędu. README: pełna lista sprawdzeń.
- Błędy znalezione przez CI: `runCli` (czat CLI) przy Stop zabijał tylko program, jego dzieci trzymały stdout i Stop wisiał – teraz `detached` + `killGroup`. `pty.ts`: panel zamknięty tuż po starcie (przed `setsid`, ESRCH na `-pid`) przeżywał – `signalGroup` spada na sam pid.
- Wiki i Projects na GitHubie wyłączone. Private vulnerability reporting był już włączony.
- Otwarte: `CONTRIBUTING`, szablony zgłoszeń, test AppImage na innych dystrybucjach (`docs/checklista-wydania.md` §0), `AGENTS.md` wskazuje jeszcze `plan-m5.md`. Wypychanie zmian w `.github/workflows/` działa przez SSH (`origin`), token `gh` nie ma zakresu `workflow`.

## Przed upublicznieniem repo – 2026-10-02 (Claude)

- Przegląd: w drzewie i całej historii `main` brak kluczy/tokenów (`sk-ant` to atrapa w testach), brak `.env`/`.pem`/AppImage w gitcie, `.gitignore` pokrywa wyniki budowy. Dane osobiste: tylko `/home/majke/...` w danych testowych i mocku; w starych commitach adresy `majke@localhost`/`pi-gui@localhost`. Na `origin` jest tylko `main` (lokalne gałęzie robocze nie są wypchnięte).
- `SECURITY.md`: zgłoszenia przez GitHub Security Advisories, bez „napisz do właściciela”. **Do zrobienia na GitHubie po zmianie widoczności:** włączyć *Settings → Code security → Private vulnerability reporting*, uzupełnić opis i tematy repo, sprawdzić `social-preview` (`branding/`).
- Otwarte: CI, `CONTRIBUTING`, szablony zgłoszeń.

## Okno pierwszego uruchomienia – 2026-10-02 (Claude, gałąź `main`)

- Pokazuje się, gdy nie ma `workspace.json` (`App.tsx`: `firstRun`). `FirstRunDialog.tsx`: język i motyw (wspólny `UiRowControl.tsx`, wyciągnięty z „Wyglądu”), lista agentów z `agents.json` z oznaczeniem „znaleziony / brak w PATH” (+ komenda instalacji dla claude i codex) i „Sprawdź ponownie”, wybór folderu i presetu → `startFirstProject` tworzy projekt od razu z panelami. „Pomiń”/Esc zamyka; po pierwszym zapisie okno już się nie pojawi.
- Wykrywanie: `backend.commandsAvailable` → `commands_available` w `electron/src/commands.ts` (PATH jak u dziecka z `childEnv`, `$SHELL`/`~` rozwijane jak przy starcie panelu). Logika wyboru presetów: `src/firstrun.ts` (tylko presety, w których każdy agent jest dostępny; bez agentów CLI sama powłoka). Teksty `first.*` w `src/i18n/messages/app.ts`.
- Sprawdzone: `pnpm typecheck`, `pnpm test` (916 + 10 pominiętych), electron typecheck, build i vitest (353 + 10).
- **Niesprawdzone:** wygląd okna (nie oglądany w przeglądarce ani oknie), prawdziwy pierwszy start na czystym `ROOST_CONFIG_DIR`, komendy instalacji (z pamięci; pi bez komendy celowo). Podgląd w przeglądarce (mock) udaje brak `pi`. Nie ma sposobu ponownego otwarcia okna po pominięciu.

## AppImage poza Archem – 2026-10-02 (Claude, gałąź `main`)

- `pty.node` wymagał glibc 2.42 (`cfsetospeed`/`cfsetispeed`). `electron/build-tools/glibc-compat.h` przypina je do `GLIBC_2.2.5` (x86_64), `npm run dist` wstrzykuje go przez `CXXFLAGS=-include` (ścieżka w apostrofach, bo repo ma spację w nazwie) i **kasuje `node-pty/build` przed budową**, inaczej electron-builder używa starego, już skompilowanego modułu. Po budowie `build-tools/check-pty-glibc.sh` kończy się błędem, gdy `pty.node` wymaga glibc > 2.34. Wynik `objdump`: `cfsetospeed`/`cfsetispeed` = 2.2.5, reszta ≤ 2.4.
- `build.toolsets.appimage: "1.0.3"` (beta electron-buildera): statyczny runtime (`static-pie`, bez `NEEDED`), nie potrzebuje libfuse2; `--appimage-extract` działa. README (EN/PL, „Problemy”): libfuse2 dla starych paczek, `--appimage-extract-and-run`, AppArmor na Ubuntu 24.04 (profil, `--no-sandbox` i jego skutki), brak `claude`/`pi` w `PATH`. Sandbox w kodzie nie ruszany.
- Brak `claude`/`pi` w PATH: node-pty kończy `execvp(3) failed.: No such file or directory` + pasek „Proces zakończony”. Propozycja (niewdrożona): w `Ptys.spawn` sprawdzić komendę w `PATH` i zwrócić błąd, który `Terminal.tsx` pokaże przez nowy klucz `pane.term.notFound` (PL+EN w `src/i18n/messages/panes.ts`: „Nie znaleziono programu „{command}” w PATH. Zainstaluj go albo wpisz pełną ścieżkę w agents.json.”).
- Sprawdzone: `pnpm typecheck`, `pnpm test` (904 + 10 pominiętych), electron typecheck, `pnpm electron:dist` (przebudowa node-pty, AppImage 128 MB).
- **Niesprawdzone (brak innej dystrybucji):** start na Ubuntu 22.04/24.04, Debianie 12, Mincie; ładowanie `pty.node` na glibc < 2.42; statyczny runtime bez libfuse2; AppArmor. Pozycje w `docs/checklista-wydania.md` §0.

## Audyt i poprawki bezpieczeństwa – 2026-10-02 (Claude, gałąź `roost-rename`)

- Bot: `grep` nie odsłania `.env`/kluczy przez glob modelu (kolejność `--glob`); szersza lista ścieżek wrażliwych (historia powłok, git/gh credentials, `~/.pi/agent/auth.json`, profile przeglądarek, `/proc/*/environ|mem` też w bash); zgody „na rozmowę” dla curl/cat/cp/tar/grep itp. tylko na identyczne polecenie; `skill_create`/`skill_patch` pytają (karta z treścią/diffem); `web_fetch` łączy się z adresem z jednego rozwiązania DNS (`pinnedLookup`, bez rebindingu). Pierwszy `web_fetch` do nowego hosta pyta (zgoda „na rozmowę” = ten host); ryzykowny URL pyta zawsze, przekierowanie na niezatwierdzony host kończy się błędem; przebiegi harmonogramu bez zmian.
- Proces główny: blokada jednej instancji (przed migracją; pomijana przy `ROOST_CONFIG_DIR`/`AGENTS_CONFIG_DIR`), `ensureConfigPerms` (0700/0600) przy każdym starcie, `AGENTS_DEV_URL`/`AGENTS_DEVTOOLS` tylko poza paczką, uprawnienia Chromium domyślnie odmowa (mikrofon i zapis schowka tylko dla strony aplikacji), git z `core.fsmonitor=false`, statystyki usuwają z indeksu skasowane logi, kopia `web-search.json` od razu 0600.
- Build: `electronFuses` (bez `runAsNode=false` – używają go statusline i mcp-server), `vite.config.mts`. `npm run dist` przechodzi, `pty.node` rozpakowany poza asar.
- Splash decyduje się raz po wczytaniu ustawień (bez mignięcia przy „off”). `THIRD-PARTY-NOTICES.md` z licencjami wszystkich zależności produkcyjnych; `PLAN.md` odhaczony (dashboard, przeciąganie pliku); bez `data-tauri-drag-region`; `.gitignore` z `*.AppImage`, `.env*`.
- Sprawdzenia: `pnpm typecheck`, `pnpm test` (904 + 10 pominiętych), electron typecheck/build/vitest (347 + 10) – przechodzą.
- **Niesprawdzone w oknie:** druga instancja (fokus pierwszego okna), mikrofon i lista mikrofonów po nowych uprawnieniach, fuses w działającym AppImage, splash, karta zgody na host. Otwarte: CI.

## Porządki w dokumentacji i przełącznik splasha – 2026-10-02 (Claude, gałąź `roost-rename`)

- Dokumentacja: README EN/PL uzupełnione (funkcje, wymagania, skróty, problemy), nowe `SECURITY.md`, `docs/README.md` (spis planów), `docs/checklista-wydania.md` (65 otwartych sprawdzeń z okna), HANDOFF przycięty, starsze wpisy w `docs/archiwum/`.
- Kod: `ui.splash` (`on`/`off`) w oknie „Wygląd” (wiersz „Ekran powitalny”), `App.tsx` pokazuje `<Splash />` tylko przy `on`; test w `src/ui.test.ts`. `pnpm typecheck` i `pnpm test` (889 + 10 pominiętych) przechodzą; wygląd wiersza w oknie niesprawdzony.
- Nieaktualne punkty usunięte z listy „do zrobienia”: domyślny `piper-tts` i model `pl_PL-bass-high` są już w kodzie (`tts.ts:42`, `voice.ts:46`), szukanie w terminalu (Ctrl+F) też.
- Poza zakresem na razie: Windows/macOS i CI z macierzą (`docs/plan-multiplatform.md`, plan na przyszłość).
- **Niezacommitowane, nie z tej pracy:** `src/handoff.ts` i `src/i18n/messages/app.ts` (tłumaczenie promptu streszczenia przez `t("handoff.system")`), a także `src/Splash.tsx`, `src/i18n/messages/ui.ts` (nazwa motywu „Watchtower”) i `src/styles.css` (`.dock-live`) z początku sesji. Przed commitem rozdzielić: dokumentacja + `ui.splash` osobno.
- **Nic nie zacommitowane.** Do zrobienia w tej kolejności: commit dokumentacji i `ui.splash`; odhaczanie `docs/checklista-wydania.md` w oknie; `AGENTS.md` wskazuje jeszcze `plan-m5.md` jako plan do wykonania (zostaje tylko etap 11), więc po wyborze następnego planu zaktualizować.
- Propozycje usprawnień, jeszcze nietknięte: odświeżanie otwartej karty bota po `bot_update` Kreatora; stan „czeka na odpowiedź” w panelu (blokuje elementy Wieży i Mgławicy); Codex jako źródło „Kontynuuj gdzie indziej”; statystyki tokenów etap 5 i scalenie gałęzi (napisy trzeba przenieść do `src/i18n/messages/stats`).

## Zmiana nazwy: Agents workspace → Roost (gałąź `roost-rename`) – 2026-10-02 (Claude)

- Nazwa produktu **Roost**, hasło „Rule the roost”, slug `roost-app` (npm wolne, w sprawdzeniu 2026-10-02). `appId` `dev.majke.roost`, AppImage `Roost-<wersja>.AppImage`, `StartupWMClass` `roost-app`.
- Konfiguracja: `~/.config/dev.majke.roost/`; przy pierwszym starcie stary `dev.majke.agents` jest **kopiowany** (`migrateLegacyConfig` w `electron/src/config.ts`, stary zostaje). Env `ROOST_CONFIG_DIR`, dawny `AGENTS_CONFIG_DIR` nadal działa; przy własnym katalogu z env migracji nie ma.
- **Nie zmieniać `app.setName("Agents")` i `userData` w `main.ts`**: od nich zależy wpis w sejfie systemowym z kluczami API (safeStorage); zmiana unieważniłaby zapisane klucze.
- Tytuł okna: „<wybrany panel> — Roost”. Splash (`src/Splash.tsx`, ~1,3 s, tylko w oknie Electrona, klawisz/klik zamyka). Ikona bez zmian (cztery kwadraty); próby z krukiem odrzucone.
- Zostawione celowo: klucz `aw-workspace` (podgląd w przeglądarce), `AGENTS_DEV_URL`/`AGENTS_DEVTOOLS`, `legacy-tauri/`, dane w testach i mockach.
- Do zrobienia: ręczny test AppImage (start, migracja, klucze API), zmiana nazwy folderu projektu i repo na GitHubie.

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

## Motywy V–Ż: Ciemnia, Partytura, Ryzograf, Laka, Poziomice, E-papier, Bauhaus (2026-10-01, poza planem M5)

- Źródło: artefakt „Motywy V–Ż” (claude.ai). Przeniesione tylko motywy; „Zmiany w UI” z tego artefaktu (motyw dla projektu, plan dnia, kolejka Ctrl+Alt+J itd.) nie są zrobione.
- `themes.ts`: 7 wpisów (akcent, próbka, terminal i font terminala). Własne palety ANSI mają Ciemnia (sama czerwień, różnice jasnością), Laka i E-papier (szarości: diffy bez koloru). Jasne motywy mają `LIGHT_ANSI`.
- `themes.css`: tokeny i ozdoby z makiet. Ciemnia: terminal w kuwecie, „Na żywo” jako negatyw. Partytura: pięciolinia w nagłówku, klucze zamiast liter, cresc./fermata/fine. Ryzograf: raster, przesunięcie różu, ziarno tylko pod panelami. Laka: seigaiha, pieczęć cynobru. Poziomice: warstwice, ▲⚑◉. E-papier: faktury agentów, zero animacji i przejść. Bauhaus: koło, trójkąt i kwadrat, figura kręci się przy pracy.
- `data-ag` (id agenta) na panelu, wierszu szyny, wierszu kontekstu i „Na żywo”. Motywy V–Ż nadpisują kolor agenta (`--ag … !important`, bo kolor jest inline), żeby trzymać paletę makiety. Agent spoza claude/pi/codex dostaje kolor zapasowy motywu.
- `themes-chat.css`: wszystkie 7 motywów także w Czacie i Bocie.
- 17 paczek fontów (`@fontsource…`, ładowane leniwie jak poprzednie); dwie paczki Big Shoulders bez typów mają deklarację w `vite-env.d.ts`. `vitest.config.ts` czyta też `themes-chat.css` jako tekst. Nowy test: każdy motyw ma wpis w `themes-chat.css`.
- Pominięte (wymagają logiki, nie CSS): takt nut w pulpicie Partytury, złoty szew po restarcie (Laka), podziałka i strzałka północy (Poziomice), mignięcie przy włączeniu E-papieru.
- Sprawdzone: zrzuty Code (projekt z 3 panelami), Czat i Bot w 7 motywach, 0 błędów konsoli; `pnpm typecheck`, `pnpm test` (676 + 10 pominiętych), `pnpm build`.
- Niesprawdzone: prawdziwe TUI claude/pi w terminalu Ciemni i E-papieru (kolory ANSI bez barwy), panel w stanie „gotowe” i „czeka” (podgląd pokazuje tylko „pracuje”).

## Motywy w Czacie i Bocie (2026-10-01, poza planem M5)

- Prośba: „motywy trzeba poprawić/doszlifować, mają też wchodzić na okno czat i bot”. Wcześniej Czat i Bot brały z motywu tylko kolory i fonty. Zaokrąglenia były na sztywno (18/14/10/8 px), tło środka zasłaniało tło okna, a ozdoby z `themes.css` działały tylko w Code.
- `chat.css`/`bot.css`: zaokrąglenia z tokenów `--chat-r`, `--chat-r-md`, `--chat-r-sm`, `--chat-r-xs`, liczonych z `--r-dialog`. Motyw z kanciastymi oknami ma kanciasty czat; wzór D bez zmian. Cień kart to `--card-shadow`. `.chat-main` i `.bot-head` są przezroczyste, więc widać tło `.app` (kratka, kropki, mgławica…).
- Nowy `src/themes-chat.css` (ładowany w `main.tsx` po App): dla każdego z 21 motywów odpowiedniki ozdób z Code. `.rail` → `.chat-side`, `.area` → `.chat-main`, `.area-head` → `.bot-head`, `.pane` → pole wpisywania, karty narzędzi, zgoda, kod, tabela, źródła; do tego aktywna rozmowa i bot.
- Przykłady:
  - Pulpit 95: wątek jako okno z fazą, pole wpisywania jak w Win95;
  - Składanka: wątek jako wydruk z perforacją, z papierowymi tokenami;
  - Metro: lista rozmów jako linia ze stacjami;
  - Kuchnia: aktywna rozmowa jako bon;
  - Shōnen: odpowiedź w kadrze, pytanie w dymku;
  - Telegazeta: większe rozmiary pod VT323.
- Poprawione błędy kontrastu: Pulpit 95 (`--active` to granat, więc czarny tekst na granacie w aktywnej rozmowie, dymku, `code` i przełączniku Code/Czat/Bot) oraz Składanka (białe karty z jasnym tekstem, biały przycisk w przełączniku). Przełącznik poprawiony też w Code.
- Sprawdzone zrzutami (Electron offscreen, podgląd z mockiem): Czat (rozmowa z tabelą/kodem i powitanie) i Bot (rozmowa z narzędziami) we wszystkich 22 motywach, 0 błędów konsoli. `pnpm typecheck`, `pnpm test` (675 + 10 pominiętych).
- Niesprawdzone: karta bota, zgoda Kreatora z podglądem i menu modeli w każdym motywie (dostają tokeny, ale bez osobnych ozdób); wygląd w prawdziwym oknie.

## Tła motywów: Mgławica i radar Wieży (2026-10-01, poza planem M5)

- Powód: motywy z makiet A–U miały w kodzie tylko tokeny i CSS, a część makiet to żywa grafika. Zestawienie makieta ↔ `themes.css` pokazało braki w Mgławicy, Biurze, Wieży, Karuzeli, Rtęci oraz układach Rzeka/Metro/Akwarium/Konstelacja.
- **Mgławica** (`811259b`): `Nebula.tsx` (canvas pod `.grids`, tylko motyw `mglawica`) + `nebula.ts` (czysta symulacja). Tempo cząstek ze stanu `st-*` panelu (`rateFor`), kolor z `--ag`, rdzeń w środku, fala po `st-done`. `backdrop-filter` na panelach. Tryb Oszczędny / `prefers-reduced-motion` = jeden statyczny kadr i bez blura; ukryte okno nie rysuje.
- **Wieża** (`811259b`): `Radar.tsx` + `radar.ts` – sekcja „Radar” na górze Pulpitu, tylko motyw `wieza`. Odległość znaku = czas od ostatniego wyjścia (pierścienie 1/5/15 min), kąt stały z id panelu, wołanie `CLA1 041` = agent + kontekst %. Dane: `activity.current` z `App.tsx` przez prop `radar` w `Dock`.
- Sprawdzone: `pnpm typecheck`, `pnpm test` (530 + 4 pominięte), `electron` build. Testowa kopia z osobnym `AGENTS_CONFIG_DIR` i `--user-data-dir` uruchomiona na prośbę użytkownika (wbrew zakazowi z AGENTS.md, bo to użytkownik o to prosił); wygląd **nie** oceniony.
- **Niesprawdzone:** wygląd i koszt GPU Mgławicy przy wielu panelach, czytelność radaru w Pulpicie 300 px.
- Pominięte względem makiet: żółte fale „czeka” i bursztynowy znak CZEKA (brak stanu „czeka na odpowiedź” w aplikacji), napis „N zmian · M plików” w rdzeniu, pasek „SEKTOR/QNH”, **paski lotów** Wieży (lista paneli ze wszystkich projektów po pilności – makieta uznaje je za lepsze od samego radaru). Radar pokazuje tylko aktywny projekt.
- Do zrobienia: **Biuro** (izometryczne SVG z biurkami – ekran powitalny projektu albo widok w Pulpicie, nie tło), reszta tabeli braków. Niezacommitowane zmiany w `electron/src/bot/*`, `main.ts`, `preload.ts`, `src/backend*.ts`, `src/bot*.ts` nie pochodzą z tej pracy.
## Głos: narzędzia także na claude/codex CLI – 2026-10-01 (Claude, gałąź `glos`)

- Zgłoszenie: „głos mówi, że nie ma informacji o niczym”. Przyczyna: mózg rozmowy = `claude` CLI (Haiku), a narzędzia i przegląd były tylko dla dostawców HTTP.
- Teraz `chat_send` z `req.tools` u claude/codex CLI uruchamia serwer MCP `bot` (most z M5); wywołanie idzie do okna zdarzeniem `tool_request`, okno wykonuje `runVoiceTool` (z kartą) i odsyła `chat_tool_result` (`electron/src/chat/window-tools.ts`). Koniec odpowiedzi/Stop zamyka wiszące prośby.
- Sprawdzone: typecheck, `pnpm test` (668 + 10 pominiętych), electron build, **na żywo** `AW_LIVE=1 … voice-cli-live.test.ts`: Haiku woła `read_pane` przez MCP i streszcza ekran (6 s).
- Niesprawdzone w oknie: karta przy CLI (czeka do 6 h, limit MCP z M5), codex.

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

**Do zrobienia w kodzie** (pkt 1 i 2 zrobione, zob. wpis z 2026-10-02: `tts.ts:42`, `voice.ts:46`)
1. ~~**Domyślny program Pipera**~~: `electron/src/voice/tts.ts:198` ma `p.command ?? "piper"`, a `TalkSettings.tsx:94` placeholder „piper (z PATH)”. Na tym systemie (Arch/AUR) to `piper-tts`. Spróbować `piper-tts`, potem `piper` (albo wykrywać przez PATH), poprawić placeholder i komunikat ENOENT (`tts.ts:115`). Dodać test.
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


---

Starsze wpisy (M0–M5 etap 10, część z czasów Tauri): [`docs/archiwum/HANDOFF-do-2026-10-01.md`](docs/archiwum/HANDOFF-do-2026-10-01.md).
