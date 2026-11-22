import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

// Unit tests run in plain Node (no Electron, no browser): pure logic only. Electron is stubbed out.
export default defineConfig({
  esbuild: { jsx: "automatic" },
  resolve: { alias: { electron: fileURLToPath(new URL("./tests/stubs/electron.ts", import.meta.url)) } },
  test: { include: ["tests/**/*.test.ts"], environment: "node" },
});
