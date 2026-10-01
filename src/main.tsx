import { createRoot } from "react-dom/client";
import "@fontsource-variable/jetbrains-mono";
import "@fontsource-variable/geist";
import "@fontsource-variable/geist-mono";
import "@fontsource-variable/bricolage-grotesque";
import "./theme-fonts";
// xterm.css przed naszym: styles.css nadpisuje jego reguły przy tej samej specyficzności.
import "@xterm/xterm/css/xterm.css";
import "./styles.css";
import "./themes.css";
import { App } from "./App";
// Po App (a więc po chat.css i bot.css): motywy w Czacie i Bocie.
import "./themes-chat.css";

createRoot(document.getElementById("root")!).render(<App />);

// Przeciąganie krawędzi okna: blur za panelami (backdrop-filter) przelicza się co klatkę na całym
// ekranie; na czas serii zmian rozmiaru motywy go wyłączają (`.is-resizing`).
let resizeEnd: ReturnType<typeof setTimeout> | undefined;
window.addEventListener("resize", () => {
  document.documentElement.classList.add("is-resizing");
  clearTimeout(resizeEnd);
  resizeEnd = setTimeout(() => document.documentElement.classList.remove("is-resizing"), 200);
});
