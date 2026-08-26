import { describe, expect, it, vi } from 'vitest';

vi.mock('@/src/lib/crypto', () => ({
  encryptOfflinePayload: vi.fn(async (value: string) => `encrypted:${value}`),
  decryptOfflinePayload: vi.fn(async (value: string) => value.replace(/^encrypted:/, '')),
}));

import { DEMO_ACTORS } from '@/src/demo/fixtures';
import { createExceptionReviewEvent, createHandoffOverride } from '../exception-handover';
import {
  createEmptyExceptionHandoverState,
  createExceptionHandoverStorage,
  type ExceptionHandoverSessionState,
} from '../exception-handover-storage';

const SHIFT = 'demo-shift';
const NOW = '2026-08-27T08:15:00.000Z';

function memoryAdapter() {
  const values = new Map<string, string>();
  return {
    getItem: vi.fn(async (key: string) => values.get(key) ?? null),
    setItem: vi.fn(async (key: string, value: string) => { values.set(key, value); }),
    removeItem: vi.fn(async (key: string) => { values.delete(key); }),
  };
}

describe('exception handoff encrypted persistence', () => {
  it('resumes after restart and keeps retry/idempotent events once', async () => {
    const adapter = memoryAdapter();
    const event = createExceptionReviewEvent('critical_check_back', DEMO_ACTORS[1], NOW, 'patient-1', {
      shiftId: SHIFT,
      criticalPoints: ['Riesgo y nivel de observación'],
    });
    const first = createExceptionHandoverStorage('test:exception', adapter);
    const state: ExceptionHandoverSessionState = {
      ...createEmptyExceptionHandoverState(SHIFT),
      events: [event, event],
      interactionCounts: { 'patient-1': 5 },
    };
    await first.save(state);

    const restarted = createExceptionHandoverStorage('test:exception', adapter);
    await restarted.save(state);
    const loaded = await restarted.load(SHIFT);

    expect(loaded.events).toEqual([event]);
    expect(loaded.interactionCounts).toEqual({ 'patient-1': 5 });
  });

  it('does not duplicate overrides and isolates the next shift', async () => {
    const adapter = memoryAdapter();
    const storage = createExceptionHandoverStorage('test:override', adapter);
    const override = createHandoffOverride({
      patientId: 'patient-r', previousLane: 'R', newLane: 'B', reason: 'Revisión manual realizada',
      professional: DEMO_ACTORS[0], shiftId: SHIFT, recordedAt: NOW,
      sourceStatuses: { 'direct-assessment': 'missing' },
    });
    await storage.save({ ...createEmptyExceptionHandoverState(SHIFT), overrides: [override, override] });

    expect((await storage.load(SHIFT)).overrides).toEqual([override]);
    expect(await storage.load('next-shift')).toEqual(createEmptyExceptionHandoverState('next-shift'));
  });

  it('persists a degraded transfer once and clears it explicitly', async () => {
    const adapter = memoryAdapter();
    const storage = createExceptionHandoverStorage('test:degraded', adapter);
    const degradedTransfer = {
      priorityPatientIds: ['patient-a'], changedPatientIds: ['patient-b'], criticalPendings: ['Reevaluar'],
      receiverId: DEMO_ACTORS[1].userId, recordedAt: NOW,
    };
    await storage.save({ ...createEmptyExceptionHandoverState(SHIFT), degradedTransfer });
    expect((await storage.load(SHIFT)).degradedTransfer).toEqual(degradedTransfer);

    await storage.clear();
    expect(await storage.load(SHIFT)).toEqual(createEmptyExceptionHandoverState(SHIFT));
  });
});
