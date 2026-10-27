import { describe, expect, it } from 'vitest';

import { DEMO_ACTORS, DEMO_EXCEPTION_HANDOVER_PATIENTS } from '@/src/demo/fixtures';
import {
  appendUniqueExceptionEvent,
  appendUniqueOverride,
  assessHandoffClosure,
  buildExceptionHandoverContextKey,
  assessUnitDataHealth,
  calculateCheckBackMetrics,
  calculateRMetrics,
  classifyExceptionHandoverPatient,
  classifyExceptionHandoverUnit,
  buildComparableSnapshot,
  compareAcceptedSnapshot,
  freezeComparableManifest,
  acceptComparableManifest,
  createExceptionReviewEvent,
  createHandoffOverride,
  getPatientTransferStatus,
  isInteractionBudgetExceeded,
  validateDegradedUnitTransfer,
  type ExceptionPatientClassificationInput,
} from '../exception-handover';

const NOW = '2026-08-27T08:15:00.000Z';
const SHIFT = 'demo-2026-08-27-morning';
const context = { key: 'group-one', revision: 1, shiftId: SHIFT };

const fixture = (patientId: string) => {
  const patient = DEMO_EXCEPTION_HANDOVER_PATIENTS.find((candidate) => candidate.patientId === patientId);
  if (!patient) throw new Error(`Missing fixture ${patientId}`);
  return patient;
};

const classify = (patient: ExceptionPatientClassificationInput) =>
  classifyExceptionHandoverPatient(patient, { now: NOW, shiftId: SHIFT });

describe('behavioral-health exception classification', () => {
  it('requires accepted, source-backed history instead of the fixture status', () => {
    const patient = fixture('demo-psych-adult-002');
    const current = buildComparableSnapshot({ ...patient, status: 'unchanged' }, 'unit-a', NOW);
    expect(compareAcceptedSnapshot(current, null, NOW).handoffLane).toBe('R');
    expect(current.sources['direct-assessment'].availability).not.toBe('current');
  });
  it('compares only accepted covered clinical fields, not source references or object key order', () => {
    const base = fixture('demo-psych-adult-002');
    const patient = { ...base, plan: { requiresDirectAssessment: true },
      sourceEvidence: {
        'direct-assessment': { status: 'current' as const, observedAt: '2026-08-27T08:00:00.000Z', reference: 'synthetic:assessment:1', patientId: base.patientId, unitId: 'unit-a' },
        'care-plan': { status: 'current' as const, observedAt: '2026-08-27T08:00:00.000Z', reference: 'synthetic:plan:1', patientId: base.patientId, unitId: 'unit-a' },
      } };
    const first = buildComparableSnapshot(patient, 'unit-a', NOW);
    const context = { key: 'group-a', revision: 1, shiftId: patient.shiftId! };
    const frozen = freezeComparableManifest(context, [first]);
    const outgoing = createExceptionReviewEvent('outgoing_transfer', DEMO_ACTORS[0], NOW, undefined, { shiftId: context.shiftId, context, manifestHash: frozen.hash });
    const incoming = createExceptionReviewEvent('incoming_attestation', DEMO_ACTORS[1], NOW, undefined,
      { shiftId: context.shiftId, context, acknowledgesKey: outgoing.idempotencyKey, manifestHash: frozen.hash });
    const accepted = acceptComparableManifest(frozen, [first], outgoing, incoming);
    const later = '2026-08-27T09:15:00.000Z';
    const second = buildComparableSnapshot({ ...patient, shiftId: 'next-shift',
      sourceEvidence: {
        'direct-assessment': { status: 'current', observedAt: later, reference: 'synthetic:assessment:2', patientId: base.patientId, unitId: 'unit-a' },
        'care-plan': { status: 'current', observedAt: later, reference: 'synthetic:plan:2', patientId: base.patientId, unitId: 'unit-a' },
      } }, 'unit-a', later);
    expect(compareAcceptedSnapshot(second, accepted, later).handoffLane).toBe('C');
    expect(compareAcceptedSnapshot(buildComparableSnapshot({ ...patient, shiftId: 'next-shift',
      plan: { requiresDirectAssessment: false }, sourceEvidence: {
        'direct-assessment': { status: 'current', observedAt: later, reference: 'synthetic:assessment:2', patientId: base.patientId, unitId: 'unit-a' },
        'care-plan': { status: 'current', observedAt: later, reference: 'synthetic:plan:2', patientId: base.patientId, unitId: 'unit-a' },
      } }, 'unit-a', later), accepted, later).handoffLane).toBe('B');
    expect(compareAcceptedSnapshot(second, accepted, '2026-08-29T08:15:00.000Z').handoffLane).toBe('R');
    expect(compareAcceptedSnapshot({ ...second, unitId: 'unit-b' }, accepted, later).handoffLane).toBe('R');
    expect(compareAcceptedSnapshot({ ...second, sources: { ...second.sources,
      'care-plan': { ...second.sources['care-plan']!, availability: 'missing' } } }, accepted, later).handoffLane).toBe('R');
    expect(() => acceptComparableManifest(frozen, [second], outgoing, incoming)).toThrow();
  });
  it('rejects missing, stale, contradictory, future, incompatible and unaccepted comparison evidence', () => {
    const base = fixture('demo-psych-adult-002');
    const patient = { ...base, plan: { requiresMedicationVerification: false }, sourceEvidence: {
      'direct-assessment': { status: 'current' as const, observedAt: '2026-08-27T08:00:00.000Z', reference: 'assessment:1', patientId: base.patientId, unitId: 'unit-a' },
      'care-plan': { status: 'current' as const, observedAt: '2026-08-27T08:00:00.000Z', reference: 'plan:1', patientId: base.patientId, unitId: 'unit-a' },
    } };
    const first = buildComparableSnapshot(patient, 'unit-a', NOW);
    const frozen = freezeComparableManifest(context, [first]);
    const outgoing = createExceptionReviewEvent('outgoing_transfer', DEMO_ACTORS[0], NOW, undefined,
      { shiftId: SHIFT, context, manifestHash: frozen.hash });
    const incoming = createExceptionReviewEvent('incoming_attestation', DEMO_ACTORS[1], NOW, undefined,
      { shiftId: SHIFT, context, manifestHash: frozen.hash, acknowledgesKey: outgoing.idempotencyKey });
    const accepted = acceptComparableManifest(frozen, [first], outgoing, incoming);
    const later = '2026-08-27T09:15:00.000Z';
    const evidence = { 'direct-assessment': { status: 'current' as const, observedAt: later, reference: 'assessment:2', patientId: base.patientId, unitId: 'unit-a' },
      'care-plan': { status: 'current' as const, observedAt: later, reference: 'plan:2', patientId: base.patientId, unitId: 'unit-a' } };
    const next = buildComparableSnapshot({ ...patient, shiftId: 'next-shift', sourceEvidence: evidence }, 'unit-a', later);
    const lane = (snapshot: typeof next, reference = accepted, clock = later) =>
      compareAcceptedSnapshot(snapshot, reference, clock).handoffLane;
    expect(lane(next)).toBe('C');
    expect(lane(next, { ...accepted, snapshots: [] })).toBe('R');
    expect(lane(next, { ...accepted, version: 1, expiresAt: later })).toBe('R');
    expect(lane({ ...next, patientId: 'other' })).toBe('R');
    expect(lane({ ...next, unitId: 'other' })).toBe('R');
    expect(lane({ ...next, sources: { ...next.sources, 'care-plan': { ...next.sources['care-plan']!, coverage: [] } } })).toBe('R');
    expect(lane({ ...next, sources: { ...next.sources, 'care-plan': { ...next.sources['care-plan']!, version: 'v2' } } })).toBe('R');
    expect(lane({ ...next, sources: { ...next.sources, 'care-plan': { ...next.sources['care-plan']!, observedAt: '2026-08-27T08:10:00.000Z' } } })).toBe('R');
    expect(lane({ ...next, sources: { ...next.sources, 'care-plan': { ...next.sources['care-plan']!, observedAt: '2026-08-27T10:00:00.000Z' } } })).toBe('R');
    expect(buildComparableSnapshot({ ...patient, sourceEvidence: { ...patient.sourceEvidence,
      'direct-assessment': { ...evidence['direct-assessment'], coherent: false } } }, 'unit-a', later)
      .sources['direct-assessment']?.availability).toBe('missing');
    expect(buildComparableSnapshot({ ...patient, sourceEvidence: { ...patient.sourceEvidence,
      'direct-assessment': { ...evidence['direct-assessment'], unitId: 'unit-b' } } }, 'unit-a', later)
      .sources['direct-assessment']?.availability).toBe('missing');
    expect(buildComparableSnapshot({ ...patient, sourceEvidence: { ...patient.sourceEvidence,
      'direct-assessment': { ...evidence['direct-assessment'], status: 'unavailable' } } }, 'unit-a', later)
      .sources['direct-assessment']?.availability).toBe('unavailable');
    expect(buildComparableSnapshot({ ...patient, sourceEvidence: evidence }, 'unit-a', later, undefined,
      { 'direct-assessment': 'unavailable' }).sources['direct-assessment']?.availability).toBe('unavailable');
    expect(buildComparableSnapshot({ ...patient, sourceEvidence: { ...patient.sourceEvidence,
      'direct-assessment': { ...evidence['direct-assessment'], observedAt: '2026-08-27T00:00:00.000Z' } } }, 'unit-a', later)
      .sources['direct-assessment']?.availability).toBe('stale');
    expect(() => acceptComparableManifest(frozen, [first],
      { ...outgoing, manifestHash: undefined }, incoming)).toThrow();
  });
  it('keeps fixture critical/changed statuses in R until a contextual human A designation', () => {
    const patient = fixture('demo-psych-adult-001');
    const candidate = { unitId: 'unit-a', scopeKey: 'scope-a', acceptedReference: null };
    expect(classifyExceptionHandoverPatient(patient, { now: NOW, shiftId: SHIFT, candidate }).handoffLane).toBe('R');
    expect(classifyExceptionHandoverPatient({ ...patient, status: 'changed' },
      { now: NOW, shiftId: SHIFT, candidate }).handoffLane).toBe('R');
    const designation = createHandoffOverride({ patientId: patient.patientId, previousLane: 'R', newLane: 'A',
      professional: DEMO_ACTORS[0], reason: 'Designación humana sintética con motivo', shiftId: SHIFT,
      recordedAt: NOW, sourceStatuses: {}, scopeKey: candidate.scopeKey });
    expect(classifyExceptionHandoverPatient({ ...patient, previousOverrides: [designation] },
      { now: NOW, shiftId: SHIFT, candidate })).toMatchObject({ handoffLane: 'A', classifiedBy: 'human', overrideReason: designation.reason });
    expect(classifyExceptionHandoverPatient({ ...patient, previousOverrides: [designation] },
      { now: NOW, shiftId: SHIFT, candidate: { ...candidate, scopeKey: 'different-context' } }).handoffLane).toBe('R');
    expect(classifyExceptionHandoverPatient({ ...patient, previousOverrides: [{ ...designation, newLane: 'B' }] },
      { now: NOW, shiftId: SHIFT, candidate }).handoffLane).toBe('R');
    const later = '2026-08-27T09:00:00.000Z';
    const laterDesignation = { ...designation, recordedAt: later };
    expect(classifyExceptionHandoverPatient({ ...patient, previousOverrides: [laterDesignation] },
      { now: NOW, shiftId: SHIFT, candidate, overrideAsOf: later }).handoffLane).toBe('A');
    expect(classifyExceptionHandoverPatient({ ...patient, previousOverrides: [laterDesignation] },
      { now: NOW, shiftId: SHIFT, candidate, overrideAsOf: NOW }).handoffLane).toBe('R');
    expect(classifyExceptionHandoverPatient({ ...patient, previousOverrides: [{ ...laterDesignation, reason: ' ' }] },
      { now: NOW, shiftId: SHIFT, candidate, overrideAsOf: later }).handoffLane).toBe('R');
    expect(classifyExceptionHandoverPatient({ ...patient, previousOverrides: [{ ...laterDesignation, shiftId: 'other' }] },
      { now: NOW, shiftId: SHIFT, candidate, overrideAsOf: later }).handoffLane).toBe('R');
  });
  it('requires clinical values rather than observation metadata and hashes only comparable values', () => {
    const base = fixture('demo-psych-adult-002');
    const sourceEvidence = { 'observation-record': { status: 'current' as const,
      reference: 'synthetic:observation:1', patientId: base.patientId, unitId: 'unit-a', observedAt: NOW } };
    const source = (vitals: typeof base.vitals, oxygenTherapy?: { flowLMin?: number; fio2?: number }) =>
      buildComparableSnapshot({ ...base, observationLevel: 'enhanced', sourceEvidence, vitals, oxygenTherapy },
        'unit-a', NOW).sources['observation-record'];
    for (const vitals of [{}, { rr: undefined }, { rr: undefined, recordedAt: NOW },
      { rr: undefined, issuedAt: NOW }, { rr: undefined, recordedAt: NOW, issuedAt: NOW }]) {
      expect(source(vitals)?.availability).toBe('missing');
    }
    const clinical = source({ rr: 16, recordedAt: NOW });
    expect(clinical?.availability).toBe('current');
    expect(clinical?.contentHash).toBe(source({ rr: 16, issuedAt: '2026-08-27T08:10:00.000Z' })?.contentHash);
    expect(source({ rr: undefined, o2: false }, { flowLMin: 0, fio2: 21 })?.availability).toBe('current');
    expect(source({}, { flowLMin: 0 })?.availability).toBe('current');
  });
  it('projects temperature and oxygen with the existing selectors without treating empty vitals as evidence', () => {
    const base = fixture('demo-psych-adult-002');
    const sourceEvidence = { 'observation-record': { status: 'current' as const,
      reference: 'synthetic:observation:1', patientId: base.patientId, unitId: 'unit-a', observedAt: NOW } };
    const patient = { ...base, observationLevel: 'enhanced' as const, sourceEvidence,
      vitals: { rr: 16, tempC: 37, temp: 39, o2: true }, oxygenTherapy: { fio2: 21 } };
    const source = (input: typeof patient) => buildComparableSnapshot(input, 'unit-a', NOW)
      .sources['observation-record'];
    expect(source(patient)?.availability).toBe('current');
    expect(source({ ...patient, vitals: { ...patient.vitals, temp: 35, o2: false } })?.contentHash)
      .toBe(source(patient)?.contentHash);
    expect(source({ ...patient, oxygenTherapy: { fio2: 28 } })?.contentHash)
      .not.toBe(source(patient)?.contentHash);
    expect(source({ ...patient, vitals: {}, oxygenTherapy: {} })?.availability).toBe('missing');
  });
  it('preserves baseline A/B and keeps current baseline C in C', () => {
    const classifications = DEMO_EXCEPTION_HANDOVER_PATIENTS.map(classify);

    expect(classifications.filter(({ handoffLane }) => handoffLane === 'A').map(({ patientId }) => patientId)).toEqual([
      'demo-psych-adult-001',
      'demo-psych-udcc-001',
    ]);
    expect(classifications.filter(({ handoffLane }) => handoffLane === 'B').map(({ patientId }) => patientId)).toEqual([
      'demo-psych-child-001',
      'demo-psych-unit-005',
      'demo-psych-unit-006',
      'demo-psych-unit-007',
      'demo-psych-unit-008',
      'demo-psych-unit-009',
    ]);
    expect(classify(fixture('demo-psych-adult-002'))).toMatchObject({
      clinicalStatus: 'stable',
      handoffLane: 'C',
      classifiedBy: 'rule',
      reasons: ['Sin novedades confirmadas con datos esperados vigentes'],
    });
  });

  it.each([
    ['missing', 'Valoración directa esperada ausente'],
    ['stale', 'Valoración directa requerida vencida'],
  ] as const)('moves baseline C to R when an expected source is %s', (status, reason) => {
    const patient = fixture('demo-psych-adult-002');
    const classification = classify({
      ...patient,
      sourceEvidence: {
        ...patient.sourceEvidence,
        'direct-assessment': { status, observedAt: status === 'stale' ? '2026-08-26T00:00:00.000Z' : undefined },
      },
    });

    expect(classification.handoffLane).toBe('R');
    expect(classification.reasons).toContain(reason);
    expect(classification.sourceStatuses['direct-assessment']).toBe(status);
  });

  it('does not create R when a non-required profile source is missing', () => {
    const patient = fixture('demo-psych-adult-002');
    const classification = classify({
      ...patient,
      observationLevel: 'routine',
      activeRisks: [],
      plan: { requiresDirectAssessment: true, requiresMedicationVerification: false },
      sourceEvidence: {
        ...patient.sourceEvidence,
        'medication-administration': { status: 'missing' },
      },
    });

    expect(classification.handoffLane).toBe('C');
    expect(classification.sourceStatuses).not.toHaveProperty('medication-administration');
  });

  it('moves only dependent baseline-C patients to R during a partial source failure', () => {
    const result = classifyExceptionHandoverUnit(DEMO_EXCEPTION_HANDOVER_PATIENTS, {
      now: NOW,
      integration: {
        availability: 'partial',
        sourceStatuses: { 'observation-record': 'unavailable' },
        failureStartedAt: '2026-08-27T08:00:00.000Z',
      },
    });
    const byId = new Map(result.classifications.map((classification) => [classification.patientId, classification]));

    expect(result.unitDataHealth.status).toBe('degraded');
    expect(byId.get('demo-psych-unit-010')?.handoffLane).toBe('R');
    expect(byId.get('demo-psych-unit-011')?.handoffLane).toBe('C');
    expect(byId.get('demo-psych-adult-001')?.handoffLane).toBe('A');
    expect(byId.get('demo-psych-child-001')?.handoffLane).toBe('B');
  });

  it('suspends total classification for 80 patients without creating 80 R cards', () => {
    const eighty = Array.from({ length: 80 }, (_, index) => ({
      ...fixture('demo-psych-adult-002'),
      patientId: `synthetic-${index + 1}`,
    }));
    const lastKnown = eighty.map((patient) => classify(patient));
    const result = classifyExceptionHandoverUnit(eighty, {
      now: NOW,
      integration: { availability: 'unavailable', failureStartedAt: NOW },
      lastKnownClassifications: lastKnown,
    });

    expect(result.unitDataHealth).toMatchObject({
      status: 'unavailable',
      reason: 'Clasificación automática suspendida: fuente clínica no disponible',
    });
    expect(result.classifications).toEqual([]);
    expect(result.lastKnownClassifications).toHaveLength(80);
    expect(result.lastKnownClassifiedAt).toBe(NOW);
    expect(result.automaticClassificationSuspended).toBe(true);
  });

  it('requires explicit stable recovery instead of oscillating to healthy', () => {
    const classifications = DEMO_EXCEPTION_HANDOVER_PATIENTS.map(classify);
    const pending = assessUnitDataHealth(classifications, {
      availability: 'available',
      stableSince: '2026-08-27T08:05:00.000Z',
    }, { now: NOW, previousStatus: 'degraded' });
    const recovered = assessUnitDataHealth(classifications, {
      availability: 'available',
      recoveryConfirmedAt: '2026-08-27T08:14:00.000Z',
      stableSince: '2026-08-27T07:55:00.000Z',
    }, { now: NOW, previousStatus: 'degraded' });

    expect(pending.status).toBe('degraded');
    expect(pending.reason).toContain('pendiente');
    expect(recovered.status).toBe('healthy');
  });

  it('never exposes technical source keys in clinical reasons', () => {
    const patient = fixture('demo-psych-adult-002');
    const classification = classify({
      ...patient,
      sourceEvidence: { ...patient.sourceEvidence, 'direct-assessment': { status: 'missing' } },
    });

    expect(classification.reasons.join(' ')).not.toMatch(/MISSING_|direct-assessment|SOURCE_/);
  });
});

describe('overrides, check-back, R governance and closure', () => {
  it('requires an override reason and recalculates on the next shift', () => {
    const patient = fixture('demo-psych-adult-002');
    const missing = classify({
      ...patient,
      sourceEvidence: { ...patient.sourceEvidence, 'direct-assessment': { status: 'missing' } },
    });
    expect(() => createHandoffOverride({
      patientId: patient.patientId,
      previousLane: 'R',
      newLane: 'B',
      reason: '  ',
      professional: DEMO_ACTORS[0],
      shiftId: SHIFT,
      recordedAt: NOW,
      sourceStatuses: missing.sourceStatuses,
    })).toThrow('motivo clínico');

    const override = createHandoffOverride({
      patientId: patient.patientId,
      previousLane: 'R',
      newLane: 'B',
      reason: 'Valoración manual directa realizada durante el relevo',
      professional: DEMO_ACTORS[0],
      shiftId: SHIFT,
      recordedAt: NOW,
      sourceStatuses: missing.sourceStatuses,
    });
    expect(appendUniqueOverride([override], override)).toHaveLength(1);

    const current = classify({
      ...patient,
      sourceEvidence: { ...patient.sourceEvidence, 'direct-assessment': { status: 'missing' } },
      previousOverrides: [override],
    });
    const next = classifyExceptionHandoverPatient({
      ...patient,
      sourceEvidence: { ...patient.sourceEvidence, 'direct-assessment': { status: 'missing' } },
      previousOverrides: [override],
    }, { now: '2026-08-27T16:15:00.000Z', shiftId: 'demo-2026-08-27-afternoon' });

    expect(current).toMatchObject({ handoffLane: 'B', classifiedBy: 'human', overrideReason: override.reason });
    expect(next).toMatchObject({ handoffLane: 'R', classifiedBy: 'rule', previousOverride: override });
  });

  it('keeps A pending until incoming check-back and deduplicates retries', () => {
    const classification = classify(fixture('demo-psych-adult-001'));
    const checkBack = createExceptionReviewEvent(
      'critical_check_back', DEMO_ACTORS[1], NOW, classification.patientId, {
        shiftId: SHIFT,
        criticalPoints: ['Riesgo y nivel de observación'],
      },
    );

    expect(getPatientTransferStatus(classification.patientId, [])).toBe('pending-acknowledgement');
    expect(getPatientTransferStatus(classification.patientId, [checkBack])).toBe('completed');
    expect(checkBack.criticalPoints).toEqual(['Riesgo y nivel de observación']);
    expect(() => createExceptionReviewEvent(
      'critical_check_back', DEMO_ACTORS[1], NOW, classification.patientId, { shiftId: SHIFT },
    )).toThrow('entre uno y tres');
    expect(appendUniqueExceptionEvent([checkBack], checkBack)).toHaveLength(1);
  });

  it('reports check-back and R metrics without counting R as C', () => {
    const patient = fixture('demo-psych-adult-002');
    const r = classify({
      ...patient,
      sourceEvidence: { ...patient.sourceEvidence, 'direct-assessment': { status: 'missing' } },
    });
    const a = classify(fixture('demo-psych-adult-001'));
    const clarification = createExceptionReviewEvent('critical_clarification', DEMO_ACTORS[1], NOW, a.patientId);
    const transferred = createExceptionReviewEvent('r_transferred', DEMO_ACTORS[1], NOW, r.patientId, {
      reason: r.reasons[0], targetAt: '2026-08-27T09:00:00.000Z', receiverId: DEMO_ACTORS[1].userId,
    });

    expect(calculateCheckBackMetrics([a], [clarification])).toEqual({
      requiredCheckBacks: 1,
      completedCheckBacks: 0,
      pendingCheckBacks: 1,
      bypassCount: 0,
      bypassRate: 0,
      clarificationCount: 1,
    });
    expect(calculateRMetrics([r, a], [transferred], NOW)).toMatchObject({
      countR: 1,
      ratioR: 0.5,
      affectedSources: ['direct-assessment'],
      transferredUnresolvedR: 1,
    });
  });

  it('blocks hidden R and permits explicit incomplete transfer acknowledged by receiver', () => {
    const patient = fixture('demo-psych-adult-002');
    const r = classify({
      ...patient,
      sourceEvidence: { ...patient.sourceEvidence, 'direct-assessment': { status: 'missing' } },
    });
    expect(assessHandoffClosure([r], [], 'degraded', context)).toMatchObject({ canClose: false });

    const transferred = createExceptionReviewEvent('r_transferred', DEMO_ACTORS[1], NOW, r.patientId, {
      reason: r.reasons[0],
      targetAt: '2026-08-27T09:00:00.000Z',
      receiverId: DEMO_ACTORS[1].userId,
    });
    expect(assessHandoffClosure([r], [{ ...transferred, context }], 'degraded', context)).toEqual({ canClose: true, blockingReasons: [] });
  });

  it('requires all three unit-level degraded acknowledgements without inventing patient data', () => {
    const incident = createExceptionReviewEvent('unit_incident_acknowledgement', DEMO_ACTORS[0], NOW);
    const outgoing = createExceptionReviewEvent('degraded_outgoing_transfer', DEMO_ACTORS[0], NOW);
    const incoming = createExceptionReviewEvent('degraded_incoming_acknowledgement', DEMO_ACTORS[1], NOW);

    expect(assessHandoffClosure([], [incident, outgoing], 'unavailable', context).canClose).toBe(false);
    expect(assessHandoffClosure([], [incident, outgoing, incoming], 'unavailable', context)).toEqual({
      canClose: true,
      blockingReasons: [],
    });
    expect(assessHandoffClosure([], [incident, outgoing, { ...incoming, shiftId: 'other-shift' }], 'unavailable', context).canClose).toBe(false);
    expect(validateDegradedUnitTransfer({
      priorityPatientIds: [],
      changedPatientIds: [],
      criticalPendings: [],
      receiverId: DEMO_ACTORS[1].userId,
      recordedAt: NOW,
    })).toBe(true);
  });

  it('binds closure evidence to the current group, shift and patient lanes', () => {
    const a = classify(fixture('demo-psych-adult-001'));
    const b = classify(fixture('demo-psych-child-001'));
    const c = classify(fixture('demo-psych-adult-002'));
    const r = classify({ ...fixture('demo-psych-unit-010'), sourceEvidence: {
      ...fixture('demo-psych-unit-010').sourceEvidence,
      'direct-assessment': { status: 'missing' },
    } });
    const make = (kind: Parameters<typeof createExceptionReviewEvent>[0], patientId?: string) =>
      createExceptionReviewEvent(kind, DEMO_ACTORS[1], NOW, patientId, { shiftId: SHIFT, context,
        ...(kind === 'critical_check_back' ? { criticalPoints: ['Riesgo'] } : {}),
        ...(kind === 'r_transferred' ? { reason: 'Pendiente', targetAt: NOW, receiverId: DEMO_ACTORS[1].userId } : {}),
      });
    const events = [make('critical_check_back', a.patientId), make('brief_review', b.patientId),
      make('unchanged_group_review'), make('r_transferred', r.patientId)];
    const classifications = [a, b, c, r];
    expect(assessHandoffClosure(classifications, [], 'healthy', context).blockingReasons).toHaveLength(4);
    expect(assessHandoffClosure(classifications, events, 'healthy', context).canClose).toBe(true);
    for (const event of events) {
      expect(assessHandoffClosure(classifications, events.filter((candidate) => candidate !== event), 'healthy', context).canClose).toBe(false);
      expect(assessHandoffClosure(classifications, [{ ...event, context: { key: 'other-group', revision: 1, shiftId: SHIFT } },
        ...events.filter((candidate) => candidate !== event)], 'healthy', context).canClose).toBe(false);
      expect(assessHandoffClosure(classifications, [{ ...event, shiftId: 'other-shift' },
        ...events.filter((candidate) => candidate !== event)], 'healthy', context).canClose).toBe(false);
    }
    expect(assessHandoffClosure(classifications, events.map(({ context: _context, ...event }) => event), 'healthy', context).canClose).toBe(false);
    expect(assessHandoffClosure([], [], 'healthy', context).canClose).toBe(true);
  });

  it('distinguishes view, units, members and lanes but not ordering', () => {
    const a = classify(fixture('demo-psych-adult-001'));
    const b = classify(fixture('demo-psych-child-001'));
    const members = [{ patientId: a.patientId, unitId: 'unit-a' }, { patientId: b.patientId, unitId: 'unit-b' }];
    const key = buildExceptionHandoverContextKey(SHIFT, 'all-units', members, [a, b]);
    expect(buildExceptionHandoverContextKey(SHIFT, 'all-units', [...members].reverse(), [b, a])).toBe(key);
    expect(buildExceptionHandoverContextKey(SHIFT, 'unit-a', members, [a, b])).not.toBe(key);
    expect(buildExceptionHandoverContextKey(SHIFT, 'all-units', members.slice(0, 1), [a])).not.toBe(key);
    expect(buildExceptionHandoverContextKey('other-shift', 'all-units', members, [a, b])).not.toBe(key);
    expect(buildExceptionHandoverContextKey(SHIFT, 'all-units', members, [{ ...a, handoffLane: 'B' }, b])).not.toBe(key);
    const review = classify({ ...fixture('demo-psych-adult-002'), sourceEvidence: {
      ...fixture('demo-psych-adult-002').sourceEvidence,
      'direct-assessment': { status: 'missing' },
    } });
    const reviewMembers = [{ patientId: review.patientId, unitId: 'unit-a' }];
    expect(buildExceptionHandoverContextKey(SHIFT, 'unit-a', reviewMembers, [review])).toBe(
      buildExceptionHandoverContextKey(SHIFT, 'unit-a', reviewMembers, [{ ...review,
        classifiedAt: '2026-08-27T08:30:00.000Z',
        reviewRequirements: review.reviewRequirements.map((requirement) => ({
          ...requirement, enteredAt: '2026-08-27T08:30:00.000Z',
        })),
      }]),
    );
  });

  it('requires every B, one collective C, and accepts the existing A and R alternatives', () => {
    const a = classify(fixture('demo-psych-adult-001'));
    const b = classify(fixture('demo-psych-child-001'));
    const secondB = { ...b, patientId: 'second-b' };
    const c = classify(fixture('demo-psych-adult-002'));
    const secondC = { ...c, patientId: 'second-c' };
    const r = { ...c, patientId: 'review-r', handoffLane: 'R' as const };
    const event = (kind: Parameters<typeof createExceptionReviewEvent>[0], patientId?: string) =>
      createExceptionReviewEvent(kind, DEMO_ACTORS[1], NOW, patientId, { shiftId: SHIFT, context });
    const escalation = event('critical_escalated', a.patientId);
    const firstBrief = event('brief_review', b.patientId);
    const secondBrief = event('brief_review', secondB.patientId);
    const collective = event('unchanged_group_review');
    const resolved = event('r_resolved', r.patientId);
    const group = [a, b, secondB, c, secondC, r];
    expect(assessHandoffClosure(group, [escalation, firstBrief, collective, resolved], 'healthy', context).blockingReasons)
      .toContain('Hay pacientes B sin revisión de relevo breve');
    expect(assessHandoffClosure(group, [escalation, firstBrief, secondBrief, collective, resolved], 'healthy', context))
      .toEqual({ canClose: true, blockingReasons: [] });
    expect(assessHandoffClosure(group, [escalation, firstBrief, secondBrief, resolved], 'healthy', context).canClose).toBe(false);
    expect(assessHandoffClosure([c, secondC], [collective, collective], 'healthy', context).canClose).toBe(true);
    expect(assessHandoffClosure([c], [event('unchanged_group_review', c.patientId)], 'healthy', context).canClose).toBe(false);
    expect(assessHandoffClosure([r], [event('r_transferred', r.patientId)], 'healthy', context).canClose).toBe(false);
    expect(assessHandoffClosure([a], [escalation], 'healthy', context).canClose).toBe(true);
    expect(assessHandoffClosure([], [], 'healthy', context).canClose).toBe(true);
    expect(createExceptionReviewEvent('brief_review', DEMO_ACTORS[1], NOW, b.patientId, { shiftId: SHIFT, context }).idempotencyKey)
      .not.toBe(createExceptionReviewEvent('brief_review', DEMO_ACTORS[1], NOW, b.patientId,
        { shiftId: SHIFT, context: { ...context, revision: 2 } }).idempotencyKey);
  });

  it('enforces configurable interaction budgets', () => {
    expect(isInteractionBudgetExceeded('C', 2)).toBe(false);
    expect(isInteractionBudgetExceeded('C', 3)).toBe(true);
    expect(isInteractionBudgetExceeded('B', 5)).toBe(true);
    expect(isInteractionBudgetExceeded('A', 9)).toBe(true);
    expect(isInteractionBudgetExceeded('R', 5)).toBe(true);
    expect(isInteractionBudgetExceeded('degraded', 4)).toBe(true);
  });
});
