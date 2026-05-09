import {
  DEMO_ADMIN_DASHBOARD,
  DEMO_PATIENTS,
  getDemoAllergyBundle,
  getDemoEncounterBundle,
  getDemoFhirPatient,
} from './fixtures';

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

function parseUrl(url: string): URL {
  return new URL(url, 'https://demo.local');
}

function readDemoPatientId(parsed: URL): string | null {
  const patientPathMatch = parsed.pathname.match(/\/Patient\/([^/?#]+)/i);
  if (patientPathMatch?.[1]) {
    return decodeURIComponent(patientPathMatch[1]);
  }

  const subject = parsed.searchParams.get('subject') ?? parsed.searchParams.get('patient');
  if (!subject) return null;
  const subjectMatch = subject.match(/Patient\/(.+)$/i);
  if (subjectMatch?.[1]) {
    return decodeURIComponent(subjectMatch[1]);
  }
  return decodeURIComponent(subject);
}

export async function buildDemoResponse(input: RequestInfo | URL, _init?: RequestInit): Promise<Response | null> {
  const url = normalizeUrl(input);
  if (!url) return null;
  const parsed = parseUrl(url);
  const patientId = readDemoPatientId(parsed);

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

  if (/\/Patient\//i.test(parsed.pathname)) {
    return jsonResponse(getDemoFhirPatient(patientId));
  }
  if (parsed.pathname.includes('Encounter')) {
    return jsonResponse(getDemoEncounterBundle(patientId));
  }
  if (parsed.pathname.includes('AllergyIntolerance')) {
    return jsonResponse(getDemoAllergyBundle(patientId));
  }

  if (parsed.pathname.includes('/patients')) {
    const requestedUnit = parsed.searchParams.get('unit');
    const patients = requestedUnit ? DEMO_PATIENTS.filter((patient) => patient.unitId === requestedUnit) : DEMO_PATIENTS;
    return jsonResponse(patients);
  }

  return null;
}
// END HANDOVER: DEMO_MODE
