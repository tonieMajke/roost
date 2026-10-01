import { expect, it } from "vitest";
import { remoteMessage } from "./backend-electron";

it("błąd z procesu głównego wraca jako sam komunikat", () => {
  const e = new Error("Error invoking remote method 'claude_summary': Error: kod 3: nie zalogowano");
  expect(remoteMessage(e)).toBe("kod 3: nie zalogowano");
  expect(remoteMessage(new Error("inny błąd"))).toBe("inny błąd");
});
