import { defineConfig } from "@playwright/test";

const webPort = Number(process.env.E2E_PORT ?? 19006);

export default defineConfig({
  testDir: "tests/e2e",
  timeout: 60_000,
  expect: { timeout: 10_000 },
  retries: process.env.CI ? 1 : 0,
  use: {
    baseURL: `http://localhost:${webPort}`,
    trace: "retain-on-failure",
  },
  webServer: {
    command: `EXPO_PUBLIC_E2E=true pnpm web -- --non-interactive --no-dev --minify --port ${webPort}`,
    url: `http://localhost:${webPort}`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
