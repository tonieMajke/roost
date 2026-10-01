import { useEffect, useState } from "react";

/** Czas, po którym ekran powitalny sam znika (ms); potem jeszcze krótkie wygaszenie z CSS. */
export const SPLASH_MS = 1300;

/** Ekran powitalny przy starcie okna: znak aplikacji i hasło. Klik lub klawisz zamyka od razu. */
export function Splash() {
  const [phase, setPhase] = useState<"in" | "out" | "gone">("in");

  useEffect(() => {
    const out = setTimeout(() => setPhase("out"), SPLASH_MS);
    // Capture + stopImmediatePropagation: pierwszy klawisz tylko zamyka splash (listener Splasha
    // rejestruje się przed tym z App.tsx, więc skrót się nie odpali).
    const skip = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopImmediatePropagation();
      setPhase((p) => (p === "in" ? "out" : p));
    };
    window.addEventListener("keydown", skip, { capture: true, once: true });
    return () => {
      clearTimeout(out);
      window.removeEventListener("keydown", skip, true);
    };
  }, []);

  useEffect(() => {
    if (phase !== "out") return;
    const gone = setTimeout(() => setPhase("gone"), 400);
    return () => clearTimeout(gone);
  }, [phase]);

  if (phase === "gone") return null;
  return (
    <div className={`splash${phase === "out" ? " is-out" : ""}`} onClick={() => setPhase("out")} aria-hidden>
      <svg className="splash-bird" viewBox="96 96 320 320" width="96" height="96">
        <g fill="var(--accent)">
          <rect x="96" y="96" width="148" height="148" rx="28" />
          <rect x="268" y="96" width="148" height="148" rx="28" opacity=".55" />
          <rect x="96" y="268" width="148" height="148" rx="28" opacity=".55" />
          <rect x="268" y="268" width="148" height="148" rx="28" />
        </g>
      </svg>
      <div className="splash-name">Roost</div>
      <div className="splash-tag">Rule the roost</div>
    </div>
  );
}
