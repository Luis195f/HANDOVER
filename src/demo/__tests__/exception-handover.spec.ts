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
    );

    expect(event).toMatchObject({
      kind: 'critical_check_back',
      actorId: DEMO_ACTORS[1].userId,
      actorKind: 'incoming',
      recordedAt: '2026-08-27T08:15:00.000Z',
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
