import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { enqueueBundle } from '@/src/lib/sync';

vi.mock('expo-secure-store');

describe('enqueueBundle validation modes', () => {
  const originalMode = process.env.HANDOVER_FHIR_VALIDATION_MODE;

  beforeEach(() => {
    (globalThis as any).__secureStoreMem = {};
    vi.restoreAllMocks();
  });

  afterEach(() => {
    process.env.HANDOVER_FHIR_VALIDATION_MODE = originalMode;
  });

  const validBundle = {
    resourceType: 'Bundle',
    type: 'transaction',
    entry: [
      {
        request: { method: 'POST', url: 'Patient' },
        resource: { resourceType: 'Patient', id: 'pat-1' },
      },
    ],
  } as const;

  it('skips validation when mode is off', async () => {
    process.env.HANDOVER_FHIR_VALIDATION_MODE = 'off';

    await expect(enqueueBundle(validBundle)).resolves.toBeDefined();
  });

  it('runs local validation when mode is local', async () => {
    process.env.HANDOVER_FHIR_VALIDATION_MODE = 'local';
    const invalidBundle = { resourceType: 'Bundle', type: 'transaction', entry: [{}] } as const;

    await expect(enqueueBundle(invalidBundle)).rejects.toThrow();
  });

  it('halts on remote validation errors', async () => {
    process.env.HANDOVER_FHIR_VALIDATION_MODE = 'remote';
    const fetchMock = vi.spyOn(globalThis, 'fetch' as never).mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        issue: [
          {
            severity: 'error',
            details: { text: 'Profile mismatch' },
          },
        ],
      }),
    } as any);

    await expect(
      enqueueBundle(validBundle, {
        fhirBaseUrl: 'http://example.com/fhir',
        accessToken: 'token',
      })
    ).rejects.toThrow(/Remote validation/);

    expect(fetchMock).toHaveBeenCalled();
  });
});
