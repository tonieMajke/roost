# Wersja Tauri (archiwum)

Do 2026-10-01 aplikacja działała na Tauri 2 (WebKitGTK). Na Linuksie/Wayland WebKitGTK
wymagał renderowania na CPU (inaczej czarne okno na NVIDIA) i lagował, więc główną wersją
jest teraz Electron (`electron/`). Ten folder zostaje do porównań i ewentualnego powrotu.

- `src-tauri/` – backend w Ruście (pty, konfiguracja, kontekst, przekazanie, limity…),
  odpowiednik `electron/src/`.
- `backend-tauri.ts` – frontendowa strona tego backendu (było `src/backend-tauri.ts`).

Powrót: przenieść `src-tauri/` do katalogu głównego, `backend-tauri.ts` do `src/`,
w `src/backend.ts` przywrócić `inTauri ? tauriBackend : …` (historia gita: commit `3a98263`)
i skrypty `desktop: tauri dev`, `tauri: tauri` w `package.json`. Zależności `@tauri-apps/*`
zostały usunięte z `package.json` — żeby zbudować wersję Tauri, trzeba je doinstalować ręcznie:
`pnpm add @tauri-apps/api @tauri-apps/plugin-clipboard-manager @tauri-apps/plugin-dialog && pnpm add -D @tauri-apps/cli`.

Ostatnia zainstalowana AppImage z Tauri: `~/.local/bin/Agents-afe59d9.AppImage`.
