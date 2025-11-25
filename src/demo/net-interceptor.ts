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

export async function maybeUseDemoResponse(
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<Response | null> {
  const session = await getSessionSafe();
  if (!isDemo(session)) return null;
  const response = await buildDemoResponse(input, init);
  if (response) return response;
  return new Response(JSON.stringify({ ok: true, mode: 'demo' }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}
// END HANDOVER: DEMO_MODE
