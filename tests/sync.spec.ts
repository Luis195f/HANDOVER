import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import type { Bundle } from '@/src/lib/fhir-client';

process.env.EXPO_PUBLIC_FHIR_BASE_URL = 'https://fhir.test/api';

vi.mock('@/src/lib/fhir-client', async () => {
  const actual = await vi.importActual<typeof import('@/src/lib/fhir-client')>(
    '@/src/lib/fhir-client',
  );
  return {
    ...actual,
    postBundle: vi.fn(),
  };
});

const SECURE_KEY = 'handover.queue.v1';
const DEAD_KEY = 'handover.queue.dead.v1';

function makeBundle(urls: string[]): Bundle {
  return {
    resourceType: 'Bundle',
    type: 'transaction',
    entry: urls.map((url) => ({
      fullUrl: url,
      resource: { resourceType: 'Observation' },
    })),
  };
}

async function loadSync() {
  const mod = await import('@/src/lib/sync');
  return mod;
}

async function readQueueRaw(key: string) {
  const secureStore = await import('expo-secure-store');
  const raw = await secureStore.getItemAsync(key);
  return raw ? (JSON.parse(raw) as unknown[]) : [];
}

describe('secure queue', () => {
  beforeEach(async () => {
    vi.resetModules();
    const secureStore = await import('expo-secure-store');
    const mem = (globalThis as any).__secureStoreMem as Record<string, string | null> | undefined;
    if (mem) {
      Object.keys(mem).forEach((key) => {
        delete mem[key];
      });
    }
    await secureStore.deleteItemAsync?.(SECURE_KEY);
    await secureStore.deleteItemAsync?.(DEAD_KEY);
    const client = await import('@/src/lib/fhir-client');
    (client.postBundle as unknown as Mock).mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('enqueues bundles and deduplicates by fullUrl hash', async () => {
    const { enqueue, getQueueSize } = await loadSync();
    await enqueue(makeBundle(['urn:uuid:1', 'urn:uuid:2']), { patientId: 'pat-1' });
    await enqueue(makeBundle(['urn:uuid:1', 'urn:uuid:2']), { patientId: 'pat-1' });

    const queue = await readQueueRaw(SECURE_KEY);
    expect(queue).toHaveLength(1);
    await expect(getQueueSize()).resolves.toBe(1);
  });

  it('merges entries for the same patient within the window', async () => {
    const { enqueue } = await loadSync();
    await enqueue(makeBundle(['urn:uuid:one']), { patientId: 'pat-2' });
    await enqueue(makeBundle(['urn:uuid:two']), { patientId: 'pat-2' });

    const queue = (await readQueueRaw(SECURE_KEY)) as Array<{ fullUrls: string[] }>;
    expect(queue).toHaveLength(1);
    expect(queue[0]?.fullUrls).toEqual(['urn:uuid:two']);
  });

  it('drains successfully when postBundle resolves ok', async () => {
    const { enqueue, drain } = await loadSync();
    const client = await import('@/src/lib/fhir-client');
    (client.postBundle as unknown as Mock).mockResolvedValue({
      ok: true,
      status: 200,
    });

    await enqueue(makeBundle(['urn:uuid:success']), { patientId: 'pat-ok' });
    await drain(async () => 'auth-token');

    const queue = await readQueueRaw(SECURE_KEY);
    expect(queue).toHaveLength(0);
    expect(client.postBundle).toHaveBeenCalledWith(expect.any(Object), { token: 'auth-token' });
  });

  it('retries with backoff on transient errors', async () => {
    vi.useFakeTimers();
    const { enqueue, drain } = await loadSync();
    const client = await import('@/src/lib/fhir-client');
    (client.postBundle as unknown as Mock).mockResolvedValue({ ok: false, status: 500 });

    await enqueue(makeBundle(['urn:uuid:retry']), { patientId: 'pat-retry' });
    const before = Date.now();
    await drain(async () => 'token');

    const queue = (await readQueueRaw(SECURE_KEY)) as Array<{ attempts: number; nextAt: number }>;
    expect(queue).toHaveLength(1);
    expect(queue[0]?.attempts).toBe(1);
    const delay = queue[0]!.nextAt - before;
    expect(delay).toBeGreaterThanOrEqual(1300);
    expect(delay).toBeLessThanOrEqual(2600);
  });

  it('moves unrecoverable errors to dead letter storage', async () => {
    const { enqueue, drain } = await loadSync();
    const client = await import('@/src/lib/fhir-client');
    (client.postBundle as unknown as Mock).mockResolvedValue({
      ok: false,
      status: 400,
      issue: [{ diagnostics: 'invalid' }],
    });

    await enqueue(makeBundle(['urn:uuid:dead']), { patientId: 'pat-dead' });
    await drain(async () => 'token');

    const queue = await readQueueRaw(SECURE_KEY);
    expect(queue).toHaveLength(0);
    const dead = (await readQueueRaw(DEAD_KEY)) as Array<{ status?: number; issue?: unknown[] }>;
    expect(dead.at(-1)?.status).toBe(400);
    expect(dead.at(-1)?.issue).toEqual([{ diagnostics: 'invalid' }]);
  });
});
