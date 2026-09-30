# Plan M1 – wersja podstawowa (dla lokalnego agenta)

Wykonawca: pi z modelem Swift Flash Next (kontekst 260k). Zasady pracy: `AGENTS.md`.
Jeden etap = jedna sesja = jeden commit.

## Postęp

- [x] Etap 1 – testy i rdzeń PTY bez Tauri
- [x] Etap 2 – warstwa backendu i tryb podglądu w przeglądarce
- [x] Etap 3 – konfiguracja agentów i argumenty sesji
- [ ] Etap 4 – model workspace'u (czyste funkcje)
- [ ] Etap 5 – szyna projektów i siatka paneli
- [ ] Etap 6 – dodawanie projektu i panelu
- [ ] Etap 7 – zapis i wznawianie
- [ ] Etap 8 – skróty klawiszowe i schowek
- [ ] Etap 9 – aktywność i powiadomienia
- [ ] Etap 10 – presety
- [ ] Etap 11 – porządki, README, lista do sprawdzenia przez użytkownika

## Kontekst

Stan po M0 (commit `d2a5496`):

```
src-tauri/src/lib.rs    set_webview_env (NIE ruszać), run(): rejestr Ptys, komendy, kill_all przy wyjściu
src-tauri/src/pty.rs    pty_spawn/write/resize/kill; wyjście przez Channel<InvokeResponseBody::Raw>,
                        wyjście procesu przez Channel<ExitInfo>; grupa procesów = pid (setsid)
src/pty.ts              spawnPty(spec, onData, onExit) -> PtyHandle
src/Terminal.tsx        xterm.js + FitAddon + Unicode11; proces żyje tyle, co komponent
src/App.tsx             jeden terminal, wybór agenta i katalogu
```

Wersje: tauri 2.12 (crate), `@tauri-apps/api` 2.12, xterm 6, React 19, Vite 8, TS 7.
Port dev: 5183.

Fakty o agentach (sprawdzone 2026-09-30):
- `claude --session-id <uuid>` zaczyna rozmowę o tym id; `claude --resume <uuid>` wznawia.
  Pliki rozmów: `~/.claude/projects/<katalog>/<uuid>.jsonl` (nazwa katalogu to zakodowana
  ścieżka – nie odtwarzaj jej, szukaj `<uuid>.jsonl` we wszystkich podkatalogach).
  Claude tworzy plik dopiero po pierwszej wiadomości.
- `pi --session-id <id>` – „creating it if missing”, więc to samo polecenie tworzy i wznawia.

## Decyzje (nie zmieniaj ich)

- **Praca jest pogrupowana według projektów** (jak tryb Code w BridgeMind One). Projekt =
  folder na dysku. Po lewej szyna z listą projektów, pod każdym jego panele ze stanem.
  Po prawej siatka paneli aktywnego projektu. Każdy panel pracuje w folderze swojego projektu.
- Przełączenie projektu **nie zatrzymuje procesów**: siatki wszystkich projektów są
  zamontowane, nieaktywne mają `display: none`.
- Układ siatki automatyczny: `cols = ceil(sqrt(n))`, `rows = ceil(n / cols)`. Maks. 16 paneli
  na projekt. Ręcznej zmiany proporcji nie ma w M1.
- Panele renderowane jako **płaska lista** dzieci jednego kontenera z `display: grid`.
  Klucz Reacta = `${pane.id}:${pane.run}`. Zmiana układu, maksymalizacja i fokus nie mogą
  odmontować `Terminal` (odmontowanie zabija proces). Maksymalizacja = pozostałe panele
  dostają `display: none`, nie są usuwane.
- Stan trwały (workspace) zapisywany w całości przy każdej zmianie, bez debounce – zmiany
  są rzadkie. Stan ulotny (proces żyje/zakończony, aktywność, nieprzeczytane) nigdy nie
  trafia do pliku.
- Zamknięcie panelu z działającym procesem: dwuklik – pierwsze kliknięcie zmienia przycisk
  na „Na pewno?” na 3 s. Żadnych `window.confirm`.
- Każde wywołanie backendu idzie przez `src/backend.ts` (etap 2). Komponenty nie importują
  `@tauri-apps/*` bezpośrednio.

---

## Etap 1 – testy i rdzeń PTY bez Tauri

**Cel:** vitest w projekcie; logika PTY w Rust testowalna bez okna.

Kroki:
1. `pnpm add -D vitest@^5.0.3`. W `package.json` skrypt `"test": "vitest run"`.
   `vitest.config.ts`: `environment: "node"`, `include: ["src/**/*.test.ts"]`.
2. Pierwszy test `src/smoke.test.ts` (`expect(1 + 1).toBe(2)`) – potem zostaje usunięty
   w etapie 3, gdy są prawdziwe testy.
3. W `src-tauri/src/pty.rs` wydziel z `pty_spawn` metodę:
   ```rust
   impl Ptys {
       pub fn spawn(
           &self,
           spec: SpawnSpec,
           on_data: Box<dyn FnMut(&[u8]) -> bool + Send>,   // false = przestań czytać
           on_exit: Box<dyn FnOnce(ExitInfo) + Send>,
       ) -> Result<u32, String>
       pub fn write(&self, id: u32, data: &[u8]) -> Result<(), String>
       pub fn resize(&self, id: u32, cols: u16, rows: u16) -> Result<(), String>
       pub fn kill(&self, id: u32)
       pub fn pid(&self, id: u32) -> Option<u32>
   }
   ```
   Komendy `#[tauri::command]` stają się cienkimi opakowaniami (Channel → closure).
   Zachowanie ma zostać identyczne. `SpawnSpec` i `ExitInfo` dostają `Debug`,
   pola `SpawnSpec` `pub`, plus pole `env: Vec<(String, String)>` z `#[serde(default)]`
   (przyda się w testach i później).
4. Testy w `pty.rs` (`#[cfg(test)]`), każdy z limitem czasu (czekaj na `mpsc::Receiver`
   z `recv_timeout(Duration::from_secs(5))`):
   - `sh -c 'printf hello; exit 3'` → dane zawierają `hello`, `ExitInfo.code == 3`.
   - `cwd: Some("/tmp")` + `sh -c pwd` → wyjście zawiera `/tmp`.
   - `sh -c 'sleep 30 & sleep 30'`, potem `kill(id)` → `on_exit` przychodzi w < 3 s
     i `libc::kill(-pid, 0)` zwraca -1 (grupy nie ma).
   - `write(id, b"abc\n")` do `cat` → echo `abc` w danych.

**Gotowe gdy:** `pnpm test` i `cargo test --lib` przechodzą, `cargo build` bez ostrzeżeń.
**Commit:** `Etap 1: vitest, rdzeń PTY z testami`

---

## Etap 2 – warstwa backendu i tryb podglądu w przeglądarce

**Cel:** jeden moduł dla wszystkich wywołań backendu; w zwykłej przeglądarce (`pnpm dev`)
aplikacja działa z udawanym backendem, żeby dało się oglądać UI bez okna Tauri.

Kroki:
1. `src/backend.ts` eksportuje interfejs i wybraną implementację:
   ```ts
   export interface Backend {
     spawnPty(spec: SpawnSpec, onData: (b: Uint8Array) => void, onExit: (i: ExitInfo) => void): Promise<PtyHandle>;
   }
   export const inTauri = "__TAURI_INTERNALS__" in window;
   export const backend: Backend = inTauri ? tauriBackend : mockBackend;
   ```
   Kolejne etapy dopisują metody do tego interfejsu i do obu implementacji.
2. `src/backend-tauri.ts` = obecna zawartość `src/pty.ts` (plik `pty.ts` usuń, importy popraw).
3. `src/backend-mock.ts`: udawany terminal. Po starcie wypisuje
   `\x1b[33m[podgląd]\x1b[0m <command> <args> w <cwd>\r\n$ `, odbija wpisywane znaki
   (Enter → `\r\n$ `), `kill()` → po 100 ms `onExit({code: 0, signal: null})`.
   Polecenie `exit` + Enter kończy z kodem 0, `fail` + Enter z kodem 1 (do testów UI).
4. W trybie mock w rogu okna mały napis „podgląd – bez prawdziwych procesów”.
5. `Terminal.tsx` używa `backend.spawnPty`.

**Sprawdzenie ręczne:** `pnpm dev` w tle, otwórz `http://localhost:5183` narzędziem do
oglądania stron, zobacz terminal z napisem `[podgląd]`. Zakończ `pnpm dev` po PID.
**Gotowe gdy:** sprawdzenia z `AGENTS.md` + zrzut podglądu opisany w HANDOFF.
**Commit:** `Etap 2: warstwa backendu, tryb podglądu w przeglądarce`

---

## Etap 3 – konfiguracja agentów i argumenty sesji

**Cel:** lista agentów z pliku JSON; budowanie argumentów nowej i wznawianej rozmowy.

Typy w `src/agents.ts`:
```ts
export type AgentDef = {
  id: string;
  name: string;
  command: string;            // "$SHELL" rozwija Rust
  args?: string[];
  session?: {
    new: string[];            // "{session}" zastępowane id
    resume: string[];
    check?: "claude";         // skąd wiedzieć, czy rozmowa istnieje; brak = zawsze "new"
  };
};

export const DEFAULT_AGENTS: AgentDef[] = [
  { id: "claude", name: "Claude", command: "claude",
    session: { new: ["--session-id", "{session}"], resume: ["--resume", "{session}"], check: "claude" } },
  { id: "pi", name: "pi", command: "pi",
    session: { new: ["--session-id", "{session}"], resume: ["--session-id", "{session}"] } },
  { id: "shell", name: "Terminal", command: "$SHELL" },
];

export function parseAgents(raw: unknown): { agents: AgentDef[]; errors: string[] };
export function buildArgs(agent: AgentDef, sessionId: string | undefined, exists: boolean): string[];
```
- `parseAgents`: przyjmuje `{agents: [...]}`; pomija wpisy bez `id`/`name`/`command`
  albo z powtórzonym `id` i opisuje każdy pominięty w `errors`. Pusta lista → `DEFAULT_AGENTS`
  + błąd.
- `buildArgs`: `[...args, ...(exists ? resume : new)]` z podmianą `{session}`; bez `session`
  albo bez `sessionId` → same `args`.

Rust (`src-tauri/src/config.rs`, nowy moduł):
- `agents_load(app) -> Result<String, String>`: plik `app_config_dir()/agents.json`
  (`~/.config/dev.majke.agents/agents.json`). Brak pliku → zapisz domyślny
  (tę samą listę co `DEFAULT_AGENTS`, sformatowaną, jako `{"agents": [...]}`) i zwróć go.
  Zwraca surowy tekst; parsuje TS. Uszkodzonego pliku **nie nadpisuj**.
- `claude_session_exists(id: String) -> bool`: czy istnieje `~/.claude/projects/*/<id>.jsonl`.
  Odrzuć id, które nie jest UUID (znaki poza `[0-9a-f-]`) – zwróć false.
- `dir_exists(path: String) -> bool` (z rozwinięciem `~`; użyj `expand` z `pty.rs`,
  zrób je `pub(crate)`).
- Zapisy plików: najpierw `plik.tmp`, potem `rename` (funkcja `write_atomic` w `config.rs`).
- Testy Rust: `claude_session_exists` na katalogu tymczasowym – wydziel
  `session_exists_in(root: &Path, id: &str)`; odrzucenie `../x`; `write_atomic`.

Backend: `loadAgents(): Promise<{agents, errors}>`, `claudeSessionExists(id)`, `dirExists(path)`.
Mock: `DEFAULT_AGENTS`, `false`, `true`.

Testy vitest `src/agents.test.ts`: `buildArgs` dla claude nowy/wznowiony, pi, shell,
brak sessionId; `parseAgents` z duplikatem, z brakującym polem, z pustą listą.
Usuń `src/smoke.test.ts`.

`App.tsx`: lista agentów z `loadAgents()`; błędy konfiguracji pokazane jako pasek na górze.

**Commit:** `Etap 3: konfiguracja agentów, argumenty sesji`

---

## Etap 4 – model workspace'u (czyste funkcje)

**Cel:** cały stan układu i operacje na nim w jednym pliku bez Reacta, z testami.

`src/workspace.ts`:
```ts
export const MAX_PANES = 16;   // na projekt

export type Pane = {
  id: string;          // crypto.randomUUID()
  agentId: string;
  sessionId?: string;  // tylko gdy agent ma `session`; crypto.randomUUID()
  run: number;         // zwiększane przy restarcie → nowy klucz Reacta
};
export type Project = {
  id: string;          // crypto.randomUUID()
  name: string;        // domyślnie ostatni człon ścieżki
  path: string;        // folder; cwd każdego panelu
  panes: Pane[];
  focused: string | null;
  maximized: string | null;
};
export type Preset = { name: string; agents: string[] };   // etap 10
export type Workspace = {
  version: 1;
  projects: Project[];
  active: string | null;   // id aktywnego projektu
  presets: Preset[];
};

export const emptyWorkspace: Workspace;
export function gridShape(n: number): { cols: number; rows: number };  // n=0 → {0,0}
export type Dir = "left" | "right" | "up" | "down";
export function neighbor(index: number, dir: Dir, n: number): number;  // brak sąsiada → index
export function activeProject(ws: Workspace): Project | null;
export function projectName(path: string): string;   // "/a/b/" → "b", "~" → "~"

export type Action =
  | { type: "addProject"; project: Project }  // ta sama ścieżka już jest → tylko ją aktywuj
  | { type: "removeProject"; id: string }     // aktywny → następny albo poprzedni albo null
  | { type: "selectProject"; id: string }
  | { type: "renameProject"; id: string; name: string }
  // Akcje paneli działają na aktywnym projekcie; bez aktywnego nic nie zmieniają.
  | { type: "add"; pane: Pane }              // ignoruje, gdy już MAX_PANES; ustawia fokus na nowy
  | { type: "close"; id: string }            // fokus → sąsiad o tym samym indeksie albo poprzedni
  | { type: "restart"; id: string }          // run + 1
  | { type: "newConversation"; id: string; sessionId: string }  // run + 1
  | { type: "focus"; id: string }            // szuka panelu we wszystkich projektach i aktywuje jego projekt
  | { type: "move"; dir: Dir }               // fokus na sąsiada w siatce
  | { type: "toggleMaximize"; id?: string }  // bez id = panel z fokusem
  | { type: "load"; workspace: Workspace };
export function reduce(ws: Workspace, action: Action): Workspace;

export function parseWorkspace(raw: unknown, agentIds: string[]): { workspace: Workspace; errors: string[] };
```
- `neighbor`: siatka z `gridShape(n)`, wiersz = `floor(i / cols)`. W dół do pustej komórki
  ostatniego wiersza → ostatni panel. Poza siatkę → bez zmiany.
- `close` maksymalizowanego panelu zdejmuje maksymalizację.
- Nowe id (`crypto.randomUUID()`) tworzy wywołujący i podaje je w akcji – `reduce` jest
  deterministyczny i nie woła `randomUUID` ani `Date.now`.
- `parseWorkspace`: nieznana wersja → pusty + błąd; panele z nieznanym `agentId` usunięte
  (błąd z nazwą); więcej niż 16 paneli w projekcie → obcięte; dwa projekty z tą samą
  ścieżką → zostaje pierwszy; brakujące pola uzupełnione; `active`/`focused`/`maximized`
  wskazujące nieistniejący element → pierwszy projekt / `null` / `null`.
- `reduce` nigdy nie mutuje wejścia (test: głębokie `Object.freeze` na wejściu).

Testy `src/workspace.test.ts`: `gridShape` dla 0,1,2,3,4,5,7,9,10,16; `neighbor` na 3
(dziura w siatce) i 5 panelach we wszystkich kierunkach; każda akcja; `focus` panelu
z innego projektu przełącza projekt; `addProject` z istniejącą ścieżką; `projectName`;
`parseWorkspace` dla śmieci (`null`, `"x"`, `{version: 2}`), nieznanego agenta, 20 paneli,
duplikatu ścieżki.

**Commit:** `Etap 4: model workspace'u z testami`

---

## Etap 5 – szyna projektów i siatka paneli

**Cel:** UI na modelu z etapu 4. Po tym etapie aplikacja startuje pusta. „+ Projekt” na razie
dodaje projekt `~` (wybór folderu jest w etapie 6), „+ Panel” dodaje panel Claude'a
(wybór agenta też w etapie 6).

Układ okna: szyna projektów po lewej (220 px), obok obszar siatek. Bez paska górnego –
przyciski „+ Panel” i licznik `n/16` są w nagłówku obszaru siatki (nazwa i ścieżka
aktywnego projektu po lewej, przyciski po prawej).

Pliki:
- `src/App.tsx`: `useReducer(reduce, emptyWorkspace)`; stan ulotny osobno:
  `Record<paneId, { exited?: ExitInfo }>` (etap 9 dopisze tu aktywność).
- `src/Rail.tsx`: nagłówek „Projekty” + przycisk „+”. Wiersz projektu: nazwa, liczba
  paneli; aktywny podświetlony; klik → `selectProject`. Pod **każdym** projektem (nie tylko
  aktywnym) wcięta lista jego paneli: kropka stanu + nazwa agenta; klik → `focus` (przełącza
  projekt). Ikona ✕ przy projekcie po najechaniu – dwuklik jak przy panelu; usunięcie
  projektu zamyka jego panele (procesy giną przez odmontowanie).
  Dwuklik na nazwie projektu → pole edycji (Enter zapisuje `renameProject`, Esc anuluje).
- `src/Grid.tsx`: jedna siatka na projekt; **wszystkie projekty renderowane**, nieaktywne
  z `display: none`. Kontener `display: grid`, `grid-template-columns: repeat(cols, 1fr)`,
  `grid-template-rows: repeat(rows, 1fr)`, odstęp 4 px. Przy maksymalizacji: jedna
  kolumna i wiersz, pozostałe panele `display: none`. Projekt bez paneli → środek:
  „Brak paneli” + przycisk „+ Panel”. Brak projektów → środek: „Dodaj folder projektu” +
  przycisk.
- `src/Pane.tsx`: ramka (1 px; z fokusem kolor `--accent`), nagłówek 26 px: nazwa agenta,
  kropka stanu (zielona – działa, szara – zakończony z kodem w `title`), przyciski:
  ⟳ restart, ⤢ maksymalizuj, ✕ zamknij (dwuklik – patrz „Decyzje”). Klik gdziekolwiek
  w panelu → `focus`.
- Przed zamontowaniem `Terminal` panel liczy argumenty: dla `check: "claude"` pyta
  `backend.claudeSessionExists(sessionId)`, potem `buildArgs`. Do czasu odpowiedzi
  pokazuje pusty panel. `cwd` = `project.path`.
- `src/Terminal.tsx`: efekt z pustą listą zależności (proces zależy tylko od klucza),
  props `command, args, cwd, focused, onExit, onFocus`. Gdy `focused` zmieni się na true →
  `term.focus()`. `onFocus` z `term.textarea` (zdarzenie `focus`).

**Sprawdzenie ręczne (podgląd):** dwa projekty; w pierwszym 1, 3, 5 paneli – zrzut;
maksymalizuj i przywróć drugi panel – tekst w nim nadal jest (proces nie zrestartował
się); przełącz na drugi projekt i z powrotem – terminale pierwszego mają dalej swój tekst;
klik panelu na szynie przełącza projekt; zamknij środkowy panel.
**Commit:** `Etap 5: szyna projektów i siatka paneli`

---

## Etap 6 – dodawanie projektu i panelu

**Cel:** wybór folderu projektu i agenta.

Zależności (dokładnie te wersje):
- `pnpm add @tauri-apps/plugin-dialog@~2.8.0`
- w `src-tauri/Cargo.toml`: `tauri-plugin-dialog = "~2.8"`; w `lib.rs`
  `.plugin(tauri_plugin_dialog::init())`; w `capabilities/default.json` `"dialog:allow-open"`.
- Po dodaniu sprawdź: `grep -A1 '^name = "tauri"$' src-tauri/Cargo.lock` nadal `2.12.x`.

Projekt:
- „+” na szynie → `backend.pickDir()` (dialog `open({directory: true})`; mock → `prompt()`
  przeglądarki). Anulowanie = nic. Wynik → `backend.dirExists` → `addProject`
  z `projectName(path)`.
- Ścieżki zapisywane z `~` zamiast katalogu domowego (funkcja `tildify(path, home)`
  w `src/paths.ts` + test; `home` z nowej komendy Rust `home_dir()`, mock → `/home/podglad`).

Panel – `src/NewPaneDialog.tsx` (nakładka na środku, Esc zamyka):
- Nagłówek: „Nowy panel w <nazwa projektu>”.
- Agenci jako kafelki z numerem; klawisz 1–9 albo klik od razu dodaje panel i zamyka okno.
  Strzałki + Enter też działają. Zaznaczony na starcie: ostatnio użyty agent (zapamiętany
  w stanie ulotnym App, nie w pliku).
- Bez aktywnego projektu przycisk „+ Panel” jest wyłączony.

**Commit:** `Etap 6: dodawanie projektu i panelu`

---

## Etap 7 – zapis i wznawianie

**Cel:** po zamknięciu i ponownym otwarciu aplikacji wracają te same projekty i panele
z tymi samymi rozmowami.

Rust (`config.rs`): `workspace_load() -> Option<String>` (plik
`app_config_dir()/workspace.json`), `workspace_save(json: String)` przez `write_atomic`.
Gdy `parseWorkspace` zwróci błędy, TS woła `workspace_backup()`: Rust kopiuje plik do
`workspace.<RRRR-MM-DD>.bak` obok; jeśli ten plik już istnieje, nie nadpisuje go.
Dopiero potem pierwszy zapis może nadpisać `workspace.json`.

TS:
- Start: `loadAgents()` → `workspace_load()` → `parseWorkspace` → `reduce({type: "load"})`.
  Do końca ładowania zamiast siatki napis „Wczytywanie…”.
- `useEffect` na zmianę `workspace` (po wczytaniu, nie wcześniej – inaczej pusty stan
  nadpisze plik) → `workspace_save(JSON.stringify(ws, null, 2))`.
- Mock: `localStorage` (w try/catch).
- Wznowienie działa już dzięki etapowi 5 (sprawdzenie istnienia + `resume`). Przycisk
  w nagłówku panelu „Nowa rozmowa” (ikona +) → `newConversation`.

Testy vitest: przejście `Workspace → JSON → parseWorkspace` daje to samo.
Test Rust: `write_atomic` nie zostawia `.tmp`.

**Ręcznie (użytkownik, wypisz w HANDOFF):** dwa projekty, w jednym panele claude + pi, po jednej wiadomości
w każdym, zamknij aplikację, otwórz – obie rozmowy są na miejscu.
**Commit:** `Etap 7: zapis układu i wznawianie rozmów`

---

## Etap 8 – skróty klawiszowe i schowek

Zależności: `pnpm add @tauri-apps/plugin-clipboard-manager@~2.4.0`,
`tauri-plugin-clipboard-manager = "~2.4"`, plugin w `lib.rs`, uprawnienia
`"clipboard-manager:allow-read-text"`, `"clipboard-manager:allow-write-text"`.
Znów sprawdź wersję `tauri` w `Cargo.lock`.

`src/keys.ts`:
```ts
export type Command =
  | { type: "move"; dir: Dir } | { type: "toggleMaximize" } | { type: "newPane" }
  | { type: "closePane" } | { type: "restartPane" } | { type: "copy" } | { type: "paste" }
  | { type: "selectProject"; index: number } | { type: "newProject" };
export function commandFor(e: Pick<KeyboardEvent, "key" | "ctrlKey" | "altKey" | "shiftKey" | "metaKey">): Command | null;
```
| Skrót | Komenda |
|---|---|
| Ctrl+Alt+←/→/↑/↓ | `move` |
| Ctrl+Alt+Enter | `toggleMaximize` |
| Ctrl+Alt+N | `newPane` |
| Ctrl+Alt+W | `closePane` (panel z działającym procesem: jak dwuklik – drugi raz w ciągu 3 s) |
| Ctrl+Alt+R | `restartPane` |
| Ctrl+Alt+1…9 | `selectProject` (numer na szynie; poza zakresem nic) |
| Ctrl+Alt+P | `newProject` (wybór folderu) |
| Ctrl+Shift+C | `copy` (zaznaczenie w terminalu z fokusem) |
| Ctrl+Shift+V | `paste` (tekst ze schowka → `term.paste()`) |

- Litery porównuj bez względu na wielkość (`e.key.toLowerCase()`).
- W `Terminal.tsx`: `term.attachCustomKeyEventHandler(e => commandFor(e) === null)` – xterm
  nie dostaje naszych skrótów. W `App.tsx` jeden `keydown` na `window` w fazie capture,
  `preventDefault()` dla rozpoznanych.
- **Ctrl+V zostaje dla terminala** (claude wkleja nim obrazki). Ctrl+C bez Shift idzie do
  procesu.
- Terminal musi wystawić rodzicowi `copy()`/`paste(text)` – przez `useImperativeHandle`.

Testy `src/keys.test.ts`: każdy skrót, Ctrl+C i Ctrl+V → `null`, wielkie litery,
Alt bez Ctrl → `null`, Ctrl+Alt+0 → `null`.
Numery projektów (1–9) pokaż na szynie jako małe etykiety przy nazwie.
**Commit:** `Etap 8: skróty klawiszowe i schowek`

---

## Etap 9 – aktywność i powiadomienia

**Cel:** widać, który panel pracuje, a gdy panel bez fokusu skończy pracę, przychodzi
powiadomienie.

`src/activity.ts` (czyste funkcje, czas przekazywany z zewnątrz):
```ts
export type Activity = { lastOutput: number; burstStart: number | null; quietUntil: number };
export const initialActivity: Activity;
export function onOutput(a: Activity, now: number): Activity;          // ignoruje, gdy now < quietUntil
export function onResize(a: Activity, now: number): Activity;          // quietUntil = now + 500 (przerysowanie to nie praca)
export function tick(a: Activity, now: number): { activity: Activity; working: boolean; finished: boolean };
```
- `working` = ostatnie wyjście < 2000 ms temu.
- `finished` = przejście z pracy w ciszę, gdy seria (`burstStart` → `lastOutput`) trwała
  ≥ 3000 ms. Jednorazowe – po zgłoszeniu `burstStart = null`.
- Seria zaczyna się przy pierwszym wyjściu po ≥ 2000 ms ciszy.

UI:
- `App.tsx`: `setInterval` 1 s → `tick` dla każdego panelu. Stan ulotny panelu dostaje
  `working` i `unread` (wyjście, gdy panel nie ma fokusu; zerowane przy fokusie).
- Nagłówek panelu **i wiersz panelu na szynie**: animowana kropka przy `working`; kropka
  akcentowa przy `unread`. Wiersz projektu na szynie: kropka akcentowa, gdy któryś jego
  panel ma `unread` – tak widać pracę w projektach, których siatka jest schowana.
- Powiadomienie przy `finished`, gdy panel nie ma fokusu **albo** okno nie ma fokusu
  (`document.hasFocus()`): tytuł `Agents: <agent>`, treść `skończył pracę w <nazwa projektu>`.
- Rust: komenda `notify(title, body)` → `notify-send -a Agents <title> <body>` (proces
  w tle, błąd tylko do logu). Mock: `console.info`.

Testy `src/activity.test.ts`: krótka seria (1 s) → brak `finished`; długa (5 s) → dokładnie
jeden `finished`; wyjście w oknie po `onResize` nie liczy się; `working` gaśnie po 2 s.
**Commit:** `Etap 9: aktywność paneli i powiadomienia`

---

## Etap 10 – presety

- Wbudowane (nie w pliku, stała w `src/presets.ts`): „Claude + pi” (`claude, pi`),
  „2× Claude + 2× pi”, „4× Claude”.
- Własne w `workspace.presets`; akcje `savePreset {name}` (z obecnych paneli, w ich
  kolejności; ta sama nazwa nadpisuje) i `deletePreset {name}` w `reduce` + testy.
- W nagłówku obszaru siatki przycisk „Presety” → menu: lista (wbudowane, kreska, własne
  z ✕), „Zapisz obecny układ…” (pole na nazwę). Wybór presetu dodaje panele na koniec
  aktywnego projektu, maks. do 16 (komunikat, ile się nie zmieściło).
- W pustym projekcie (ekran „Brak paneli”) presety wbudowane jako przyciski obok „+ Panel”.
- Agenci z presetu, których nie ma w konfiguracji, są pomijani z komunikatem.
**Commit:** `Etap 10: presety`

---

## Etap 11 – porządki i lista dla użytkownika

1. Scrollback 3000 linii. Panel z `display: none` nie wywołuje `fit()` (sprawdzenie
   `clientWidth === 0` już jest – upewnij się, że działa po maksymalizacji).
2. `README.md`: co to jest, uruchomienie (`pnpm install`, `pnpm desktop`), plik
   `agents.json` z przykładem dodania agenta (np. `codex`), skróty klawiszowe.
3. W `HANDOFF.md` sekcja „Do sprawdzenia przez użytkownika” (w oknie Tauri):
   - [ ] TUI claude i pi: kolory, ramki, polskie znaki (ąęśćżźół), Shift+Tab, Esc, Ctrl+C
   - [ ] zmiana rozmiaru okna i maksymalizacja przerysowuje terminale poprawnie
   - [ ] Ctrl+Shift+C/V, Ctrl+V z obrazkiem w claude
   - [ ] 16 paneli z `$SHELL`, w każdym `yes | head -c 20M` – okno reaguje, czas zapisany
   - [ ] zamknięcie aplikacji: `pgrep -a claude; pgrep -a pi` nie pokazują procesów z paneli
   - [ ] restart aplikacji wznawia rozmowy (claude i pi)
   - [ ] przełączanie projektów nie przerywa pracy agentów w schowanych siatkach
   - [ ] powiadomienie po zakończeniu pracy agenta w panelu bez fokusu
4. W `PLAN.md` zaznacz M1 jako zrobione (czeka na sprawdzenie użytkownika).
**Commit:** `Etap 11: porządki, README, lista sprawdzeń`

---

## Poza M1 (nie rób)

Status przez `pi --mode rpc` / `claude -p --output-format stream-json`, pasek poleceń
(prompt do aktywnego panelu / do wielu), przeciągnięcie pliku na terminal wstawia ścieżkę,
szukanie w terminalu, panel przeglądarki, panel plików, panel „wątku” (rozmowa zamiast TUI),
kanban, git worktree, serwer MCP, ręczne proporcje i przeciąganie paneli, codex/omp/hermes.
