# Plan – panel plików z gitem

Dopisane 2026-10-01 z pozycji „Panel plików z gitem” w `PLAN.md`. Niezależne od M5.
Łączy się z pozycją „Kanban + worktree + diff” (diff i operacje na repozytorium będą
wspólne), ale worktree i Kanban są **poza tym planem**.

Co ma działać po tym planie:
1. Przycisk „Pliki” w nagłówku obszaru otwiera panel po prawej: drzewo plików projektu
   (z `.gitignore`) ze statusem gita przy plikach i katalogach.
2. Klik w plik pokazuje jego diff (staged / niezatwierdzony / nowy plik).
3. Stage, unstage i discard na pliku. **Discard tylko po potwierdzeniu** (dwa kliknięcia,
   jak zamykanie panelu), także dla plików nieśledzonych.
4. Komunikat + „Zatwierdź” = `git commit` z tego, co jest w indeksie.
5. Chip brancha z ahead/behind (`↑2 ↓1`), przyciski pull (tylko fast-forward) i push.

## Decyzje

- **Git przez `spawn` z tablicą argumentów, bez powłoki.** Ścieżki zawsze po `--`.
  Ścieżki od UI są względne, bez `..`, bez NUL (`validRelPath`); katalog repozytorium to
  ścieżka projektu. Komunikat commitu idzie przez stdin (`commit -F -`), nie w argumencie.
- **Parsowanie to czyste funkcje w `src/git.ts`**: `git status --porcelain=v2 -z --branch -uall`
  (wpisy zwykłe, przeniesione z drugą ścieżką, nieskomitowane konflikty, nieśledzone),
  diff w linie z numerami, lista ścieżek → drzewo. Testy na fixture'ach tekstowych.
  Proces główny tylko uruchamia git i zwraca sparsowane dane; test integracyjny na prawdziwym
  repozytorium w katalogu tymczasowym (`electron/src/git.test.ts`).
- **Drzewo z `git ls-files --cached --others --exclude-standard`**, nie z odczytu katalogów:
  szanuje `.gitignore`, jedno wywołanie. Limit 50 000 ścieżek. Katalog bez repozytorium =
  komunikat „To nie repozytorium git” (bez drzewa).
- **Środowisko git:** `GIT_TERMINAL_PROMPT=0`, `LC_ALL=C`, `GIT_SSH_COMMAND` z `BatchMode=yes`
  (gdy nie ustawione), `--no-optional-locks` dla `status` (odświeżanie w tle nie blokuje
  indeksu agentowi). Limit czasu: 15 s lokalnie, 90 s pull/push. Wyjście diffu ≤ 1 MB.
- **Operacje destrukcyjne:**
  - discard zmiany śledzonego pliku = `git restore --worktree -- ścieżka` (indeks zostaje);
  - discard pliku nieśledzonego = `git clean -f -- ścieżka` (tylko wskazane pliki);
  - brak `reset --hard`, `clean -fd` na całości, `push --force`, `checkout` brancha;
  - pull tylko `--ff-only`; push bez `--force`; branch bez upstreamu = `push -u origin HEAD`
    (przycisk podpisany „Opublikuj”).
  - Potwierdzenie wymusza UI (`confirmClick` z `confirm.ts`). Backend przyjmuje oddzielne
    listy „śledzone” i „nieśledzone” i sprawdza, że nic nie jest poza repozytorium.
- **Odświeżanie:** przy otwarciu, po każdej operacji, przy fokusie okna i co 5 s, gdy panel
  jest otwarty i okno widoczne. Bez watchera plików (to etap 6).
- **Stan panelu** (otwarty, wybrany plik, rozwinięte katalogi) trzymany w komponencie, nie
  w `workspace.json` – schemat zapisu bez zmian.
- Tryb podglądu (`pnpm dev`): mock zwraca stały mały „repozytorium” z kilkoma zmianami
  (operacje zmieniają stan w pamięci), żeby panel dało się obejrzeć bez okna.

## Postęp

- [x] Etap 1 (L) – parsery i czyste funkcje: `src/git.ts` + testy
- [x] Etap 2 (L) – backend git: uruchamianie, IPC, mock, test integracyjny
- [x] Etap 3 (C) – panel: drzewo, diff, stage/unstage/discard, commit
- [x] Etap 4 (C) – chip brancha z ahead/behind, pull/push
- [ ] Etap 5 (C + użytkownik) – sprawdzenie w oknie na prawdziwym repozytorium
- [ ] Etap 6 (L) – stage pojedynczych hunków (`git apply --cached`), watcher zamiast sondowania
- [ ] Etap 7 (C) – diff w widoku obok siebie, historia pliku, przełączanie branchy
- [ ] Etap 8 (C) – worktree per agent/zadanie i Kanban (osobny plan)

Etapy 1–4 zostały zrobione w jednej sesji na prośbę użytkownika (wyjątek od „jeden etap na
sesję”). Brak commitów – zmiany leżą w drzewie roboczym do przeglądu.

---

## Etap 1 (L) – parsery i czyste funkcje

`src/git.ts` (+ `src/git.test.ts`):
- `parseStatus(raw)` → `{ branch, entries }`; nagłówki `# branch.oid/head/upstream/ab`,
  wpisy `1`, `2` (z oryginalną ścieżką po NUL), `u`, `?`, `!`. Ścieżki ze spacjami, polskie
  litery, rename, usunięty, konflikt, odłączony HEAD, brak upstreamu, pusty status.
- `entryFlags(e)` → `staged` / `unstaged` / `conflict` / `untracked`; `statusLetter(e)`.
- `parseDiff(text)` → linie `meta | hunk | add | del | ctx | note` z numerami starych i nowych
  linii; flaga `binary`.
- `buildTree(paths, entries)` → węzły z agregatem statusu katalogu; `visibleRows(tree, open)`
  → płaska lista wierszy z głębokością; filtr „tylko zmienione”.
- `validRelPath`, `discardPlan(entry)` (`restore` / `clean` / `null`), `branchLabel(branch)`,
  `syncLabel(branch)`, `canCommit`.

**Komunikat commitu:** `Panel plików z gitem, etap 1: parsery statusu, diffu i drzewa`

## Etap 2 (L) – backend git

- `electron/src/git.ts`: `runGit` (spawn, limit czasu i rozmiaru, `okCodes`), `gitStatus`,
  `gitFiles`, `gitDiff`, `gitStage`, `gitUnstage`, `gitDiscard`, `gitCommit`, `gitSync`.
- `main.ts` (`handle("git_…")`), `backend.ts`, `backend-electron.ts`, `backend-mock.ts`.
- Test integracyjny na tymczasowym repozytorium i lokalnym „zdalnym” (bare): status,
  stage/unstage (także repozytorium bez commitów), discard śledzonego i nieśledzonego,
  commit, ahead/behind po push, pull ff-only, odrzucenie złej ścieżki.

**Komunikat commitu:** `Panel plików z gitem, etap 2: backend git (spawn, IPC, mock)`

## Etap 3 (C) – panel: drzewo, diff, operacje

`src/GitPanel.tsx`, style `.git-*` w `styles.css`, przycisk „Pliki” w `App.tsx`.
Lewa kolumna: sekcje „Staged” i „Zmiany” (wiersze z akcjami), pole komunikatu z „Zatwierdź”
(Ctrl+Enter), drzewo plików z przełącznikiem „tylko zmienione”. Prawa kolumna: diff z
numerami linii i kolorami z tokenów motywu (bez własnych kolorów). Discard: pierwszy klik
„Odrzuć” → „Na pewno?” na 3 s.

**Komunikat commitu:** `Panel plików z gitem, etap 3: drzewo, diff, stage/unstage/discard, commit`

## Etap 4 (C) – chip brancha, pull/push

Chip w nagłówku panelu: nazwa brancha (albo „odłączony HEAD @ abc1234”), `↑a ↓b`, „brak
upstreamu”. Pull (ff-only) i push (albo „Opublikuj”) z wynikiem w toaście i komunikatem
błędu git, gdy się nie uda. Przyciski nieaktywne w trakcie operacji i przy konflikcie.

**Komunikat commitu:** `Panel plików z gitem, etap 4: chip brancha, pull i push`

## Etap 5 (C + użytkownik) – sprawdzenie w oknie

`pnpm desktop` na prawdziwym repozytorium (także dużym, np. samo repo aplikacji): czas
odświeżania, nazwy z polskimi literami i spacjami, rename, konflikt po nieudanym pull,
praca równoległa z agentem piszącym pliki, wygląd w jasnym i ciemnym motywie. Wyniki w `HANDOFF.md`.

---

## Poza tym planem (nie rób)

Rebase, merge, stash, force-push, zmiana brancha, blame, submoduły, edycja plików w panelu,
rozwiązywanie konfliktów (tylko pokazujemy je jako zablokowane), autoryzacja HTTPS z hasłem
(bez terminala; działa SSH z agentem i helper kluczy).
