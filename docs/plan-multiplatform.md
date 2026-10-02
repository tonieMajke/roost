# Plan „Roost na Windows i macOS”

Dopisane 2026-10-02 z rozmowy z użytkownikiem. Praca idzie na gałęzi `worktree-windows`
(worktree `.claude/worktrees/windows`); stan w HANDOFF.

**Decyzja w kodzie:** narzędzie `bash` bota na Windows jest wyłączone (`toolDefs` go nie daje),
dopóki nie powstaną reguły zgód dla PowerShella (Zagrożenia, pkt 2).

**Warunek brzegowy: nic nie płacimy.** Żadnego Apple Developer Program, certyfikatów
OV/EV ani Azure Trusted Signing. Wszystko poniżej zakłada darmowe drogi.

Interfejs (React, xterm) jest przenośny. Problem siedzi w procesie głównym
(`electron/src`), który w kilkunastu miejscach zakłada Linuksa.

## Decyzje

- **Kolejność: najpierw Windows, potem macOS (beta).** Windows wymaga więcej kodu, ale
  da się go testować lokalnie w VM, ma darmowy podpis (SignPath) i działa na nim
  auto-update. Mac bez płatnego konta zawsze będzie „z instrukcją obejścia”.
- **Linux się nie zmienia:** konfiguracja zostaje w `~/.config/dev.majke.roost`, AppImage jak dziś.
- **Freetoken (systemctl, nvidia-smi, llama-router) tylko na Linuksie.** Poza nim ukryty.
- **Repozytorium musi być publiczne**: darmowe maszyny macOS/Windows w GitHub Actions
  i SignPath Foundation tego wymagają.
- Otwarte: narzędzie `bash` bota na Windows. Do wyboru: PowerShell z nowymi regułami
  zgód, Git Bash, jeśli zainstalowany, albo wyłączenie narzędzia (patrz Zagrożenia, pkt 2).

## Co dziś jest przywiązane do Linuksa

| Obszar | Gdzie | macOS | Windows |
|---|---|---|---|
| Katalog konfiguracji `~/.config/dev.majke.roost` | `config.ts:18` | działa, nietypowo | `app.getPath("userData")` / `%APPDATA%` |
| `chmod 0600/0700` sekretów | `config.ts:70`, `chat/keys.ts`, `chat/pi.ts:131` | działa | nic nie robi; ACL albo profil użytkownika |
| Powiadomienia `notify-send` | `notify.ts` | brak | brak. `Notification` z Electrona |
| Otwieranie plików `xdg-open`, `startsWith("/")` | `open-path.ts` | `open` | `shell.openPath`, ścieżki `C:\` |
| Narzędzie `bash` bota: `/bin/sh -c` | `bot/tools.ts:359` | działa | brak `/bin/sh` |
| Grupy procesów `process.kill(-pid)`, `setsid` | `pty.ts:27`, `bot/proc.ts:38` | działa | `taskkill /T /F` |
| `SIGTERM` → `SIGKILL` | `chat/cli.ts`, `git.ts`, `voice/tts.ts`, `summary.ts` | działa | brak łagodnego zamknięcia |
| Gniazdo uniksowe mostu MCP w `$XDG_RUNTIME_DIR` | `bot/bridge.ts:34` | brak zmiennej → `/tmp`; limit 104 znaków ścieżki | named pipe `\\.\pipe\…` |
| Domyślny terminal `$SHELL` | `config.ts:90` | zsh, działa | `pwsh` / `cmd` |
| `spawn` CLI (`claude`, `codex`, `pi`, `git`, `rg`, `piper`) | `chat/cli.ts`, `pty.ts`, `bot/tools.ts` | ubogi PATH z Findera | npm daje `.cmd`, `spawn` ich nie znajdzie |
| Środowisko procesów (AppImage) | `env.ts` | odtworzyć PATH z powłoki logowania | `Path` vs `PATH` |
| `safeStorage`, wykrywanie KWallet | `chat/keys.ts:78`, `main.ts:58` | Keychain (patrz Zagrożenia, pkt 4) | DPAPI |
| Freetoken | `chat/freetoken.ts` | ukryć | ukryć |
| Ścieżki sklejane przez `/` | ~25 miejsc w `src/` i `electron/src` | działa | przejrzeć każde |
| Skróty `ctrlKey` | 9 miejsc w `src/` | Cmd | działa |
| Okno `frame: false` | `main.ts:507` | przyciski po lewej, `titleBarStyle: "hiddenInset"` | sprawdzić Snap i przeciąganie |
| `node-pty` (natywny) | `pty.ts` | x64 + arm64 | ConPTY, build na Windows |
| Pakowanie | `electron/package.json`: tylko `--linux AppImage` | `.dmg`, podpis ad-hoc | NSIS `.exe` + `.zip` |
| Domyślny Piper (`piper-tts`, `piper`) | `voice/tts.ts:43` | działa | szukać `piper.exe` |

## Etapy

### Etap 1: warstwa platformy

1. Nowy `electron/src/platform.ts`. W nim i tylko w nim jest `process.platform`:
   `configDir()`, `defaultShell()`, `killTree(pid)`, `openFile()`, `notify()`,
   `ipcPath()` (gniazdo albo named pipe), `resolveCommand()` (`.cmd`/`.exe` na Windows).
2. Przepiąć na niego `pty.ts`, `bot/proc.ts`, `chat/cli.ts`, `git.ts`, `summary.ts`,
   `notify.ts`, `open-path.ts`, `bot/bridge.ts`, `config.ts`, `env.ts`, `voice/tts.ts`.
3. macOS: przy starcie odczytać PATH z powłoki logowania (`$SHELL -ilc 'echo $PATH'`, jak pakiet `shell-env`).
4. Migracja konfiguracji tylko poza Linuksem: nowa lokalizacja, a na Linuksie po staremu.
5. Przejrzeć ścieżki: `path.join` / `path.isAbsolute` zamiast `"/"`.
6. Skróty: `mod = isMac ? metaKey : ctrlKey`.
7. Ukryć freetoken poza Linuksem.

### Etap 2: pakowanie i CI

- `electron-builder`:
  - `win`: `nsis` + `zip`,
  - `mac`: `dmg`, `arm64` + `x64` (albo universal), podpis ad-hoc, `NSMicrophoneUsageDescription`
    w Info.plist (bez tego nagrywanie głosu po cichu nie dostanie mikrofonu).
- Ikony `.ico` / `.icns` są już w `legacy-tauri/src-tauri/icons/`.
- GitHub Actions z macierzą `ubuntu` / `windows` / `macos`: `vitest`, typecheck, build,
  artefakty do GitHub Releases.
- Testy zależne od platformy (`pty.test.ts`, `bot/proc.test.ts`, `bot/bridge.test.ts`) dostają `skipIf` albo warianty.

### Etap 3: podpisywanie (za darmo)

- **Windows: SignPath Foundation.** Darmowy podpis dla projektów open source (GPL-3.0
  się kwalifikuje). Warunki: publiczne repo, licencja OSI, build w CI. Zgłoszenie
  wymaga akceptacji, więc trzeba poczekać. Do tego czasu wydania bez podpisu, a SmartScreen
  pokazuje „Więcej informacji → Uruchom mimo to”.
- **macOS: podpis ad-hoc** (na Apple Silicon i tak obowiązkowy). Bez notaryzacji, bo ta wymaga
  płatnego konta.

### Etap 4: testy

- Windows: VM bez aktywacji (znak wodny) albo 90-dniowa wersja ewaluacyjna. Sprawdzić:
  ConPTY, polecenia `.cmd`, named pipe, ścieżki ze spacjami i polskimi znakami, SmartScreen.
- macOS: tylko CI i testerzy z Macami (legalnie macOS działa tylko na sprzęcie Apple).
  Dlatego wydanie na Maca jest oznaczone jako **beta**.

### Etap 5: wydanie i aktualizacje

- GitHub Releases jako źródło wszystkiego.
- Windows: `electron-updater` (działa też bez podpisu). Później można dodać Scoop / winget.
- macOS: `electron-updater` nie zadziała (Squirrel.Mac wymaga prawdziwego podpisu).
  Zamiast tego sprawdzanie GitHub API przy starcie, komunikat „Jest nowa wersja” i link do strony wydania.
- README: wymagania na każdy system (skąd `claude`, `codex`, `pi`, `git`, `rg`, `piper`)
  i instrukcja pierwszego uruchomienia na Macu:
  Ustawienia systemowe → Prywatność i ochrona → „Otwórz mimo to”
  albo `xattr -dr com.apple.quarantine /Applications/Roost.app`.

## Zagrożenia

1. **Bez płatnego podpisu Mac zawsze odstrasza.** Gatekeeper blokuje pierwsze uruchomienie,
   a w nowszych macOS samo „Otwórz” z menu kontekstowego już nie wystarcza.
   Homebrew wycofuje niepodpisane aplikacje z oficjalnego repozytorium. Na własny tap też
   nie ma co liczyć.
2. **Zgody bota na Windows to ryzyko bezpieczeństwa.** `commandPrefix` i reguły zgód
   zakładają składnię sh. W PowerShellu ten sam prefiks znaczy co innego. Bez nowego
   projektu reguł wolę wyłączyć narzędzie `bash` na Windows, niż je przepuścić.
3. **Sekrety na Windows bez `chmod`.** DPAPI szyfruje klucze API, ale `accounts.json`
   i `web-search.json` leżą otwartym tekstem w profilu. Do oceny, czy to wystarczy.
4. **Keychain i podpis ad-hoc na Macu.** Dostęp do klucza „Roost Safe Storage” jest przypisany do
   podpisu, a ten zmienia się przy każdym buildzie. Po aktualizacji macOS zapyta o dostęp
   albo odszyfrowanie się nie uda. Aplikacja musi to przeżyć: komunikat i prośba o ponowne
   wpisanie klucza zamiast awarii. To samo dotyczy zgody na mikrofon.
5. **Zewnętrzne CLI zachowują się inaczej.** Ścieżki sesji w `~/.claude/projects` z `C:\`
   w nazwie projektu mogą być kodowane inaczej. Parsery w `context.ts`, `handoff.ts`,
   `usage-logs.ts` mogą po cichu nie znaleźć sesji. Potrzebne fikstury z Windows.
6. **`node-pty` i moduły natywne:** osobny build na każdą architekturę i wersję
   Electrona. Na Macu dłuższy CI i większa paczka.
7. **Brak sprzętu.** Błędy na Macu debugowane na ślepo przez CI. Moim zdaniem największe ryzyko praktyczne.
8. **Utrzymanie:** każda funkcja to od teraz trzy systemy. Bez macierzy CI regresje
   wyjdą dopiero u użytkowników.
9. **GPL-3.0 a sklepy:** Mac App Store i Microsoft Store kłócą się z GPL, a poza tym
   są płatne. Zostają GitHub Releases, Scoop i winget.

## Szacunek

- Windows (Etap 1 w pełnej wersji + pakowanie + SignPath): około **2–4 tygodnie** plus
  czas oczekiwania na akceptację SignPath.
- macOS beta (część „unixowa” Etapu 1 + dmg ad-hoc + sprawdzanie aktualizacji): około **1–2 tygodnie**.

## Pierwszy krok

Wydzielić `platform.ts` i dodać CI z macierzą. To nic nie zmienia na Linuksie,
a od razu pokazuje, które testy padają na Windows i Macu.
