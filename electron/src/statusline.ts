//! Pomocnik linii statusu (`ELECTRON_RUN_AS_NODE=1 <exe> statusline.cjs <plik>`): czyta wejście
//! linii statusu ze stdin i zapisuje limity. Nic nie wypisuje (pusta linia statusu) i zawsze kończy
//! kodem 0: claude nigdy nie może zobaczyć błędu.

import { parseStatus, store } from "./limits";

/** Wejście linii statusu ma kilka KB; więcej to nie to, czego się spodziewamy. */
const MAX_INPUT = 1024 * 1024;

const file = process.argv[2];
const chunks: Buffer[] = [];
let size = 0;
process.stdin.on("data", (d: Buffer) => {
  if (size < MAX_INPUT) chunks.push(d);
  size += d.length;
});
process.stdin.on("end", () => {
  try {
    const limits = file && size <= MAX_INPUT ? parseStatus(Buffer.concat(chunks).toString("utf8"), Math.floor(Date.now() / 1000)) : null;
    if (limits) store(file, limits);
  } catch {
    // zapis się nie udał: następna aktualizacja spróbuje znowu
  }
  process.exit(0);
});
process.stdin.on("error", () => process.exit(0));
