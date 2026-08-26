import { buildDemoResponse } from './mock-api';

// BEGIN HANDOVER: DEMO_MODE
async function getSessionSafe(): Promise<{ mode?: string } | null> {
  try {
    const mod = await import('@/src/security/auth');
    return mod.getCurrentSession();
  } catch {
    return null;
  }
}

function isDemo(session: { mode?: string } | null): boolean {
  return session?.mode === 'demo';
}

function shouldReachE2ENetwork(input: RequestInfo | URL, init?: RequestInit): boolean {
  if (process.env.EXPO_PUBLIC_E2E !== 'true') return false;

  const request = typeof Request !== 'undefined' && input instanceof Request ? input : null;
  const method = (init?.method ?? request?.method ?? 'GET').toUpperCase();
  if (method === 'GET' || method === 'HEAD') return false;

  const rawUrl = input instanceof URL ? input.toString() : request?.url ?? String(input);
  try {
    const url = new URL(rawUrl);
    return url.origin === 'https://demo.local' && url.pathname.startsWith('/fhir/');
  } catch {
    return false;
  }
}

export async function maybeUseDemoResponse(
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<Response | null> {
  const session = await getSessionSafe();
  if (!isDemo(session)) return null;
  // In E2E only, real FHIR writes must cross the browser network boundary so
  // Playwright can prove offline queueing and deterministic replay.
  if (shouldReachE2ENetwork(input, init)) return null;
  const response = await buildDemoResponse(input, init);
  if (response) return response;
  return new Response(JSON.stringify({ ok: true, mode: 'demo' }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}
// END HANDOVER: DEMO_MODE
