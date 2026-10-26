import { describe, expect, it, vi } from 'vitest';
import * as encryptedStorage from '../encryptedStorage';

vi.mock('@/src/lib/crypto', () => ({
  encryptOfflinePayload: vi.fn(async (value: string) => `encrypted:${value}`),
  decryptOfflinePayload: vi.fn(async (value: string) => value.replace(/^encrypted:/, '')),
}));

import { DEMO_ACTORS, DEMO_EXCEPTION_HANDOVER_PATIENTS } from '@/src/demo/fixtures';
import { acceptComparableManifest, buildComparableSnapshot, createExceptionReviewEvent, createHandoffOverride, freezeComparableManifest, selectAcceptedComparableReference } from '../exception-handover';
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
  it('retains only an explicitly accepted manifest across shifts, without renewing expiry', async () => {
    const patient = DEMO_EXCEPTION_HANDOVER_PATIENTS[3];
    const sourceEvidence = {
      'direct-assessment': { status: 'current' as const, observedAt: '2026-08-27T08:00:00.000Z', reference: 'synthetic:assessment:1', patientId: patient.patientId, unitId: 'unit-a' },
      'care-plan': { status: 'current' as const, observedAt: '2026-08-27T08:00:00.000Z', reference: 'synthetic:plan:1', patientId: patient.patientId, unitId: 'unit-a' },
    };
    const snapshot = buildComparableSnapshot({ ...patient, sourceEvidence }, 'unit-a', NOW);
    const context = { key: 'group-a', revision: 1, shiftId: patient.shiftId! };
    const frozen = freezeComparableManifest(context, [snapshot]);
    const outgoing = createExceptionReviewEvent('outgoing_transfer', DEMO_ACTORS[0], NOW, undefined, { shiftId: context.shiftId, context, manifestHash: frozen.hash });
    const incoming = createExceptionReviewEvent('incoming_attestation', DEMO_ACTORS[1], NOW, undefined,
      { shiftId: context.shiftId, context, acknowledgesKey: outgoing.idempotencyKey, manifestHash: frozen.hash });
    const accepted = acceptComparableManifest(frozen, [snapshot], outgoing, incoming);
    const adapter = memoryAdapter();
    const first = createExceptionHandoverStorage('synthetic:reference', adapter, () => NOW);
    await first.save({ ...createEmptyExceptionHandoverState(context.shiftId), acceptedReferences: [accepted] });
    const next = await createExceptionHandoverStorage('synthetic:reference', adapter, () => NOW).load('next-shift');
    expect(next.acceptedReferences).toEqual([accepted]);
    expect(next.events).toEqual([]);
    expect(next.acceptedReferences[0]?.expiresAt).toBe(accepted.expiresAt);
    const otherPatient = { ...patient, patientId: 'synthetic-other' };
    const other = buildComparableSnapshot({ ...otherPatient, sourceEvidence: {
      'direct-assessment': { ...sourceEvidence['direct-assessment'], patientId: otherPatient.patientId, unitId: 'unit-b' },
      'care-plan': { ...sourceEvidence['care-plan'], patientId: otherPatient.patientId, unitId: 'unit-b' },
    } }, 'unit-b', NOW);
    const otherContext = { key: 'group-b', revision: 1, shiftId: context.shiftId };
    const otherManifest = freezeComparableManifest(otherContext, [other]);
    const otherOutgoing = createExceptionReviewEvent('outgoing_transfer', DEMO_ACTORS[0], NOW, undefined,
      { shiftId: context.shiftId, context: otherContext, manifestHash: otherManifest.hash });
    const otherIncoming = createExceptionReviewEvent('incoming_attestation', DEMO_ACTORS[1], NOW, undefined,
      { shiftId: context.shiftId, context: otherContext, manifestHash: otherManifest.hash,
        acknowledgesKey: otherOutgoing.idempotencyKey });
    await first.save({ ...createEmptyExceptionHandoverState(context.shiftId), acceptedReferences: [
      acceptComparableManifest(otherManifest, [other], otherOutgoing, otherIncoming),
    ] });
    const both = await first.load(context.shiftId);
    expect(selectAcceptedComparableReference(both.acceptedReferences, patient.patientId, 'unit-a')).toEqual(accepted);
    expect(selectAcceptedComparableReference(both.acceptedReferences, otherPatient.patientId, 'unit-b')).not.toBeNull();
    const newerContext = { ...otherContext, key: 'group-b-updated', revision: 2 };
    const newerManifest = freezeComparableManifest(newerContext, [other]);
    const newerOutgoing = createExceptionReviewEvent('outgoing_transfer', DEMO_ACTORS[0],
      '2026-08-27T08:16:00.000Z', undefined,
      { shiftId: context.shiftId, context: newerContext, manifestHash: newerManifest.hash });
    const newerIncoming = createExceptionReviewEvent('incoming_attestation', DEMO_ACTORS[1],
      '2026-08-27T08:16:00.000Z', undefined,
      { shiftId: context.shiftId, context: newerContext, manifestHash: newerManifest.hash,
        acknowledgesKey: newerOutgoing.idempotencyKey });
    await first.save({ ...createEmptyExceptionHandoverState(context.shiftId), acceptedReferences: [
      acceptComparableManifest(newerManifest, [other], newerOutgoing, newerIncoming),
    ] });
    const compacted = await first.load(context.shiftId);
    expect(compacted.acceptedReferences).toHaveLength(2);
    expect(selectAcceptedComparableReference(compacted.acceptedReferences, patient.patientId, 'unit-a')).toEqual(accepted);
    const expiring = createExceptionHandoverStorage('synthetic:reference', adapter,
      () => '2026-08-29T08:15:00.000Z');
    const before = await adapter.getItem('synthetic:reference');
    adapter.setItem.mockRejectedValueOnce(new Error('synthetic storage unavailable'));
    await expect(expiring.load('next-shift')).rejects.toThrow('synthetic storage unavailable');
    expect(await adapter.getItem('synthetic:reference')).toBe(before);
    expect((await expiring.load('next-shift')).acceptedReferences).toEqual([]);
    expect(await adapter.getItem('synthetic:reference')).not.toBe(before);
  });
  it('does not present unavailable evidence as an empty C06 context', async () => {
    vi.spyOn(encryptedStorage, 'getAsyncStorageAdapter').mockResolvedValue(null);
    const storage = createExceptionHandoverStorage('synthetic:unavailable');
    await expect(storage.load(SHIFT)).rejects.toThrow('EXCEPTION_HANDOVER_STORAGE_UNAVAILABLE');
    await expect(storage.save(createEmptyExceptionHandoverState(SHIFT))).rejects.toThrow('EXCEPTION_HANDOVER_STORAGE_UNAVAILABLE');
    await expect(storage.clear()).rejects.toThrow('EXCEPTION_HANDOVER_STORAGE_UNAVAILABLE');
    vi.restoreAllMocks();
  });
  it('does not overwrite corrupt evidence with an empty session', async () => {
    const adapter = memoryAdapter();
    await adapter.setItem('test:corrupt', '{broken');
    const storage = createExceptionHandoverStorage('test:corrupt', adapter);
    await expect(storage.load(SHIFT)).rejects.toThrow();
    await expect(storage.save(createEmptyExceptionHandoverState(SHIFT))).rejects.toThrow();
    expect(await adapter.getItem('test:corrupt')).toBe('{broken');
  });
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

  it('keeps the newest technical context revision while retaining legacy events as history', async () => {
    const adapter = memoryAdapter();
    const storage = createExceptionHandoverStorage('test:context', adapter);
    const legacy = createExceptionReviewEvent('unchanged_group_review', DEMO_ACTORS[0], NOW, undefined,
      { shiftId: SHIFT });
    const first = { ...createEmptyExceptionHandoverState(SHIFT),
      activeContext: { key: 'group-a', revision: 1, shiftId: SHIFT }, events: [legacy] };
    const later = { ...first, activeContext: { key: 'group-b', revision: 2, shiftId: SHIFT } };
    await Promise.all([storage.save(first), storage.save(later)]);
    await storage.save(first);
    const loaded = await storage.load(SHIFT);
    expect(loaded.activeContext).toEqual(later.activeContext);
    expect(loaded.events).toContainEqual(legacy);
  });
});
