import { describe, expect, it } from 'vitest';

import { FHIR_CODES } from '@/src/lib/codes';
import { SNOMED_SYSTEM } from '@/src/data/snomed-dict';
import { buildHandoverBundle } from '@/src/lib/fhir-map';
import { zHandover } from '@/src/validation/schemas';
import {
  buildHandoverInputPayload,
  buildProfileTraceInput,
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

  it('preserves the canonical SNOMED diagnosis through the real submission payload boundary', () => {
    const diagnosis = { system: SNOMED_SYSTEM, code: '61277005', display: 'Asma' } as const;
    const values = zHandover.parse({
      ...baseValues,
      administrativeData: {
        ...baseValues.administrativeData,
        staffIn: ['nurse-a'],
        staffOut: ['nurse-b'],
        incidents: ['incident-a'],
        shiftType: 'Mañana',
      },
      bedsideChecklist: {
        patientIdentityConfirmed: true,
        allergiesReviewed: true,
        linesAndDevicesChecked: true,
        medicationPlanReviewed: true,
        safetyMeasuresApplied: true,
        questionsAnswered: true,
      },
      dxMedical: diagnosis,
      dxMedicalStructured: [],
      dxNursing: '',
      dxNursingStructured: [],
    });

    const payload = buildHandoverInputPayload(
      values,
      { status: 'draft' },
    );

    expect(payload).toMatchObject({
      dxMedical: diagnosis,
      dxMedicalStructured: [],
    });
  });

  it('exports Clinical context through the real submission payload flow when profile trace is active', () => {
    const profileTrace = buildProfileTraceInput({
      context: {
        coreProfileId: 'handover-core',
        unitId: 'icu-neuro',
        requestedSpecialtyId: 'neuroicu',
        specialtyId: 'neuroicu',
        specialtySource: 'explicit',
        catalogUnitProfileId: 'specialized-critical-care',
        unitProfileId: 'specialized-critical-care',
        overlaySelections: [{ overlayId: 'neuro', source: 'specialty', specialtyId: 'neuroicu', isHumanOverride: true }],
        catalogSpecialtyOverlayIds: ['neuro'],
        specialtyOverlayIds: ['neuro'],
        activeProfileIds: ['handover-core', 'specialized-critical-care', 'neuro'],
        hasHumanSpecialtyOverride: true,
        usesCoreFallback: false,
        prioritySignals: [],
        iceaContext: {},
      },
      mergeTrace: [
        { source: 'core', profileId: 'handover-core', label: 'HANDOVER Core', additiveKeys: [], overrideKeys: [] },
        { source: 'unit-profile', profileId: 'specialized-critical-care', label: 'UCI especializada', additiveKeys: [], overrideKeys: [] },
        { source: 'specialty-overlay', profileId: 'neuro', label: 'Neurologia y neurocirugia', additiveKeys: [], overrideKeys: [] },
      ],
    });

    const payload = buildHandoverInputPayload(
      {
        ...baseValues,
        pendingTasks: [
          {
            id: 'task-critical',
            category: 'critical-task',
            title: 'Reevaluar pupilas y Glasgow',
            status: 'pending',
            priority: 'critical',
            dueBy: '2025-01-01T16:10:00Z',
          },
        ],
      } as any,
      { status: 'draft' },
      profileTrace,
    );

    const bundle = buildHandoverBundle(payload, { now: () => '2025-01-01T16:00:00Z' });
    const composition = bundle.entry.find((entry) => entry.resource.resourceType === 'Composition')?.resource as any;
    const contextSection = (composition?.section ?? []).find((section: any) => section.title === 'Clinical context');
    const contextObservation = bundle.entry
      .map((entry) => entry.resource as any)
      .find(
        (resource) =>
          resource.resourceType === 'Observation' &&
          resource.code?.coding?.some((coding: any) => coding.code === FHIR_CODES.CONTEXT.CLINICAL_CONTEXT.code),
      );

    expect(payload.profileTrace).toEqual(profileTrace);
    expect(contextSection?.entry).toHaveLength(1);
    expect(contextObservation?.valueString).toContain('UCI especializada');
    expect(contextObservation?.note?.[0]?.text).toContain('Reevaluar pupilas y Glasgow');
  });
});

