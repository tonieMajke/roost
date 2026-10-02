# Plan – kalendarz i mail (odległy)

Dopisane 2026-10-01 z rozmowy z użytkownikiem. **Szkic na później, nie zaczynać.** Przed
rozpisaniem na etapy do wykonania trzeba odpowiedzieć na pytania z „Do ustalenia” i
przepisać ten plik w formacie `plan-m5.md` (Postęp, etapy L/C, komunikaty commitów).

## Gdzie: Bot, a dane wspólne dla aplikacji

- **Narzędzia w Bocie, nie w Czacie.** Bot ma już wszystko, czego trzeba: rejestr narzędzi
  ze zgodami (`electron/src/bot/tools.ts`, „Zezwól raz / w tej rozmowie / Odrzuć”),
  harmonogram tykający co 30 s (`scheduler.ts`), powiadomienia (`notify.ts`), pamięć
  i most MCP dla `claude -p` / `codex exec`. Czat to czysta rozmowa bez narzędzi.
- **Dane nie należą do jednego bota.** Kalendarz to jedno źródło prawdy:
  `~/.config/dev.majke.roost/calendar/`. Bot dostaje nową grupę narzędzi `calendar`
  (i później `mail`), włączaną w ustawieniach bota jak `web` czy `bash`.
- Później ten sam rejestr może dostać rozmówca głosowy (`window-tools`): „co mam jutro?”.

## Kalendarz

### Źródła

| Źródło | Odczyt | Zapis | Uwagi |
|---|---|---|---|
| Lokalny `.ics` w configu | ✓ | ✓ | podstawa, działa bez kont |
| Subskrypcja URL `.ics` | ✓ | ✗ | Proton Calendar (link udostępniania), Google (tajny adres iCal), plany zajęć, święta |
| CalDAV | ✓ | ✓ | Nextcloud, Fastmail, iCloud, Google; **Proton go nie ma** |

Proton Calendar nie ma API ani CalDAV, więc dwustronna synchronizacja z nim jest niemożliwa.
Wydarzenia od bota trafiają do kalendarza lokalnego, a Proton jest tylko do odczytu, przez link.

### Szkic etapów

1. **(L) Model bez UI.** `src/calendar.ts`: typ wydarzenia, parsowanie i zapis ICS,
   rozwijanie powtórzeń w zakresie dat, kolizje, terminy przypomnień. Testy ze zmianą
   czasu w Europe/Warsaw. Zależność: `ical.js`.
2. **(L) Magazyn i IPC.** `calendar/local.ics`, `subscriptions.json`, pobieranie
   subskrypcji co 15 min z pamięcią podręczną. IPC: `cal_list(zakres)`, `cal_save`, `cal_delete`.
3. **(C) Narzędzia bota.** `calendar_list`, `calendar_search`, `calendar_add`,
   `calendar_update`, `calendar_delete`. Zapis zawsze wymaga zgody. Zadanie z harmonogramu
   dostaje zapis tylko z flagą w `allow` (jak `writeWork`).
4. **(C) Widok.** Agenda i tydzień, edycja ręczna. Propozycja: przełącznik
   „Rozmowa | Kalendarz” w zakładce Bot (zamiast czwartej zakładki), plus sekcja „Dziś”
   w Pulpicie.
5. **(C) Przypomnienia.** Sprawdzane przy tyknięciu harmonogramu, wysyłane przez
   `notify`. Kliknięcie otwiera wydarzenie. Działa tylko przy otwartej aplikacji.
6. **(opcjonalnie)** CalDAV (`tsdav`) i narzędzia kalendarza dla Głosu.

## Mail

Przez **IMAP/SMTP**, bez API konkretnej firmy:
- **Proton:** przez Proton Mail Bridge (IMAP/SMTP na `127.0.0.1`). Wymaga płatnego planu
  i działającego Bridge.
- **Gmail:** IMAP z hasłem aplikacji. Nie przez API Google z OAuth: aplikacja
  niezweryfikowana w trybie testowym traci dostęp (token) co 7 dni.
- Hasło w `safeStorage`, tak jak `chat-keys.json`.

### Szkic etapów (od najbezpieczniejszego)

1. **Konto i odczyt.** `mail_list` (folder, nieprzeczytane, od daty), `mail_read`
   (HTML zamieniany na tekst, jak w `web_fetch`), `mail_search`. Zależności: `imapflow`,
   `mailparser`.
2. **Szkice.** `mail_draft` zapisuje do folderu Szkice (IMAP APPEND), ze zgodą.
   Wysyła użytkownik ze swojego programu pocztowego.
3. **Wysyłanie (opcjonalnie).** `mail_send` przez SMTP (`nodemailer`): zawsze ze zgodą,
   **nigdy z harmonogramu**.
4. **Mail × kalendarz.** Zaproszenie `.ics` w załączniku → „dodać do kalendarza?”.

Zadanie z harmonogramu jako przykład: **„Poranny przegląd”** o 8:00 przegląda
dzisiejszy kalendarz i nieprzeczytane maile, a potem wysyła streszczenie w powiadomieniu.

## Ryzyka

- **Prompt injection z maili.** Treść maila pisze ktoś obcy („wyślij X do Y”). Treść
  trafia do modelu oznaczona jako dane. W rozmowie, w której bot czytał pocztę, zapis
  i wysyłanie zawsze wymagają zgody, nawet przy „Zezwalaj w tej rozmowie”.
- **Strefy czasowe i powtórzenia w ICS.** Tu najłatwiej o błędy, stąd testy na zmianę
  czasu w etapie 1.
- **Przypomnienia działają tylko przy otwartej aplikacji.** Ta sama luka co
  w harmonogramie (usługa systemd jest na liście „na później” w M5).

## Do ustalenia

1. Z jakiego kalendarza korzysta użytkownik: Proton, Google czy żadnego? Od tego zależy,
   czy CalDAV jest w ogóle potrzebny.
2. Czy jest płatny plan Protona (Bridge)? Jeśli nie, zostaje Gmail albo inna skrzynka IMAP.
3. Widok kalendarza: w zakładce Bot czy osobna zakładka?
