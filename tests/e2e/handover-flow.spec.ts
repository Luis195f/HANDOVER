import { test, expect, type Page } from "@playwright/test";

const waitForAppReady = async (page: Page) => {
  // Señales de que la app cargó algo relevante (login o lista).
  await expect(
    page.locator(
      [
        '[data-testid="login-demo"]',
        '[data-testid^="patient-card-"]',
        '[data-testid="patient-list"]',
        '[data-testid="patient-search"]',
      ].join(",")
    )
  ).toBeVisible({ timeout: 60_000 });
};

const loginDemo = async (page: Page) => {
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await waitForAppReady(page);

  const demoButton = page.getByTestId("login-demo");

  // Si existe el botón de demo login, úsalo.
  if (await demoButton.count()) {
    await expect(demoButton).toBeVisible({ timeout: 20_000 });
    await demoButton.click();
  }

  // Post-condición: lista de pacientes visible (o al menos una card)
  await expect(
    page.locator('[data-testid^="patient-card-"]').first()
  ).toBeVisible({ timeout: 60_000 });
};

test.describe("handover e2e flows", () => {
  test("login and reach patient list", async ({ page }) => {
    await loginDemo(page);
    await expect(page.locator('[data-testid^="patient-card-"]').first()).toBeVisible({ timeout: 60_000 });
  });

  test("scan QR mock and navigate to handover form", async ({ page }) => {
    await loginDemo(page);

    const firstCard = page.locator('[data-testid^="patient-card-"]').first();
    await expect(firstCard).toBeVisible({ timeout: 60_000 });
    await firstCard.click();

    await expect(page.getByTestId("handover-patient-id")).toBeVisible({ timeout: 60_000 });
    await page.getByTestId("handover-scan-qr").click();

    await expect(page.getByTestId("qr-e2e-input")).toBeVisible({ timeout: 60_000 });
    await page.getByTestId("qr-e2e-input").fill('{"patientId":"E2E-123"}');
    await page.getByTestId("qr-e2e-submit").click();
    await page.getByTestId("qr-continue").click();

    await expect(page.getByTestId("handover-patient-id")).toHaveValue("E2E-123", { timeout: 60_000 });
  });

  test("record audio, attach, sign, and finalize", async ({ page }) => {
    // Montar el route ANTES de navegar para no perder requests.
    let auditEventSeen = false;
    await page.route("**/api/**", async (route) => {
      const url = route.request().url();
      if (url.includes("/api/audit/events")) {
        auditEventSeen = true;
      }
      // Respuesta genérica OK (evita depender de backend real)
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: "{}",
      });
    });

    await loginDemo(page);

    const firstCard = page.locator('[data-testid^="patient-card-"]').first();
    await expect(firstCard).toBeVisible({ timeout: 60_000 });
    await firstCard.click();

    await expect(page.getByTestId("handover-open-audio-note")).toBeVisible({ timeout: 60_000 });
    await page.getByTestId("handover-open-audio-note").click();

    const recordToggle = page.getByTestId("audio-record-toggle");
    await expect(recordToggle).toBeVisible({ timeout: 60_000 });

    // Toggle start/stop
    await recordToggle.click();
    await recordToggle.click();

    await expect(page.getByTestId("audio-attach")).toBeVisible({ timeout: 60_000 });
    await page.getByTestId("audio-attach").click();

    await expect(page.getByTestId("e2e-controls")).toBeVisible({ timeout: 60_000 });
    await page.getByTestId("e2e-set-final").click();
    await page.getByTestId("e2e-add-signature").click();
    await page.getByTestId("e2e-complete-checklist").click();

    await expect(page.getByTestId("signature-pad")).toBeVisible({ timeout: 60_000 });

    await page.getByTestId("handover-finalize").click();

    // Espera a que ocurra el request de auditoría (o su stub).
    await expect.poll(() => auditEventSeen, { timeout: 60_000 }).toBe(true);
  });
});
