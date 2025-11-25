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

  if (url.includes('/admin/units-summary')) {
    return jsonResponse(DEMO_ADMIN_DASHBOARD.units);
  }
  if (url.includes('/admin/staff-activity')) {
    return jsonResponse(DEMO_ADMIN_DASHBOARD.staff);
  }
  if (url.includes('/admin/alerts')) {
    return jsonResponse(DEMO_ADMIN_DASHBOARD.alerts);
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
