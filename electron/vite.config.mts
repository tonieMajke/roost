import { builtinModules } from "node:module";
import { defineConfig } from "vite";

// Proces główny, preload, pomocnik linii statusu i serwer MCP botów jako CommonJS dla Electrona/node.
export default defineConfig({
  build: {
    outDir: "out",
    emptyOutDir: true,
    ssr: true,
    target: "node22",
    minify: false,
    rolldownOptions: {
      input: { main: "src/main.ts", preload: "src/preload.ts", statusline: "src/statusline.ts", "mcp-server": "src/bot/mcp-server.ts" },
      external: ["electron", "node-pty", ...builtinModules, ...builtinModules.map((m) => `node:${m}`)],
      output: { format: "cjs", entryFileNames: "[name].cjs" },
    },
  },
});
