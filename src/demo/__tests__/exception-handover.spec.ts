import { describe, expect, it } from 'vitest';

import {
  DEMO_ACTORS,
  DEMO_EXCEPTION_HANDOVER_PATIENTS,
  getDemoHandoverPrefill,
} from '../fixtures';
import {
  buildExceptionSbar,
  createExceptionReviewEvent,
  groupExceptionHandoverPatients,
} from '@/src/lib/exception-handover';

describe('synthetic exception handover fixtures', () => {
  it('preserves the golden A/B/C baseline, reasons and source order', () => {
    const baseline = DEMO_EXCEPTION_HANDOVER_PATIENTS.map((patient) => ({
      patientId: patient.patientId,
      lane: patient.status === 'critical' ? 'A' : patient.status === 'changed' ? 'B' : 'C',
      reason: patient.change,
    }));

    expect(baseline.filter(({ lane }) => lane === 'A')).toEqual([
      {
        patientId: 'demo-psych-adult-001',
        lane: 'A',
        reason: 'Cambio conductual agudo registrado durante el turno sintético.',
      },
      {
        patientId: 'demo-psych-udcc-001',
        lane: 'A',
        reason: 'Cambio conductual agudo registrado durante el turno sintético.',
      },
    ]);
    expect(baseline.filter(({ lane }) => lane === 'B')).toEqual([
      'demo-psych-child-001',
      'demo-psych-unit-005',
      'demo-psych-unit-006',
      'demo-psych-unit-007',
      'demo-psych-unit-008',
      'demo-psych-unit-009',
    ].map((patientId) => ({
      patientId,
      lane: 'B',
      reason: 'Cambio en descanso, adherencia o participación respecto al resumen sintético previo.',
    })));
    expect(baseline.filter(({ lane }) => lane === 'C')).toEqual([
      'demo-psych-adult-002',
      ...Array.from({ length: 31 }, (_, index) => `demo-psych-unit-${String(index + 10).padStart(3, '0')}`),
    ].map((patientId) => ({
      patientId,
      lane: 'C',
      reason: 'Sin novedades registradas para este relevo.',
    })));
    expect(baseline.map(({ patientId }) => patientId)).toEqual([
      'demo-psych-adult-001',
      'demo-psych-child-001',
      'demo-psych-udcc-001',
      'demo-psych-adult-002',
      ...Array.from({ length: 36 }, (_, index) => `demo-psych-unit-${String(index + 5).padStart(3, '0')}`),
    ]);
  });

  it('classifies a 40-patient unit only from the explicit synthetic status', () => {
    const groups = groupExceptionHandoverPatients(DEMO_EXCEPTION_HANDOVER_PATIENTS);

    expect(DEMO_EXCEPTION_HANDOVER_PATIENTS).toHaveLength(40);
    expect(groups.unchanged).toHaveLength(32);
    expect(groups.changed).toHaveLength(6);
    expect(groups.critical).toHaveLength(2);
    expect(DEMO_EXCEPTION_HANDOVER_PATIENTS.every((patient) => patient.status)).toBe(true);
  });

  it('builds a visible SBAR without technical ids, raw enums or broken punctuation', () => {
    const patient = DEMO_EXCEPTION_HANDOVER_PATIENTS.find((candidate) => candidate.status === 'critical');
    expect(patient).toBeDefined();

    const visibleText = JSON.stringify(buildExceptionSbar(patient!));
    for (const forbidden of ['udcc', 'sjd', 'high', 'closing', '::', 'Escalar sí Avisar']) {
      expect(visibleText).not.toContain(forbidden);
    }
  });

  it('records check-back as an actor-and-time event distinct from attestation', () => {
    const event = createExceptionReviewEvent(
      'critical_check_back',
      DEMO_ACTORS[1],
      '2026-08-27T08:15:00.000Z',
      'demo-psych-adult-001',
      { criticalPoints: ['Nivel de observación y medidas de entorno seguro.'] },
    );

    expect(event).toMatchObject({
      kind: 'critical_check_back',
      actorId: DEMO_ACTORS[1].userId,
      actorKind: 'incoming',
      recordedAt: '2026-08-27T08:15:00.000Z',
      criticalPoints: ['Nivel de observación y medidas de entorno seguro.'],
    });
    expect(event.kind).not.toBe('incoming_attestation');
  });

  it('keeps the complete Core prefill available behind the quick route', () => {
    const prefill = getDemoHandoverPrefill('demo-psych-child-001');

    expect(prefill.administrativeData).toBeDefined();
    expect(prefill.dxMedical).toBeDefined();
    expect(prefill.vitals).toBeDefined();
    expect(prefill.medications).toBeDefined();
    expect(prefill.exams).toBeDefined();
    expect(prefill.pendingTasks).toBeDefined();
    expect(prefill.contingencyPlan).toBeDefined();
  });
});
