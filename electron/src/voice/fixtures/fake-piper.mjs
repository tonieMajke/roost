#!/usr/bin/env node
// Atrapa `piper --output_dir` do testów: linia ze stdin → plik w katalogu i jego ścieżka na stdout.
// „WOLNO …” czeka 200 ms, „PADNIJ” kończy proces z błędem; treść pliku = tekst, głos i pid.
import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";

const arg = (name) => {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
};
const dir = arg("--output_dir");
const model = arg("--model") ?? "";
const speaker = arg("--speaker") ?? "-";
if (!fs.existsSync(model)) {
  process.stderr.write(`[error] Model not found: ${model}\n`);
  process.exit(1);
}
let n = 0;
let chain = Promise.resolve();
readline.createInterface({ input: process.stdin }).on("line", (line) => {
  chain = chain.then(async () => {
    if (line === "PADNIJ") {
      process.stderr.write("[error] model się wysypał\n");
      process.exit(3);
    }
    if (line.startsWith("WOLNO")) await new Promise((r) => setTimeout(r, 200));
    const file = path.join(dir, `${++n}.wav`);
    fs.writeFileSync(file, `RIFF|${line}|${speaker}|${process.pid}`);
    process.stdout.write(`${file}\n`);
  });
});
