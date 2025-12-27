import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: [
      "apps/api/src/**/*.test.ts",
      "apps/ticker/src/**/*.test.ts",
      "scripts/ingest/src/**/*.test.ts"
    ],
    // Exclude integration tests from default run (they require the test DB)
    exclude: ["**/*.integration.test.ts", "**/node_modules/**"],
    setupFiles: ["./vitest.setup.ts"]
  }
});
