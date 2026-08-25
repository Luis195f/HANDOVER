import { describe, expect, it, vi } from 'vitest';

import { buildHandoverBundle } from '@/src/lib/fhir-map';
import { validateBundle } from '@/src/lib/fhir-validation';
import { zHandover } from '@/src/validation/schemas';

import { DEMO_PATIENTS, getDemoHandoverPrefill } from '../fixtures';

const getCurrentSession = vi.fn();

vi.mock('@/src/security/auth', () => ({
  getCurrentSession: () => getCurrentSession(),
}));

describe('demo fixtures', () => {
  it('keeps unit and census coherent with the synthetic patient opened', () => {
    const adultPatient = DEMO_PATIENTS.find((patient) => patient.id === 'demo-psych-adult-001');
    const childPatient = DEMO_PATIENTS.find((patient) => patient.id === 'demo-psych-child-001');
    if (!adultPatient || !childPatient) throw new Error('Missing demo fixture');
    const adultPrefill = getDemoHandoverPrefill(adultPatient.id);
    const childPrefill = getDemoHandoverPrefill(childPatient.id);

    expect(adultPrefill.administrativeData.unit).toBe(adultPatient.unitId);
    expect(adultPrefill.administrativeData.census).toBe(2);
    expect(childPrefill.administrativeData.census).toBe(1);
    expect(adultPrefill.pendingTasks?.length).toBeGreaterThan(0);
  });

  it('does not provide a synthetic response to an operational session', async () => {
    getCurrentSession.mockResolvedValue({ mode: 'operation' });
    const { maybeUseDemoResponse } = await import('../net-interceptor');

    await expect(maybeUseDemoResponse('https://demo.local/api/patients')).resolves.toBeNull();
  });

  it('keeps imported demo values serializable in a finalized handover', () => {
    const patient = DEMO_PATIENTS[0];
    const prefill = getDemoHandoverPrefill(patient.id);
    const handover = zHandover.parse({
      ...prefill,
      patientId: patient.id,
      status: 'final',
      bedsideChecklist: {
        patientIdentityConfirmed: true,
        allergiesReviewed: true,
        linesAndDevicesChecked: true,
        medicationPlanReviewed: true,
        safetyMeasuresApplied: true,
        questionsAnswered: true,
      },
      signatures: {
        outgoing: {
          userId: 'demo@nurseos.app',
          fullName: 'Profesional saliente demo',
          unitId: patient.unitId,
          signedAt: '2026-08-27T07:30:00.000Z',
          imageBase64: 'synthetic-signature',
        },
        incoming: {
          userId: 'demo.receiver@nurseos.app',
          fullName: 'Profesional receptora demo',
          unitId: patient.unitId,
          signedAt: '2026-08-27T07:31:00.000Z',
        },
      },
    });

    const bundle = buildHandoverBundle(
      {
        ...handover,
        oxygenTherapy: handover.oxygenTherapy
          ? { ...handover.oxygenTherapy, status: 'in-progress' }
          : undefined,
      },
      { now: () => '2026-08-27T07:30:00.000Z' },
    );
    const validation = validateBundle(bundle);
    expect(validation.errors).toEqual([]);
  });
});
