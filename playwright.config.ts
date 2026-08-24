import { defineConfig } from "@playwright/test";

const webPort = Number(process.env.E2E_PORT ?? 19006);
const reporter = process.env.CI
  ? [
      ["list"],
      ["html", { open: "never", outputFolder: "playwright-report" }],
      ["junit", { outputFile: "test-results/playwright/results.xml" }],
    ]
  : [["list"]];

// IMPORTANT: baseURL sin trailing slash también funciona, pero esto evita edge cases.
const baseURL = `http://127.0.0.1:${webPort}`;

export default defineConfig({
  testDir: "tests/e2e",
  reporter,
  outputDir: "test-results/playwright",
  timeout: 180_000,
  expect: { timeout: 30_000 },
  retries: process.env.CI ? 1 : 0,
  use: {
    baseURL,
    trace: "retain-on-failure",
  },

  // En CI, NO uses directamente `pnpm web` como webServer “ready=url”.
  // Expo puede servir "/" pero el bundle aún no está listo => root vacío.
  webServer: {
    command: `node scripts/e2e-webserver.mjs --port ${webPort}`,
    url: baseURL,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
    env: {
      ...process.env,
      EXPO_PUBLIC_E2E: "true",
      EXPO_PUBLIC_ENABLE_DEMO: "true",
      EXPO_PUBLIC_API_BASE_URL: "https://demo.local",
      EXPO_PUBLIC_FHIR_BASE_URL: "https://demo.local/fhir",
      CI: process.env.CI ? "1" : process.env.CI,
      EXPO_NO_TELEMETRY: "1",
      E2E_PORT: String(webPort),
    },
  },
});
