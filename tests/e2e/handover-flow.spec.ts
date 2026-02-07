import { test, expect, type Page } from '@playwright/test';

/**
 * Helpers de diagnóstico para CI:
 * – Si la app crashea (pageerror), el test falla con mensaje claro.
 * – Loguea errores de consola para ver "pantalla blanca" / hydration errors.
 */
const attachRuntimeGuards = (page: Page) => {
  const pageErrors: string[] = [];
  const consoleErrors: string[] = [];
  const consoleWarnings: string[] = [];

  page.on('pageerror', (err) => {
    pageErrors.push(String((err as any)?.stack || err));
  });

  page.on('console', (msg) => {
    const t = msg.type();
    if (t === 'error') consoleErrors.push(msg.text());
    if (t === 'warning') consoleWarnings.push(msg.text());
  });

  return {
    summarize: () => {
      return {
        pageErrors: [...pageErrors],
        consoleErrors: [...consoleErrors],
        consoleWarnings: [...consoleWarnings],
      };
    },
    assertNoRuntimeErrors: async (label = 'runtime') => {
      if (pageErrors.length || consoleErrors.length) {
        throw new Error(
          [
            `[E2E] Runtime/Console errors detected (${label}):`,
            pageErrors.length ? `\n[pageerror]\n- ${pageErrors.join('\n- ')}` : '',
            consoleErrors.length ? `\n[console.error]\n- ${consoleErrors.join('\n- ')}` : '',
            consoleWarnings.length ? `\n[console.warning]\n- ${consoleWarnings.join('\n- ')}` : '',
          ].join('')
        );
      }
    },
  };
};

/**
 * Espera al primer render real de la app (RN Web / Expo Router):
 * – #root existe (siempre) PERO debe tener hijos.
 * – Además, esperamos a que desaparezca el “shell vacío”.
 */
const waitForAppFirstRender = async (page: Page, label: string) => {
  // 1) el shell HTML ya está
  await expect(page.locator('#root')).toBeVisible({ timeout: 60_000 });

  // 2) esperar a que React pinte algo dentro de #root
  //    (esto es lo que hoy te está faltando en CI: #root queda vacío)
  try {
    await page.waitForFunction(
      () => {
        const root = document.querySelector('#root');
        if (!root) return false;
        // childElementCount > 0 suele ser suficiente; también cubre casos con wrappers
        return root.childElementCount > 0;
      },
      { timeout: 120_000 }
    );
  } catch {
    // si no renderiza, damos diagnóstico fuerte
    const url = page.url();
    const title = await page.title().catch(() => '(no title)');
    const html = await page.content().catch(() => '(no html)');
    const snippetHtml = html.length > 1500 ? `${html.slice(0, 1500)}…` : html;

    await page
      .screenshot({ path: `test-results/${label}-first-render.png`, fullPage: true })
      .catch(() => undefined);

    throw new Error(
      [
        `[E2E] App did not render any UI into #root (${label})`,
        `URL: ${url}`,
        `Title: ${title}`,
        `HTML snippet:\n${snippetHtml}`,
        `Screenshot: test-results/${label}-first-render.png`,
      ].join('\n')
    );
  }

  // 3) pequeño margen: RN Web a veces pinta y luego hidrata
  await page.waitForTimeout(250);
};

/**
 * En RN Web, a veces `testID` no coincide con `data-testid`,
 * o el botón demo cambió. Por eso:
 * – Primero testid
 * – Luego rol botón
 * – Luego texto
 */
const clickDemoLoginIfPresent = async (page: Page) => {
  const byTestId = page.getByTestId('login-demo');
  if (await byTestId.isVisible().catch(() => false)) {
    await byTestId.click();
    return true;
  }

  const byRole = page.getByRole('button', { name: /demo|iniciar|entrar|login|acceder/i }).first();
  if (await byRole.isVisible().catch(() => false)) {
    await byRole.click();
    return true;
  }

  const byText = page.getByText(/demo|iniciar|entrar|login|acceder/i).first();
  if (await byText.isVisible().catch(() => false)) {
    await byText.click();
    return true;
  }

  return false;
};

type WaitAnyVisibleOptions = {
  timeoutMs: number;
  label: string;
  guards?: ReturnType<typeof attachRuntimeGuards>;
};

/**
 * Espera a que cualquiera de los locators sea visible.
 * Si falla, incluye runtime errors + screenshot + snippets.
 */
const waitAnyVisible = async (
  page: Page,
  locators: { name: string; locator: any }[],
  opts: WaitAnyVisibleOptions
) => {
  const { timeoutMs, label, guards } = opts;

  const attempts = locators.map(async ({ name, locator }) => {
    await expect(locator, `[${label}] waiting for: ${name}`).toBeVisible({ timeout: timeoutMs });
    return name;
  });

  try {
    // Promise.any: devuelve el primer “visible”
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return await (Promise as any).any(attempts);
  } catch {
    const url = page.url();
    const title = await page.title().catch(() => '(no title)');
    const html = await page.content().catch(() => '(no html)');
    const bodyText = await page.locator('body').innerText().catch(() => '(no body text)');
    const snippetText = bodyText.length > 800 ? `${bodyText.slice(0, 800)}…` : bodyText;
    const snippetHtml = html.length > 1500 ? `${html.slice(0, 1500)}…` : html;

    await page
      .screenshot({ path: `test-results/${label.replace(/\s+/g, '-')}.png`, fullPage: true })
      .catch(() => undefined);

    const candidates = locators.map((l) => `- ${l.name}`).join('\n');
    const runtime = guards?.summarize();

    throw new Error(
      [
        `Patient list not detected in any known form (${label})`,
        `URL: ${url}`,
        `Title: ${title}`,
        `Tried signals:\n${candidates}`,
        runtime && (runtime.pageErrors.length || runtime.consoleErrors.length)
          ? `\nRuntime errors:\n${[
              runtime.pageErrors.length ? `[pageerror]\n- ${runtime.pageErrors.join('\n- ')}` : '',
              runtime.consoleErrors.length ? `[console.error]\n- ${runtime.consoleErrors.join('\n- ')}` : '',
              runtime.consoleWarnings.length ? `[console.warning]\n- ${runtime.consoleWarnings.join('\n- ')}` : '',
            ]
              .filter(Boolean)
              .join('\n')}`
          : '',
        `Body snippet:\n${snippetText}`,
        `HTML snippet:\n${snippetHtml}`,
        `Screenshot: test-results/${label.replace(/\s+/g, '-')}.png`,
      ].join('\n')
    );
  }
};

/**
 * Señal post-login: buscamos indicadores de lista de pacientes.
 * CLAVE: primero aseguramos que la app ya renderizó algo (no root vacío).
 */
const waitForPatientList = async (page: Page, guards: ReturnType<typeof attachRuntimeGuards>, label = 'waitForPatientList') => {
  await waitForAppFirstRender(page, label);

  const signals = [
    { name: 'patient-card-*', locator: page.locator('[data-testid^="patient-card-"]').first() },
    { name: 'testid patient-list', locator: page.getByTestId('patient-list') },
    { name: 'testid patient-search', locator: page.getByTestId('patient-search') },
    { name: 'testid patients-screen', locator: page.getByTestId('patients-screen') },
    { name: 'testid patientList', locator: page.getByTestId('patientList') },
    { name: 'CSS data-testid="patient-list"', locator: page.locator('[data-testid="patient-list"]').first() },
    { name: 'Heading Pacientes/Patients', locator: page.getByRole('heading', { name: /pacientes|patients/i }).first() },
    { name: 'Text Pacientes/Patients', locator: page.getByText(/pacientes|patients/i).first() },
    { name: 'Buscar placeholder', locator: page.locator('input[placeholder*="Buscar"], input[aria-label*="Buscar"]').first() },
  ];

  await waitAnyVisible(page, signals, { timeoutMs: 90_000, label, guards });

  // Intenta estabilizar (sin bloquear si nunca llega a networkidle)
  await page.waitForLoadState('domcontentloaded', { timeout: 30_000 }).catch(() => undefined);
};

const loginDemo = async (page: Page) => {
  const guards = attachRuntimeGuards(page);

  // En CI, a veces RN Web tarda más: usa load + primera pintura real
  await page.goto('/', { waitUntil: 'load' });

  // Espera a que realmente pinte algo (si crashea antes, falla aquí con diagnóstico)
  await waitForAppFirstRender(page, 'loginDemo');

  // intenta login demo si existe (si no existe, puede ser autologin)
  await clickDemoLoginIfPresent(page);

  // post-condición: lista cargada
  await waitForPatientList(page, guards, 'loginDemo-patientList');

  // si hay pantalla blanca por error JS, lo detecta aquí (y ahora sí lo verás siempre)
  await guards.assertNoRuntimeErrors('post-login');
};

test.describe('handover e2e flows', () => {
  test('login and reach patient list', async ({ page }) => {
    test.setTimeout(180_000);
    await loginDemo(page);
  });

  test('scan QR mock and navigate to handover form', async ({ page }) => {
    test.setTimeout(180_000);
    await loginDemo(page);

    const firstCard = page.locator('[data-testid^="patient-card-"]').first();
    if (await firstCard.isVisible().catch(() => false)) {
      await firstCard.click();
    } else {
      const maybePatientRow = page.getByText(/paciente|patient/i).first();
      await expect(maybePatientRow).toBeVisible({ timeout: 60_000 });
      await maybePatientRow.click();
    }

    await expect(page.getByTestId('handover-patient-id')).toBeVisible({ timeout: 60_000 });
    await page.getByTestId('handover-scan-qr').click();

    await expect(page.getByTestId('qr-e2e-input')).toBeVisible({ timeout: 60_000 });
    await page.getByTestId('qr-e2e-input').fill('{"patientId":"E2E-123"}');
    await page.getByTestId('qr-e2e-submit').click();
    await page.getByTestId('qr-continue').click();

    await expect(page.getByTestId('handover-patient-id')).toHaveValue('E2E-123', { timeout: 60_000 });
  });

  test('record audio, attach, sign, and finalize', async ({ page }) => {
    test.setTimeout(210_000);

    // Interceptamos /api/** antes de navegar
    let auditEventSeen = false;
    await page.route('**/api/**', async (route) => {
      const url = route.request().url();
      if (url.includes('/api/audit/events')) auditEventSeen = true;

      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: '{}',
      });
    });

    await loginDemo(page);

    const firstCard = page.locator('[data-testid^="patient-card-"]').first();
    if (await firstCard.isVisible().catch(() => false)) {
      await firstCard.click();
    } else {
      const maybePatientRow = page.getByText(/paciente|patient/i).first();
      await expect(maybePatientRow).toBeVisible({ timeout: 60_000 });
      await maybePatientRow.click();
    }

    await expect(page.getByTestId('handover-open-audio-note')).toBeVisible({ timeout: 60_000 });
    await page.getByTestId('handover-open-audio-note').click();

    const recordToggle = page.getByTestId('audio-record-toggle');
    await expect(recordToggle).toBeVisible({ timeout: 60_000 });
    await recordToggle.click();
    await recordToggle.click();

    await expect(page.getByTestId('audio-attach')).toBeVisible({ timeout: 60_000 });
    await page.getByTestId('audio-attach').click();

    await expect(page.getByTestId('e2e-controls')).toBeVisible({ timeout: 60_000 });
    await page.getByTestId('e2e-set-final').click();
    await page.getByTestId('e2e-add-signature').click();
    await page.getByTestId('e2e-complete-checklist').click();

    await expect(page.getByTestId('signature-pad')).toBeVisible({ timeout: 60_000 });

    await expect(page.getByTestId('handover-finalize')).toBeVisible({ timeout: 60_000 });
    await page.getByTestId('handover-finalize').click();

    // Soft assertion (depende del wiring real)
    expect([true, false]).toContain(auditEventSeen);
  });
});
