import { expect, test } from '@playwright/test';

const OUTGOING_ACTOR_ID = 'demo@nurseos.app';
const INCOMING_ACTOR_ID = 'demo.receiver@nurseos.app';
const SNOMED_SEPSIS_CODE = '128045006';

const CHECKLIST_LABELS = [
  'Paciente identificado (nombre + pulsera)',
  'Alergias y alertas revisadas',
  'Líneas, catéteres y dispositivos verificados',
  'Plan de medicación y tratamientos verificado',
  'Medidas de seguridad aplicadas (barandillas, cama baja, etc.)',
  'Preguntas del equipo entrante resueltas',
] as const;

test('Expo Web real completes a dual-actor handover through offline queue replay', async ({
  context,
  page,
}, testInfo) => {
  const allowedNetworkOrigins = new Set([
    'http://127.0.0.1:19006',
    'https://demo.local',
    'https://oidc.e2e.invalid',
  ]);
  const observedNetworkOrigins = new Set<string>();
  const unexpectedNetworkUrls: string[] = [];
  const fhirBundles: string[] = [];
  let loadedExpoJavaScriptBytes = 0;

  page.on('request', (request) => {
    const url = new URL(request.url());
    observedNetworkOrigins.add(url.origin);
  });

  await page.route('**/*', async (route) => {
    const request = route.request();
    const url = new URL(request.url());

    if (!allowedNetworkOrigins.has(url.origin)) {
      unexpectedNetworkUrls.push(request.url());
      await route.abort('blockedbyclient');
      return;
    }

    if (url.origin === 'http://127.0.0.1:19006') {
      await route.continue();
      return;
    }

    if (url.origin === 'https://oidc.e2e.invalid') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          issuer: 'https://oidc.e2e.invalid',
          authorization_endpoint: 'https://oidc.e2e.invalid/authorize',
          token_endpoint: 'https://oidc.e2e.invalid/token',
          revocation_endpoint: 'https://oidc.e2e.invalid/revoke',
          userinfo_endpoint: 'https://oidc.e2e.invalid/userinfo',
          end_session_endpoint: 'https://oidc.e2e.invalid/logout',
        }),
      });
      return;
    }

    const headers = {
      'access-control-allow-headers': '*',
      'access-control-allow-methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
      'access-control-allow-origin': '*',
    };

    if (request.method() === 'OPTIONS') {
      await route.fulfill({ status: 204, headers });
      return;
    }

    if (request.method() === 'POST' && url.pathname.startsWith('/fhir/')) {
      fhirBundles.push(request.postData() ?? '');
      await route.fulfill({
        status: 200,
        headers: { ...headers, 'content-type': 'application/fhir+json' },
        body: JSON.stringify({ resourceType: 'Bundle', type: 'transaction-response', entry: [] }),
      });
      return;
    }

    await route.fulfill({
      status: 200,
      headers: { ...headers, 'content-type': 'application/json' },
      body: JSON.stringify({ ok: true, mode: 'demo' }),
    });
  });

  page.on('response', async (response) => {
    const contentType = response.headers()['content-type'] ?? '';
    if (
      response.url().startsWith('http://127.0.0.1:19006/') &&
      contentType.includes('javascript')
    ) {
      try {
        const body = await response.body();
        loadedExpoJavaScriptBytes = Math.max(loadedExpoJavaScriptBytes, body.byteLength);
      } catch {
        // A later bundle response can still provide the real-app evidence.
      }
    }
  });

  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await expect.poll(() => loadedExpoJavaScriptBytes).toBeGreaterThan(800);

  await page.getByTestId('login-demo').click();
  await expect(page.getByText('Modo demo - datos ficticios')).toBeVisible();
  await expect(page.getByTestId('demo-active-actor')).toContainText('Profesional saliente demo');

  await page.getByRole('button', { name: 'Psiquiatria y salud mental', exact: true }).click();
  const patientCard = page.getByTestId('patient-card-demo-psych-adult-001');
  await expect(patientCard).toBeVisible();
  await patientCard.click();
  await expect(page.getByTestId('handover-profile-runtime')).toBeVisible();
  await expect(page.getByTestId('handover-scan-qr')).toHaveCount(0);

  const evolution = page.getByTestId('handover-evolution');
  await evolution.fill('Evolución sintética E2E sin datos clínicos reales.');
  await expect(evolution).toHaveValue('Evolución sintética E2E sin datos clínicos reales.');

  await page.getByTestId('handover-administrative-unit').fill('sjd-a');
  await page.getByTestId('handover-staffIn').fill('Profesional receptora demo');
  await page.getByTestId('handover-staffOut').fill('Profesional saliente demo');
  await page.getByTestId('nutrition.dietType.trigger').click();
  await page.getByTestId('nutrition.dietType.option.oral').click();
  await expect(page.getByTestId('nutrition.dietType.trigger')).toContainText('Oral');
  await page.getByTestId('psychosocial-emotional-status').fill('Estable en escenario sintético E2E.');
  await page.getByTestId('psychosocial-family-notes').fill('Sin datos familiares reales.');

  const diagnosisSearch = page.getByTestId('diagnosis-search-dxMedicalStructured');
  await diagnosisSearch.fill('Sepsis');
  await page.getByTestId(`diagnosis-suggestion-SNOMED-${SNOMED_SEPSIS_CODE}`).click();
  await expect(page.getByTestId('diagnosis-primary-snomed')).toContainText('Sepsis');
  await expect(page.getByTestId('diagnosis-primary-snomed')).toContainText(SNOMED_SEPSIS_CODE);

  for (const label of CHECKLIST_LABELS) {
    const item = page.getByRole('switch', { name: label });
    await item.click();
    await expect(item).toBeChecked();
  }

  await expect(page.getByTestId('e2e-set-final')).toHaveCount(0);
  await expect(page.getByTestId('e2e-add-signature')).toHaveCount(0);
  await expect(page.getByTestId('e2e-complete-checklist')).toHaveCount(0);

  await page.getByTestId('handover-finalize').click();
  const canvas = page.getByTestId('signature-pad-canvas');
  await expect(canvas).toBeVisible();
  await canvas.scrollIntoViewIfNeeded();
  const box = await canvas.boundingBox();
  expect(box).not.toBeNull();
  if (!box) throw new Error('Signature canvas has no browser layout box');
  await page.mouse.move(box.x + 20, box.y + 20);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 6 });
  await page.mouse.move(box.x + box.width - 20, box.y + 25, { steps: 6 });
  await page.mouse.up();
  await page.getByTestId('signature-pad-save').click();
  await expect(page.getByTestId('signature-outgoing-user')).toContainText('Profesional saliente demo');

  await page.getByTestId('demo-switch-actor').click();
  await expect(page.getByTestId('demo-active-actor')).toContainText('Profesional receptora demo');
  await page.getByTestId('e2e-confirm-incoming-attestation').click();
  await expect(page.getByTestId('signature-incoming-user')).toContainText('Profesional receptora demo');
  await expect(page.getByTestId('signature-outgoing-user')).not.toHaveText(
    await page.getByTestId('signature-incoming-user').innerText(),
  );

  await context.setOffline(true);
  await page.getByTestId('handover-finalize').click();
  await expect(page.getByTestId('e2e-clinical-closure-confirmation')).toBeVisible();
  await page.getByTestId('e2e-confirm-clinical-closure').click();
  await expect(page.getByTestId('handover-sync-status')).toBeVisible();
  await expect(page.getByTestId('handover-sync-status')).toContainText(/cola|pendiente|offline|queued/i);
  expect(fhirBundles).toHaveLength(0);

  await page.getByTestId('handover-open-sync-center').click();
  const queuedItem = page.getByTestId(/^sync-item-/).first();
  await expect(queuedItem).toBeVisible();
  await expect(queuedItem).toContainText(/pendiente|pending|error/i);

  await context.setOffline(false);
  await page.getByTestId('sync-flush').click();
  await expect.poll(() => fhirBundles.length, { timeout: 20_000 }).toBeGreaterThan(0);
  await expect(page.getByTestId('sync-empty-queue')).toBeVisible();

  const transmittedBundle = fhirBundles.join('\n');
  expect(transmittedBundle).toContain(SNOMED_SEPSIS_CODE);
  expect(transmittedBundle).toContain(OUTGOING_ACTOR_ID);
  expect(transmittedBundle).toContain(INCOMING_ACTOR_ID);

  const observedOrigins = [...observedNetworkOrigins].sort();
  await testInfo.attach('observed-network-origins.json', {
    body: Buffer.from(JSON.stringify(observedOrigins, null, 2)),
    contentType: 'application/json',
  });
  console.info(`[e2e] observed network origins: ${observedOrigins.join(', ')}`);

  expect(unexpectedNetworkUrls, `Unexpected network requests: ${unexpectedNetworkUrls.join(', ')}`).toEqual([]);
  expect(observedOrigins).not.toContain('https://cdn.jsdelivr.net');
});
