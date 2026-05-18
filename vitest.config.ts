import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  test: {
    globalSetup: ["./src/tests/global-setup.ts"],
    setupFiles: ["./src/tests/setup.ts"],
    testTimeout: 30_000,
    hookTimeout: 120_000,
    fileParallelism: false,
    pool: "forks",
    poolMaxForks: 1,
    poolMinForks: 1,
    isolate: false,
  },
  resolve: {
    alias: { "@": path.resolve(__dirname, "./src") },
  },
});
