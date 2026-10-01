import { describe, expect, it } from "vitest";
import { Piper } from "./tts";

// Prawdziwy Piper: AW_PIPER=/ścieżka/piper AW_PIPER_MODEL=/ścieżka/pl_PL-gosia-medium.onnx pnpm test tts-live
const command = process.env.AW_PIPER;
const model = process.env.AW_PIPER_MODEL;

describe.skipIf(!command || !model)("Piper na żywo", () => {
  it("dwa zdania = dwa pliki WAV w kolejności, drugie bez kosztu startu", async () => {
    const p = new Piper(command!, model!, "");
    try {
      const t0 = Date.now();
      const first = await p.speak("Cześć, tu kuleczka.");
      const t1 = Date.now();
      const second = await p.speak("Drugie zdanie, np. o Ruście, jest dłuższe od pierwszego.");
      const t2 = Date.now();
      for (const a of [first, second]) expect(Buffer.from(a.subarray(0, 4)).toString("latin1")).toBe("RIFF");
      expect(second.byteLength).toBeGreaterThan(first.byteLength);
      console.log(`Piper: pierwsze zdanie ${t1 - t0} ms (ze startem), drugie ${t2 - t1} ms`);
      expect(t2 - t1).toBeLessThan(1000);
    } finally {
      p.close();
    }
  });
});
