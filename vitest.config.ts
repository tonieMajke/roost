import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts", "electron/src/**/*.test.ts"],
    // themes.test.ts czyta themes.css jako tekst (`?raw`); bez tego vitest podaje pusty CSS
    css: { include: [/themes\.css/] },
    // bot.test.ts: zmiana czasu w harmonogramie liczona dla strefy użytkownika
    env: { TZ: "Europe/Warsaw" },
  },
});
