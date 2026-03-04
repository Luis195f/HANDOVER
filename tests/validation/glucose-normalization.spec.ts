import { describe, expect, it } from 'vitest';

import { glucoseMgDlToMmolL, glucoseMmolLToMgDl } from '@/src/validation/normalization';
import { zHandover } from '@/src/validation/schemas';
import { SNOMED_SYSTEM } from '@/src/data/snomed-dict';

const base = {
  administrativeData: {
    unit: 'UCI',
    census: 1,
    staffIn: ['A'],
    staffOut: ['B'],
    shiftStart: '2024-01-01T08:00:00.000Z',
    shiftEnd: '2024-01-01T12:00:00.000Z',
    shiftType: 'Mañana' as const,
  },
  patientId: 'p1',
  dxMedical: { system: SNOMED_SYSTEM, code: '195967001', display: 'Neumonía' },
  dxNursing: { system: SNOMED_SYSTEM, code: '386661006', display: 'Fiebre' },
  bedsideChecklist: {
    patientIdentityConfirmed: true,
    allergiesReviewed: true,
    linesAndDevicesChecked: true,
    medicationPlanReviewed: true,
    safetyMeasuresApplied: true,
    questionsAnswered: true,
  },
};

describe('glucose normalization helpers', () => {
  it('converts mmol/L to mg/dL', () => {
    expect(glucoseMmolLToMgDl(5.6)).toBe(101);
  });

  it('converts mg/dL to mmol/L', () => {
    expect(glucoseMgDlToMmolL(180)).toBe(10);
  });

  it('schema derives mg/dL when only mmol/L is provided', () => {
    const parsed = zHandover.parse({ ...base, vitals: { glucoseMmolL: 7.2 } });
    expect(parsed.vitals?.glucoseMgDl).toBe(130);
    expect(parsed.vitals?.glucoseMmolL).toBeCloseTo(7.2, 1);
  });
});
