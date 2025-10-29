import { describe, it, beforeEach, afterEach, expect, vi } from 'vitest';
import {
  buildTransactionBundleForQueue,
  clearQueue,
  enqueueBundle,
  enqueueTxFromValues,
  flushQueue,
  readQueueState,
} from '@/src/lib/sync';

describe('sync.ts offline queue determinism & retries', () => {
  let randomSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    (globalThis as any).__secureStoreMem = {};
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2025-01-01T00:00:00.000Z'));
    randomSpy = vi.spyOn(Math, 'random').mockReturnValue(0);
    await clearQueue();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('mantiene un único bundle por paciente y IDs deterministas en re-enqueue', async () => {
    const patientId = 'pat-deterministic';
    const values = {
      patientId,
      vitals: { hr: 88, sbp: 120, dbp: 70, temp: 36.9, spo2: 97 },
    } as const;
    const fixedNow = new Date('2025-01-01T08:00:00.000Z');

    vi.setSystemTime(fixedNow);
    const firstBundle = buildTransactionBundleForQueue(values, { now: fixedNow });
    await enqueueBundle({ patientId, bundle: firstBundle, values: values as any });

    let state = await readQueueState();
    expect(state.size).toBe(1);
    const [firstItem] = state.items;
    const initialCreatedAt = firstItem.createdAt;
    const snapshot = JSON.parse(JSON.stringify(firstItem.bundle));

    const patientEntry = firstItem.bundle.entry[0];
    expect(patientEntry.fullUrl).toBe(`urn:uuid:patient-${patientId}`);
    expect(patientEntry.resource?.identifier?.[0]?.value).toBe(patientId);

    const observationFullUrls = firstItem.bundle.entry
      .filter((entry) => entry.resource?.resourceType === 'Observation')
      .map((entry) => entry.fullUrl);
    expect(new Set(observationFullUrls).size).toBe(observationFullUrls.length);

    const later = new Date('2025-01-01T10:15:00.000Z');
    vi.setSystemTime(later);
    const secondBundle = buildTransactionBundleForQueue(values, { now: fixedNow });
    await enqueueBundle({ patientId, bundle: secondBundle, values: values as any });

    state = await readQueueState();
    expect(state.size).toBe(1);
    const [current] = state.items;
    expect(current.createdAt).toBe(initialCreatedAt);
    expect(new Date(current.updatedAt).toISOString()).toBe(later.toISOString());
    expect(current.bundle).toStrictEqual(snapshot);
    expect(current.bundle.type).toBe('transaction');
    expect(current.bundle.entry[0].fullUrl).toBe(`urn:uuid:patient-${patientId}`);
  });

  it('aplica backoff exponencial determinista y evita duplicar envíos en reconexión', async () => {
    const patientId = 'pat-retry';
    randomSpy.mockReturnValue(0.25);
    const start = new Date('2025-02-01T12:00:00.000Z');
    vi.setSystemTime(start);
    await enqueueTxFromValues({ patientId } as any);

    const onSent = vi.fn();
    const sender = vi
      .fn()
      .mockImplementationOnce(async () => {
        throw new Error('offline');
      })
      .mockImplementationOnce(async () => ({ ok: false, status: 500 }))
      .mockImplementationOnce(async () => ({ ok: false, status: 412 }));

    await flushQueue({ sender, onSent });

    let state = await readQueueState();
    expect(sender).toHaveBeenCalledTimes(1);
    expect(sender.mock.calls[0]?.[0]?.attempts).toBe(0);
    expect(state.size).toBe(1);
    expect(state.items[0].attempts).toBe(1);
    const firstNext = new Date(state.items[0].nextAttemptAt).getTime();
    expect(firstNext).toBe(start.getTime() + 1_000 + 250);

    await flushQueue({ sender, onSent });
    expect(sender).toHaveBeenCalledTimes(1);

    const secondWindow = new Date(firstNext + 1);
    vi.setSystemTime(secondWindow);
    await flushQueue({ sender, onSent });

    state = await readQueueState();
    expect(sender).toHaveBeenCalledTimes(2);
    expect(sender.mock.calls[1]?.[0]?.attempts).toBe(1);
    expect(state.size).toBe(1);
    expect(state.items[0].attempts).toBe(2);
    const secondNext = new Date(state.items[0].nextAttemptAt).getTime();
    expect(secondNext).toBe(secondWindow.getTime() + 2_000 + 250);

    const finalWindow = new Date(secondNext + 1);
    vi.setSystemTime(finalWindow);
    await flushQueue({ sender, onSent });

    state = await readQueueState();
    expect(sender).toHaveBeenCalledTimes(3);
    expect(sender.mock.calls[2]?.[0]?.attempts).toBe(2);
    expect(state.size).toBe(0);
    expect(onSent).toHaveBeenCalledTimes(1);
    expect(onSent).toHaveBeenCalledWith({ patientId });
  });

  it.each([
    { status: 200, ok: false },
    { status: 201, ok: false },
    { status: 409, ok: false },
    { status: 412, ok: false },
  ])('considera entregado el bundle si HTTP %s', async ({ status, ok }) => {
    const patientId = `pat-${status}`;
    vi.setSystemTime(new Date('2025-03-01T00:00:00.000Z'));
    await enqueueTxFromValues({ patientId } as any);

    const sender = vi.fn(async () => ({ ok, status }));
    const onSent = vi.fn();

    await flushQueue({ sender, onSent });

    const state = await readQueueState();
    expect(state.size).toBe(0);
    expect(sender).toHaveBeenCalledTimes(1);
    expect(onSent).toHaveBeenCalledTimes(1);
    expect(onSent).toHaveBeenCalledWith({ patientId });
  });
});
