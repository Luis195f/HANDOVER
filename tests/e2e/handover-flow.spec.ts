// tests/e2e/handover-flow.spec.ts
import { test, expect, type Page } from "@playwright/test";

/**
 * Helpers de diagnóstico para CI:
 * - Si la app crashea (pageerror), el test falla con mensaje claro.
 * - Loguea errores de consola para ver "pantalla blanca" / hydration errors.
 */
const attachRuntimeGuards = (page: Page) => {
  const pageErrors: string[] = [];
  const consoleErrors: string[] = [];

  page.on("pageerror", (err) => {
    pageErrors.push(String(err?.stack || err));
  });

  page.on("console", (msg) => {
    if (msg.type() === "error") {
      consoleErrors.push(msg.text());
    }
  });

  return {
    assertNoRuntimeErrors: async () => {
      if (pageErrors.length || consoleErrors.length) {
        throw new Error(
          [
            "[E2E] Runtime/Console errors detected:",
            pageErrors.length ? `\n[pageerror]\n- ${pageErrors.join("\n- ")}` : "",
            consoleErrors.length ? `\n[console.error]\n- ${consoleErrors.join("\n- ")}` : "",
          ].join("")
        );
      }
    },
  };
};

/**
 * En RN Web, a veces `testID` no coincide con `data-testid` como esperamos,
 * o el botón demo cambió de testid. Por eso:
 * - Primero intentamos por testid.
 * - Luego fallback por rol + regex (demo/login/entrar).
 */
const clickDemoLoginIfPresent = async (page: Page) => {
  const byTestId = page.getByTestId("login-demo");
  if (await byTestId.count()) {
    await byTestId.click();
    return true;
  }

  // Fallback: botones típicos de login demo
  const byRole = page.getByRole("button", { name: /demo|iniciar|entrar|login|acceder/i });
  if (await byRole.count()) {
    await byRole.first().click();
    return true;
  }

  // Fallback 2: texto clicable
  const byText = page.getByText(/demo|iniciar|entrar|login|acceder/i);
  if (await byText.count()) {
    await byText.first().click();
    return true;
  }

  return false;
};

/**
 * Señal post-login: en tu spec original, lo único estable era:
 * - tarjetas de pacientes (data-testid^="patient-card-")
 * pero si no existe en web, añadimos fallback por heading/lista.
 */
const waitForPatientList = async (page: Page) => {
  // 1) Si existen patient-card por data-testid, perfecto
  const cards = page.locator('[data-testid^="patient-card-"]');
  if (await cards.count()) {
    await expect(cards.first()).toBeVisible({ timeout: 60_000 });
    return;
  }

  // 2) Si existe algún contenedor testid típico (CSS puro)
  const byTestId = page.locator('[data-testid="patient-list"],[data-testid="patient-search"]');
  if (await byTestId.count()) {
    await expect(byTestId.first()).toBeVisible({ timeout: 60_000 });
    return;
  }

  // 3) Fallback por texto (NO CSS → Playwright text engine)
  const byText = page.getByText(/pacientes|patients/i);
  if (await byText.count()) {
    await expect(byText.first()).toBeVisible({ timeout: 60_000 });
    return;
  }

  // 4) Fallback por inputs tipo búsqueda (CSS puro)
  const byInput = page.locator('input[placeholder*="Buscar"], input[aria-label*="Buscar"]');
  if (await byInput.count()) {
    await expect(byInput.first()).toBeVisible({ timeout: 60_000 });
    return;
  }

  throw new Error('Patient list not detected in any known form');
};

const loginDemo = async (page: Page) => {
  const guards = attachRuntimeGuards(page);

  await page.goto("/", { waitUntil: "domcontentloaded" });

  // Espera a que el body exista y haya algo renderizado
  await expect(page.locator("body")).toBeVisible({ timeout: 60_000 });

  // Un pequeño margen para hydrate (Expo web a veces tarda)
  await page.waitForTimeout(500);

  // Intenta login demo si está
  await clickDemoLoginIfPresent(page);

  // Post condición: llegamos a la lista
  await waitForPatientList(page);

  // Si hay pantalla blanca por error JS, esto lo detecta
  await guards.assertNoRuntimeErrors();
};

test.describe("handover e2e flows", () => {
  test("login and reach patient list", async ({ page }) => {
    await loginDemo(page);
    await waitForPatientList(page);
  });

  test("scan QR mock and navigate to handover form", async ({ page }) => {
    await loginDemo(page);

    // Preferimos patient-card si existe, si no, buscamos primera fila/clickable razonable
    const firstCard = page.locator('[data-testid^="patient-card-"]').first();
    if (await firstCard.count()) {
      await firstCard.click();
    } else {
      // fallback: click primer elemento “paciente” si existe
      const maybePatientRow = page.getByText(/paciente|patient/i).first();
      await expect(maybePatientRow).toBeVisible({ timeout: 60_000 });
      await maybePatientRow.click();
    }

    // Este sí depende de tus testIDs existentes
    await expect(page.getByTestId("handover-patient-id")).toBeVisible({ timeout: 60_000 });
    await page.getByTestId("handover-scan-qr").click();

    await expect(page.getByTestId("qr-e2e-input")).toBeVisible({ timeout: 60_000 });
    await page.getByTestId("qr-e2e-input").fill('{"patientId":"E2E-123"}');
    await page.getByTestId("qr-e2e-submit").click();
    await page.getByTestId("qr-continue").click();

    await expect(page.getByTestId("handover-patient-id")).toHaveValue("E2E-123", { timeout: 60_000 });
  });

  test("record audio, attach, sign, and finalize", async ({ page }) => {
    // Montar intercept ANTES de navegar (importante)
    let auditEventSeen = false;
    await page.route("**/api/**", async (route) => {
      const url = route.request().url();
      if (url.includes("/api/audit/events")) auditEventSeen = true;
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: "{}",
      });
    });

    await loginDemo(page);

    const firstCard = page.locator('[data-testid^="patient-card-"]').first();
    if (await firstCard.count()) {
      await firstCard.click();
    } else {
      const maybePatientRow = page.getByText(/paciente|patient/i).first();
      await expect(maybePatientRow).toBeVisible({ timeout: 60_000 });
      await maybePatientRow.click();
    }

    await expect(page.getByTestId("handover-open-audio-note")).toBeVisible({ timeout: 60_000 });
    await page.getByTestId("handover-open-audio-note").click();

    const recordToggle = page.getByTestId("audio-record-toggle");
    await expect(recordToggle).toBeVisible({ timeout: 60_000 });
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
    await expect.poll(() => auditEventSeen, { timeout: 60_000 }).toBe(true);
  });
});
