import { describe, it, expect, beforeEach, vi } from 'vitest';
import { buildTransactionBundleForQueue, enqueueBundle, flush } from '@/src/lib/sync';

describe('cola offline + flush(sender)', () => {
  const NOW = '2025-10-19T12:00:00Z';
  const input = {
    patientId: 'pat-001',
    vitals: { rr: 18, hr: 80, sbp: 120, temp: 37.1, spo2: 96, o2: true },
    shiftStart: '2025-10-19T08:00:00Z',
  };

  beforeEach(() => {
    // resetea el mock global de SecureStore por test
    (globalThis as any).__secureStoreMem = {};
  });

  it('éxito 201 Created → clearDraft llamado con patientId', async () => {
    const bundle = buildTransactionBundleForQueue(input, { now: NOW });
    await enqueueBundle(bundle);

    const clearDraft = vi.fn();

    const sender = async () => ({
      ok: true,
      status: 200,
      body: {
        resourceType: 'Bundle',
        type: 'transaction-response',
        entry: [{ response: { status: '201 Created' } }],
      },
    });

    await flush(sender, clearDraft, { baseDelayMs: 0 });

    expect(clearDraft).toHaveBeenCalledTimes(1);
    expect(clearDraft).toHaveBeenCalledWith('pat-001');
  });

  it('conflicto 409 → tratado como entregado y clearDraft llamado', async () => {
    const bundle = buildTransactionBundleForQueue(input, { now: NOW });
    await enqueueBundle(bundle);

    const clearDraft = vi.fn();

    const sender = async () => ({
      ok: false,
      status: 409,
      body: {},
    });

    await flush(sender, clearDraft, { baseDelayMs: 0 });

    expect(clearDraft).toHaveBeenCalledTimes(1);
    expect(clearDraft).toHaveBeenCalledWith('pat-001');
  });
});
