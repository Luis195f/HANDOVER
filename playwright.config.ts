import { defineConfig } from "@playwright/test";

const webPort = Number(process.env.E2E_PORT ?? 19006);

export default defineConfig({
  testDir: "tests/e2e",
  timeout: 60_000,
  expect: { timeout: 10_000 },
  retries: process.env.CI ? 1 : 0,
  use: {
    baseURL: `http://127.0.0.1:${webPort}`,
    trace: "retain-on-failure",
  },
  webServer: {
    // OJO: Expo NO soporta --non-interactive, por eso fallaba.
    // Mantengo tus flags válidos: --no-dev, --minify y --port.
    command: `pnpm web -- --no-dev --minify --port ${webPort}`,
    url: `http://127.0.0.1:${webPort}`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    env: {
      ...process.env,
      EXPO_PUBLIC_E2E: "true",
      CI: process.env.CI ? "1" : process.env.CI,
      EXPO_NO_TELEMETRY: "1",
    },
  },
});
