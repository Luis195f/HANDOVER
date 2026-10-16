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
