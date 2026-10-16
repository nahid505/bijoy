import { defineConfig } from "vitest/config";
import { loadEnv } from "vite";
import path from "path";

// Unit tests: tests/*.test.ts (pure, no DB).
// Integration tests: tests/integration/*.test.ts run against TEST_DATABASE_URL
// (a separate database — never the development DB). They are skipped if it is unset.
const env = loadEnv("test", process.cwd(), "");
// Same pool cap as production (cPanel DATABASE_URL uses connection_limit=5): bursts of parallel
// queries (e.g. a backup export) queue instead of opening many connections at once, which Docker
// Desktop's port proxy sometimes refuses ("Can't reach database server").
const withPoolCap = (url: string | undefined) => (url && !/[?&]connection_limit=/.test(url) ? `${url}${url.includes("?") ? "&" : "?"}connection_limit=5` : url);
const testDb = withPoolCap(process.env.TEST_DATABASE_URL ?? env.TEST_DATABASE_URL);
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
