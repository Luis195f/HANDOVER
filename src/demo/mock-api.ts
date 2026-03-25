import { DEMO_ADMIN_DASHBOARD, DEMO_FHIR_ALLERGY_BUNDLE, DEMO_FHIR_ENCOUNTER_BUNDLE, DEMO_FHIR_PATIENT, DEMO_PATIENTS } from './fixtures';

// BEGIN HANDOVER: DEMO_MODE
function normalizeUrl(input: RequestInfo | URL): string | null {
  if (typeof input === 'string') return input;
  if (input instanceof URL) return input.toString();
  if (typeof (input as any)?.url === 'string') return (input as any).url as string;
  return null;
}

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

export async function buildDemoResponse(input: RequestInfo | URL, _init?: RequestInit): Promise<Response | null> {
  const url = normalizeUrl(input);
  if (!url) return null;

  if (url.includes('/api/ping')) {
    return jsonResponse({ ok: true, mode: 'demo' });
  }

  if (url.includes('/api/icea/ops/summary')) {
    return jsonResponse(DEMO_ADMIN_DASHBOARD.summary);
  }
  if (url.includes('/api/icea/ops/events')) {
    return jsonResponse({
      generatedAt: DEMO_ADMIN_DASHBOARD.summary.generatedAt,
      available: true,
      enabled: true,
      scope: 'events',
      count: DEMO_ADMIN_DASHBOARD.events.length,
      results: DEMO_ADMIN_DASHBOARD.events,
    });
  }
  if (url.includes('/api/icea/ops/unit/')) {
    return jsonResponse(DEMO_ADMIN_DASHBOARD.unit);
  }
  if (url.includes('/api/icea/dashboard-summary')) {
    return jsonResponse(DEMO_ADMIN_DASHBOARD.summary);
  }
  if (url.includes('/api/icea/actions/refresh-dashboard-summary')) {
    return jsonResponse({
      action: 'refresh-dashboard-summary',
      result: {
        statusCode: 200,
        payload: {
          status: 'completed',
          summary: {
            unitId: 'icu-adult',
            generatedAt: DEMO_ADMIN_DASHBOARD.summary.generatedAt,
          },
        },
      },
    });
  }

  if (/\/Patient\//i.test(url)) {
    return jsonResponse(DEMO_FHIR_PATIENT);
  }
  if (url.includes('Encounter?')) {
    return jsonResponse(DEMO_FHIR_ENCOUNTER_BUNDLE);
  }
  if (url.includes('AllergyIntolerance?')) {
    return jsonResponse(DEMO_FHIR_ALLERGY_BUNDLE);
  }

  if (url.includes('/patients') || url.includes('/Patient')) {
    return jsonResponse(DEMO_PATIENTS);
  }

  return null;
}
// END HANDOVER: DEMO_MODE
