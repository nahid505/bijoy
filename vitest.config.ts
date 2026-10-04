import { defineConfig } from "vitest/config";
import { loadEnv } from "vite";
import path from "path";

// Unit tests: tests/*.test.ts (pure, no DB).
// Integration tests: tests/integration/*.test.ts run against TEST_DATABASE_URL
// (a separate database — never the development DB). They are skipped if it is unset.
const env = loadEnv("test", process.cwd(), "");
const testDb = process.env.TEST_DATABASE_URL ?? env.TEST_DATABASE_URL;
if (testDb) process.env.TEST_DATABASE_URL = testDb; // visible to globalSetup

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
      "server-only": path.resolve(__dirname, "tests/support/server-only-stub.ts"),
    },
  },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    globalSetup: testDb ? ["tests/support/global-setup.ts"] : [],
    env: testDb ? { DATABASE_URL: testDb, TEST_DATABASE_URL: testDb } : {},
    fileParallelism: false,
    testTimeout: 60_000,
    hookTimeout: 120_000,
  },
});
