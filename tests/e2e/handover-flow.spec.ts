import { test, expect, type Page } from "@playwright/test";

const loginDemo = async (page: Page) => {
  await page.goto("/");
  const demoButton = page.getByTestId("login-demo");
  await expect(demoButton).toBeVisible();
  await demoButton.click();
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

    await expect(page.getByTestId("handover-patient-id")).toBeVisible();
    await page.getByTestId("handover-scan-qr").click();

    await expect(page.getByTestId("qr-e2e-input")).toBeVisible();
    await page.getByTestId("qr-e2e-input").fill('{"patientId":"E2E-123"}');
    await page.getByTestId("qr-e2e-submit").click();
    await page.getByTestId("qr-continue").click();

    await expect(page.getByTestId("handover-patient-id")).toHaveValue("E2E-123");
  });

  test("record audio, attach, sign, and finalize", async ({ page }) => {
    await loginDemo(page);
    const firstCard = page.locator('[data-testid^="patient-card-"]').first();
    await expect(firstCard).toBeVisible({ timeout: 60_000 });
    await firstCard.click();

    await expect(page.getByTestId("handover-open-audio-note")).toBeVisible();
    await page.getByTestId("handover-open-audio-note").click();

    const recordToggle = page.getByTestId("audio-record-toggle");
    await expect(recordToggle).toBeVisible();
    await recordToggle.click();
    await recordToggle.click();

    await expect(page.getByTestId("audio-attach")).toBeVisible();
    await page.getByTestId("audio-attach").click();

    await expect(page.getByTestId("e2e-controls")).toBeVisible();
    await page.getByTestId("e2e-set-final").click();
    await page.getByTestId("e2e-add-signature").click();
    await page.getByTestId("e2e-complete-checklist").click();

    await expect(page.getByTestId("signature-pad")).toBeVisible();

    let auditEventSeen = false;
    await page.route("**/api/**", async (route) => {
      const url = route.request().url();
      if (url.includes("/api/audit/events")) {
        auditEventSeen = true;
      }
      await route.fulfill({ status: 200, body: "{}" });
    });

    await page.getByTestId("handover-finalize").click();
    await expect.poll(() => auditEventSeen).toBe(true);
  });
});
