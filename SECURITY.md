# Bezpieczeństwo

Roost uruchamia procesy użytkownika (agenci CLI w terminalach), a boty mają narzędzia do plików,
powłoki i sieci. Poniżej: co aplikacja chroni, czego **nie** chroni i jak zgłosić błąd.

*English summary: Roost runs your agents and gives bots file, shell and network tools. Sections below describe the protections in the code and their known limits. Report vulnerabilities privately (see "Zgłaszanie").*

## Model zagrożeń

Zakładamy jednego, zaufanego użytkownika na własnej maszynie. Chronimy go przed:

- treścią z sieci i plików, która próbuje sterować botem (prompt injection),
- błędami modelu (bot robiący więcej, niż użytkownik chciał),
- obcą stroną/ramką w oknie Electrona próbującą wołać proces główny.

Nie chronimy przed użytkownikiem lokalnym z dostępem do konta ani przed zainstalowanym agentem CLI
(`claude`, `codex`, `pi` w panelu działają z pełnymi uprawnieniami użytkownika, tak jak w zwykłym terminalu).

## Co jest zabezpieczone

**Okno i IPC** (`electron/src/security.ts`)
- CSP dla załadowanej strony: `connect-src 'none'`, więc renderer nie łączy się z siecią, a cały ruch
  idzie przez IPC do procesu głównego.
- Nawigacja okna tylko w obrębie aplikacji.
- Każdy handler IPC sprawdza nadawcę (ramka musi pochodzić z naszej strony) i waliduje typy argumentów.
- Import awatara tylko z wyboru w natywnym oknie dialogowym.

**Sekrety**
- Klucze API są szyfrowane przez `safeStorage` (KWallet / libsecret). Bez bezpiecznego magazynu
  nic nie jest zapisywane.
- Pliki z sekretami (`chat-keys`, `accounts.json`, kopia ustawień wyszukiwarek pi) mają prawa 0600,
  katalog konfiguracji 0700; migracja zaostrza prawa istniejących plików.
- Aplikacja nie czyta ani nie kopiuje tokenów logowania agentów; konto to tylko ścieżka folderu
  (`CLAUDE_CONFIG_DIR` / `CODEX_HOME`).

**Narzędzia bota**
- Odczyt w folderach bota bez pytania; odczyt poza nimi, zapis poza `work/` i każde `bash` wymagają
  zgody („Zezwól raz” / „w tej rozmowie” / „Odrzuć”). Ścieżki sprawdzane po `realpath`.
- **Twarda blokada ścieżek wrażliwych** (`~/.ssh`, `~/.aws`, `~/.gnupg`, `.env*`, `*.pem`, `*.key`,
  `id_*`, katalog konfiguracji Roost): sprawdzana przed zgodą i bez karty, więc użytkownik nie może jej
  przez pomyłkę kliknąć. Katalog roboczy bota jest wyłączony z blokady.
- Polecenia `bash` mają limit czasu i wyjścia, własną grupę procesów i środowisko **bez sekretów**
  (klucze API, tokeny, `AWS_*`, `SSH_AUTH_SOCK` i zmienne o nazwach typu `*_TOKEN`, `*_PASSWORD`).
- `web_fetch` odmawia adresów lokalnych i prywatnych (tekstowo i po rozwiązaniu DNS) bez zgody
  użytkownika; przekierowania są ręczne (maks. 5), a host sprawdzany przy każdym skoku.
- Zadania z harmonogramu nie mają kogo zapytać: dostają tylko narzędzia bez zgody i to, co
  zaznaczono w zadaniu. Inna prośba o zgodę zatrzymuje przebieg i wysyła powiadomienie.

## Znane ograniczenia

- Blokada ścieżek w `bash` to **heurystyka**: polecenie, które nie wymienia wrażliwej ścieżki wprost
  (np. składa ją w zmiennej), może ją ominąć. Zgoda na `bash` daje botowi pełne uprawnienia użytkownika.
- `web_fetch`: zostaje wąskie okno DNS-rebinding między sprawdzeniem adresu a połączeniem.
- Zgoda „Zezwalaj w tej rozmowie” obowiązuje do końca rozmowy dla danego narzędzia i prefiksu polecenia.
- Agenci w panelach (`claude`, `codex`, `pi`) nie są ograniczani przez Roost.
- Sandbox Chromium wymaga nieuprzywilejowanych przestrzeni nazw użytkownika. Gdzie system ich nie daje
  (Ubuntu 24.04+ z AppArmor), skrypt startowy AppImage z electron-buildera uruchamia aplikację
  z `--no-sandbox`; Roost wtedy raz ostrzega (`electron/src/sandbox-notice.ts`). Przywrócenie: profil
  AppArmor z README („Rozwiązywanie problemów”).
- Pliki konfiguracji bez prawa 0600 (np. ustawienia niezawierające kluczy) są czytelne dla innych
  procesów użytkownika.
- Planowane Windows/macOS (`docs/plan-multiplatform.md`) wymagają osobnego przeglądu: `chmod` i
  reguły zgód są tam dziś zakładane pod Linuksa.

## Zgłaszanie błędów

Nie otwieraj publicznego zgłoszenia dla luki. Użyj prywatnego zgłoszenia w zakładce
**Security → Report a vulnerability** (GitHub Security Advisories). Podaj wersję, kroki odtworzenia
i skutek; nie dołączaj prawdziwych kluczy.
