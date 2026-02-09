import { beforeEach, describe, expect, test, vi } from 'vitest';
import { enforceBundleValidationWithMode, processQueueOnce, configureSyncEngine, stopSyncEngine } from '@/src/lib/sync';
import { clearOfflineQueue, createOfflineQueueItem, listOfflineQueue } from '@/src/lib/queue';
import type { OperationOutcome } from '@/src/lib/fhir-outcome';

const realFetch = global.fetch;

vi.mock('expo-sqlite', () => ({
  openDatabaseSync: vi.fn(() => null),
  openDatabase: vi.fn(() => null),
}));

describe('sync remote validation and 422 handling', () => {
  beforeEach(async () => {
    await clearOfflineQueue();
    vi.restoreAllMocks();
    global.fetch = realFetch;
    stopSyncEngine();
  });

  test('remote validation aborts with formatted message and annotates bundle', async () => {
    const outcome: OperationOutcome = {
      resourceType: 'OperationOutcome',
      issue: [
        {
          severity: 'fatal',
          diagnostics: 'Invalid Patient',
          expression: ['Patient.name'],
        },
      ],
    };

    const mockFetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(outcome), {
        status: 200,
        headers: { 'content-type': 'application/fhir+json' },
      }),
    );
    vi.stubGlobal('fetch', mockFetch as unknown as typeof fetch);

    const validation = await import('@/src/lib/fhir-validation');
    vi.spyOn(validation, 'validateBundle').mockReturnValue({ isValid: true, errors: [] } as any);
    vi.spyOn(validation, 'validateResource').mockReturnValue({ ok: true } as any);

    const bundle: any = {
      resourceType: 'Bundle',
      type: 'transaction',
      entry: [
        {
          fullUrl: 'urn:uuid:patient-1',
          resource: {
            resourceType: 'Patient',
            id: '1',
            gender: 'female',
            name: [{ family: 'Doe', given: ['Jane'] }],
          },
          request: { method: 'PUT', url: 'Patient/1' },
        },
      ],
    };

    await expect(
      enforceBundleValidationWithMode(bundle, 'test', {
        mode: 'remote',
        accessToken: 't',
        fhirBaseUrl: 'https://fhir.test',
      }),
    ).rejects.toThrow(/Invalid Patient/);

    expect(bundle._validationErrors?.length).toBe(1);
    expect(mockFetch).toHaveBeenCalled();
  });

  test('postBundle 422 marks the queue item as non recoverable', async () => {
    const outcome: OperationOutcome = {
      resourceType: 'OperationOutcome',
      issue: Array.from({ length: 12 }).map((_, idx) => ({
        severity: 'error',
        diagnostics: `Bad bundle ${idx + 1}`,
      })),
    };

    const fhirClient = await import('@/src/lib/fhir-client');
    vi.spyOn(fhirClient, 'postBundle').mockResolvedValue({
      ok: false,
      status: 422,
      issue: outcome.issue,
      issues: outcome.issue,
      outcome,
      message: 'Bad bundle',
    } as any);

    const sync = await import('@/src/lib/sync');
    const queue = await import('@/src/lib/queue');

    await queue.createOfflineQueueItem({
      patientId: 'p1',
      payload: { bundle: { resourceType: 'Bundle', type: 'transaction' }, txId: 'tx1', patientId: 'p1' },
    });

    sync.configureSyncEngine({ getToken: async () => 'token' });

    await sync.processQueueOnce();

    const items = await queue.listOfflineQueue();
    expect(items).toHaveLength(1);
    expect(items[0]?.syncStatus).toBe('error');
  });

  test('remote validation captures 422 OperationOutcome issues', async () => {
    const outcome: OperationOutcome = {
      resourceType: 'OperationOutcome',
      issue: [
        {
          severity: 'error',
          diagnostics: 'Missing required value',
          expression: ['Observation.valueQuantity'],
        },
      ],
    };

    const mockFetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(outcome), {
        status: 422,
        headers: { 'content-type': 'application/fhir+json' },
      }),
    );
    vi.stubGlobal('fetch', mockFetch as unknown as typeof fetch);

    const bundle: any = {
      resourceType: 'Bundle',
      type: 'transaction',
      entry: [
        {
          fullUrl: 'urn:uuid:obs-1',
          resource: {
            resourceType: 'Observation',
            status: 'final',
            code: { text: 'Heart rate' },
            subject: { reference: 'Patient/pat-1' },
            effectiveDateTime: '2025-04-05T10:15:00.000Z',
            valueQuantity: { value: 80, unit: 'beats/min' },
          },
          request: { method: 'POST', url: 'Observation' },
        },
      ],
    };

    await expect(
      enforceBundleValidationWithMode(bundle, 'test', {
        mode: 'remote',
        accessToken: 't',
        fhirBaseUrl: 'https://fhir.test',
      }),
    ).rejects.toThrow(/Missing required value/);

    expect(bundle._validationErrors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: 'Observation.valueQuantity', message: 'Missing required value' }),
      ]),
    );
    expect(mockFetch).toHaveBeenCalledWith(
      'https://fhir.test/Observation/$validate',
      expect.objectContaining({ method: 'POST' }),
    );
  });
});
