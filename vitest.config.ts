import { defineConfig } from "vitest/config";

// Unit tests run in plain Node (no Electron, no browser): pure logic only.
export default defineConfig({
  esbuild: { jsx: "automatic" },
  test: { include: ["tests/**/*.test.ts"], environment: "node" },
});
