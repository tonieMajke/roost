import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts", "electron/src/**/*.test.ts"],
    // themes.test.ts czyta themes.css jako tekst (`?raw`); bez tego vitest podaje pusty CSS
    css: { include: [/themes\.css/] },
  },
});
