//! Twardnienie okna: CSP dla załadowanej aplikacji (file://) i decyzja o nawigacji. Czyste funkcje, bez Electrona.

/**
 * CSP strony z `dist-web`. Renderer nie łączy się z siecią (cały ruch idzie przez IPC do procesu głównego),
 * więc `connect-src 'none'`. `blob:` w script-src: AudioWorklet VAD ładowany z Blob URL (`src/voice/audio.ts`);
 * `'wasm-unsafe-eval'`: wasm podświetlacza shiki. Style inline: React (`style=`) i xterm.
 */
export function buildCsp(): string {
  return [
    "default-src 'none'",
    "script-src 'self' 'wasm-unsafe-eval' blob:",
    "worker-src 'self' blob:",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    "media-src 'self' data: blob:",
    "connect-src 'none'",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
    "frame-src 'none'",
  ].join("; ");
}

/** CSP stosujemy tylko do stron z dysku (file://); dev serwer Vite (http://localhost) jej nie dostaje, żeby HMR działał. */
export function shouldApplyCsp(url: string): boolean {
  return url.startsWith("file://");
}

/** Czy nawigacja okna do `target` jest dozwolona: tylko w obrębie bieżącej aplikacji (ten sam dev origin albo ta sama strona file://). */
export function allowNavigation(target: string, appUrl: { dev?: string; file: string }): boolean {
  let t: URL;
  try {
    t = new URL(target);
  } catch {
    return false;
  }
  if (appUrl.dev) {
    try {
      return t.origin !== "null" && t.origin === new URL(appUrl.dev).origin;
    } catch {
      return false;
    }
  }
  if (t.protocol !== "file:") return false;
  // Ta sama strona (hash/query dozwolone), nie dowolny plik z dysku.
  return t.pathname === new URL(appUrl.file).pathname;
}
