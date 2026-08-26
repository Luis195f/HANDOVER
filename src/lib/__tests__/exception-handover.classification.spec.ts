import { describe, expect, it } from 'vitest';

import { DEMO_ACTORS, DEMO_EXCEPTION_HANDOVER_PATIENTS } from '@/src/demo/fixtures';
import {
  appendUniqueExceptionEvent,
  appendUniqueOverride,
  assessHandoffClosure,
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
    expect(assessHandoffClosure([r], [], 'degraded')).toMatchObject({ canClose: false });

    const transferred = createExceptionReviewEvent('r_transferred', DEMO_ACTORS[1], NOW, r.patientId, {
      reason: r.reasons[0],
      targetAt: '2026-08-27T09:00:00.000Z',
      receiverId: DEMO_ACTORS[1].userId,
    });
    expect(assessHandoffClosure([r], [transferred], 'degraded')).toEqual({ canClose: true, blockingReasons: [] });
  });

  it('requires all three unit-level degraded acknowledgements without inventing patient data', () => {
    const incident = createExceptionReviewEvent('unit_incident_acknowledgement', DEMO_ACTORS[0], NOW);
    const outgoing = createExceptionReviewEvent('degraded_outgoing_transfer', DEMO_ACTORS[0], NOW);
    const incoming = createExceptionReviewEvent('degraded_incoming_acknowledgement', DEMO_ACTORS[1], NOW);

    expect(assessHandoffClosure([], [incident, outgoing], 'unavailable').canClose).toBe(false);
    expect(assessHandoffClosure([], [incident, outgoing, incoming], 'unavailable')).toEqual({
      canClose: true,
      blockingReasons: [],
    });
    expect(validateDegradedUnitTransfer({
      priorityPatientIds: [],
      changedPatientIds: [],
      criticalPendings: [],
      receiverId: DEMO_ACTORS[1].userId,
      recordedAt: NOW,
    })).toBe(true);
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
