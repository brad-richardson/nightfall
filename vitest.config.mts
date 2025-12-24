import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["apps/api/src/**/*.test.ts", "apps/ticker/src/**/*.test.ts"],
    setupFiles: ["./vitest.setup.ts"]
  }
});
