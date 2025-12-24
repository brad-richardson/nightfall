import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "apps/web/tests",
  timeout: 30_000,
  expect: {
    timeout: 5_000
  },
  webServer: {
    command: "pnpm --filter @nightfall/web dev",
    url: "http://127.0.0.1:3000",
    reuseExistingServer: !process.env.CI,
    timeout: 120_000
  },
  use: {
    baseURL: "http://127.0.0.1:3000",
    trace: "on-first-retry"
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] }
    }
  ]
});
