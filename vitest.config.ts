import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    setupFiles: ["src/i18n/setup.ts"],
    include: ["src/**/*.test.ts", "electron/src/**/*.test.ts"],
    // themes.test.ts czyta themes.css i themes-chat.css jako tekst (`?raw`); bez tego vitest podaje pusty CSS
    css: { include: [/themes(-chat)?\.css/] },
    // bot.test.ts: zmiana czasu w harmonogramie liczona dla strefy użytkownika
    env: { TZ: "Europe/Warsaw" },
  },
});
