import { describe, expect, it } from 'vitest';

import {
  buildHandoverInputPayload,
  buildSubmissionAdministrativeData,
  buildSubmissionOxygenTherapy,
  normalizeUnitSelection,
} from '@/src/screens/handover/submission';

const baseValues = {
  patientId: 'pat-1',
  administrativeData: {
    unit: 'unit-a',
    census: 2,
    staffIn: ['nurse-a', ''],
    staffOut: ['nurse-b', ''],
    shiftStart: '2025-01-01T08:00:00Z',
    shiftEnd: '2025-01-01T16:00:00Z',
    shiftType: 'morning',
    generalNotes: 'notes',
    incidents: ['incident-a', ''],
  },
  bedsideChecklist: {},
} as const;

describe('handover submission helpers', () => {
  it('normalizes unit selection and drops the all-units sentinel', () => {
    expect(normalizeUnitSelection(' unit-a ', '__all__')).toBe('unit-a');
    expect(normalizeUnitSelection('__all__', '__all__')).toBeUndefined();
    expect(normalizeUnitSelection(undefined, '__all__')).toBeUndefined();
  });

  it('builds normalized administrative data for submission', () => {
    expect(buildSubmissionAdministrativeData(baseValues as any, 'unit-z')).toEqual({
      unit: 'unit-z',
      census: 2,
      staffIn: ['nurse-a'],
      staffOut: ['nurse-b'],
      shiftStart: '2025-01-01T08:00:00Z',
      shiftEnd: '2025-01-01T16:00:00Z',
      shiftType: 'morning',
      generalNotes: 'notes',
      incidents: ['incident-a'],
    });
  });

  it('normalizes oxygen therapy and preserves legacy payload compatibility', () => {
    expect(buildSubmissionOxygenTherapy(undefined)).toEqual({ hasOxygenValues: false, oxygenTherapy: null });
    expect(buildSubmissionOxygenTherapy({ device: 'Venturi', fio2: 40 })).toEqual({
      hasOxygenValues: true,
      oxygenTherapy: {
        status: 'in-progress',
        device: 'Venturi',
        deviceDisplay: 'Venturi',
        flowLMin: undefined,
        fio2: 40,
      },
    });

    expect(
      buildHandoverInputPayload(
        { ...baseValues, oxygenTherapy: { device: 'Mask' } } as any,
        { status: 'draft' },
      ).oxygenTherapy,
    ).toEqual({ status: 'in-progress', device: 'Mask' });
  });

  it('keeps draft payload flat when profile trace is present', () => {
    const profileTrace = {
      specialtySource: 'explicit' as const,
      catalogUnitProfileId: 'general-inpatient' as const,
      unitProfileId: 'general-inpatient' as const,
      overlaySelections: [],
      catalogSpecialtyOverlayIds: ['infecto'] as const,
      specialtyOverlayIds: ['infecto'] as const,
      activeProfileIds: ['general-inpatient', 'infecto'] as const,
      hasHumanSpecialtyOverride: true,
      mergeTrace: [
        { source: 'core' as const, profileId: 'handover-core' as const, label: 'HANDOVER Core' },
        {
          source: 'unit-profile' as const,
          profileId: 'general-inpatient' as const,
          label: 'Hospitalizacion general',
        },
        { source: 'specialty-overlay' as const, profileId: 'infecto' as const, label: 'Infectologia' },
      ],
    };

    const payload = buildHandoverInputPayload(baseValues as any, { status: 'draft' }, profileTrace);

    expect(payload.status).toBe('draft');
    expect(payload.profileTrace).toEqual(profileTrace);
    expect('values' in payload).toBe(false);
  });
});

