import { builtinModules } from "node:module";
import { defineConfig } from "vite";

// Proces główny, preload i pomocnik linii statusu jako CommonJS dla Electrona/node.
export default defineConfig({
  build: {
    outDir: "out",
    emptyOutDir: true,
    ssr: true,
    target: "node22",
    minify: false,
    rolldownOptions: {
      input: { main: "src/main.ts", preload: "src/preload.ts", statusline: "src/statusline.ts" },
      external: ["electron", "node-pty", ...builtinModules, ...builtinModules.map((m) => `node:${m}`)],
      output: { format: "cjs", entryFileNames: "[name].cjs" },
    },
  },
});
