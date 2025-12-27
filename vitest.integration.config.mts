import { defineConfig } from "vitest/config";

/**
 * Vitest config for integration tests.
 * These tests run against a real Postgres database and require the test DB to be running.
 *
 * Run via: pnpm test:db (sets up DB and runs these tests)
 * Or manually: DATABASE_URL=... pnpm vitest run --config vitest.integration.config.mts
 */
export default defineConfig({
  test: {
    environment: "node",
    include: ["**/*.integration.test.ts"],
    exclude: ["**/node_modules/**"],
    setupFiles: ["./vitest.setup.ts"],
    // Integration tests may take longer due to DB operations
    testTimeout: 30_000,
    // Run sequentially to avoid connection pool exhaustion
    pool: "forks",
    poolOptions: {
      forks: {
        singleFork: true
      }
    }
  }
});
