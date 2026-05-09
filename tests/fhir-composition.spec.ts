import { readFileSync } from 'node:fs';

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { buildHandoverBundle } from '@/src/lib/fhir-map';
import { FHIR_CODES, FHIR_EXTENSION_URLS } from '@/src/lib/codes';
import { PROFILE_REGRESSION_SCENARIOS } from './fixtures/fhir/profileRegressionScenarios';

type SubmissionInput = Parameters<typeof import('@/src/screens/handover/submission').buildHandoverInputPayload>[0];

const originalEnv = { ...process.env };

vi.mock('expo-constants', () => ({
  default: {
    expoConfig: {
      extra: {},
    },
  },
}));

const entryReference = (entry: { fullUrl?: string; resource: { resourceType: string; id?: string } }) =>
  entry.fullUrl ?? `${entry.resource.resourceType}/${entry.resource.id ?? ''}`;

const ACTIVE_PROFILE_EXTENSION_URL = FHIR_EXTENSION_URLS.ACTIVE_PROFILE;

const readNestedExtension = (extension: { extension?: Array<{ url: string; valueString?: string }> }) =>
  Object.fromEntries((extension.extension ?? []).map((item) => [item.url, item.valueString]));

const readFixtureBundle = (fixtureFile: string) =>
  JSON.parse(readFileSync(new URL(`./fixtures/fhir/${fixtureFile}`, import.meta.url), 'utf8'));

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const expectRecord = (value: unknown, label: string): Record<string, unknown> => {
  if (!isRecord(value)) {
    throw new Error(`${label} must be an object`);
  }
  return value;
};

const expectString = (value: unknown, label: string): string => {
  if (typeof value !== 'string') {
    throw new Error(`${label} must be a string`);
  }
  return value;
};

const expectBoolean = (value: unknown, label: string): boolean => {
  if (typeof value !== 'boolean') {
    throw new Error(`${label} must be a boolean`);
  }
  return value;
};

const expectNumber = (value: unknown, label: string): number => {
  if (typeof value !== 'number') {
    throw new Error(`${label} must be a number`);
  }
  return value;
};

const readOptionalString = (record: Record<string, unknown>, key: string): string | undefined => {
  const value = record[key];
  return typeof value === 'string' ? value : undefined;
};

const readOptionalNumber = (record: Record<string, unknown>, key: string): number | undefined => {
  const value = record[key];
  return typeof value === 'number' ? value : undefined;
};

const readOptionalBoolean = (record: Record<string, unknown>, key: string): boolean | undefined => {
  const value = record[key];
  return typeof value === 'boolean' ? value : undefined;
};

const readStringArray = (value: unknown, label: string): string[] => {
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) {
    throw new Error(`${label} must be a string array`);
  }
  return value;
};

const readScenarioValues = (values: Record<string, unknown>) => {
  const administrativeData = expectRecord(values.administrativeData, 'administrativeData');
  const bedsideChecklist = expectRecord(values.bedsideChecklist, 'bedsideChecklist');
  const author = isRecord(values.author) ? values.author : undefined;
  const vitals = isRecord(values.vitals) ? values.vitals : undefined;
  const psychosocial = isRecord(values.psychosocial) ? values.psychosocial : undefined;
  const treatments = Array.isArray(values.treatments) ? values.treatments : undefined;
  const outcomes = Array.isArray(values.outcomes) ? values.outcomes : undefined;
  const pendingTasks = Array.isArray(values.pendingTasks) ? values.pendingTasks : undefined;

  return {
    patientId: expectString(values.patientId, 'patientId'),
    encounterId: readOptionalString(values, 'encounterId'),
    author: author
      ? {
          id: expectString(author.id, 'author.id'),
          display: expectString(author.display, 'author.display'),
        }
      : undefined,
    bedsideChecklist: {
      patientIdentityConfirmed: expectBoolean(
        bedsideChecklist.patientIdentityConfirmed,
        'bedsideChecklist.patientIdentityConfirmed',
      ),
      allergiesReviewed: expectBoolean(bedsideChecklist.allergiesReviewed, 'bedsideChecklist.allergiesReviewed'),
      linesAndDevicesChecked: expectBoolean(
        bedsideChecklist.linesAndDevicesChecked,
        'bedsideChecklist.linesAndDevicesChecked',
      ),
      medicationPlanReviewed: expectBoolean(
        bedsideChecklist.medicationPlanReviewed,
        'bedsideChecklist.medicationPlanReviewed',
      ),
      safetyMeasuresApplied: expectBoolean(
        bedsideChecklist.safetyMeasuresApplied,
        'bedsideChecklist.safetyMeasuresApplied',
      ),
      questionsAnswered: expectBoolean(bedsideChecklist.questionsAnswered, 'bedsideChecklist.questionsAnswered'),
      bedsideNotes: readOptionalString(bedsideChecklist, 'bedsideNotes'),
    },
    administrativeData: {
      unit: expectString(administrativeData.unit, 'administrativeData.unit'),
      census: expectNumber(administrativeData.census, 'administrativeData.census'),
      staffIn: readStringArray(administrativeData.staffIn, 'administrativeData.staffIn'),
      staffOut: readStringArray(administrativeData.staffOut, 'administrativeData.staffOut'),
      shiftStart: expectString(administrativeData.shiftStart, 'administrativeData.shiftStart'),
      shiftEnd: expectString(administrativeData.shiftEnd, 'administrativeData.shiftEnd'),
      shiftType: expectString(administrativeData.shiftType, 'administrativeData.shiftType'),
      generalNotes: readOptionalString(administrativeData, 'generalNotes'),
      incidents: Array.isArray(administrativeData.incidents)
        ? readStringArray(administrativeData.incidents, 'administrativeData.incidents')
        : undefined,
    },
    vitals: vitals
      ? {
          hr: readOptionalNumber(vitals, 'hr'),
          rr: readOptionalNumber(vitals, 'rr'),
          tempC: readOptionalNumber(vitals, 'tempC'),
          spo2: readOptionalNumber(vitals, 'spo2'),
          sbp: readOptionalNumber(vitals, 'sbp'),
          dbp: readOptionalNumber(vitals, 'dbp'),
          glucoseMgDl: readOptionalNumber(vitals, 'glucoseMgDl'),
          glucoseMmolL: readOptionalNumber(vitals, 'glucoseMmolL'),
          avpu:
            vitals.avpu === 'A' || vitals.avpu === 'C' || vitals.avpu === 'V' || vitals.avpu === 'P' || vitals.avpu === 'U'
              ? vitals.avpu
              : undefined,
          recordedAt: readOptionalString(vitals, 'recordedAt'),
          issuedAt: readOptionalString(vitals, 'issuedAt'),
        }
      : undefined,
    psychosocial: psychosocial
      ? {
          emotionalStatus: readOptionalString(psychosocial, 'emotionalStatus'),
          familyVisits: readOptionalBoolean(psychosocial, 'familyVisits'),
          familyNotes: readOptionalString(psychosocial, 'familyNotes'),
        }
      : undefined,
    treatments: treatments?.map((item, index) => {
      const treatment = expectRecord(item, `treatments[${index}]`);
      return {
        id: expectString(treatment.id, `treatments[${index}].id`),
        type: expectString(treatment.type, `treatments[${index}].type`),
        description: expectString(treatment.description, `treatments[${index}].description`),
        scheduledAt: readOptionalString(treatment, 'scheduledAt'),
        done: readOptionalBoolean(treatment, 'done'),
      };
    }),
    outcomes: outcomes?.map((item, index) => {
      const outcome = expectRecord(item, `outcomes[${index}]`);
      return {
        nocCode: expectString(outcome.nocCode, `outcomes[${index}].nocCode`),
        nocDisplay: expectString(outcome.nocDisplay, `outcomes[${index}].nocDisplay`),
        baseline: expectNumber(outcome.baseline, `outcomes[${index}].baseline`),
        target: expectNumber(outcome.target, `outcomes[${index}].target`),
        current: readOptionalNumber(outcome, 'current'),
      };
    }),
    pendingTasks: pendingTasks?.map((item, index) => {
      const task = expectRecord(item, `pendingTasks[${index}]`);
      return {
        id: expectString(task.id, `pendingTasks[${index}].id`),
        category: expectString(task.category, `pendingTasks[${index}].category`),
        title: expectString(task.title, `pendingTasks[${index}].title`),
        status: expectString(task.status, `pendingTasks[${index}].status`),
        priority: expectString(task.priority, `pendingTasks[${index}].priority`),
        dueBy: readOptionalString(task, 'dueBy'),
      };
    }),
    closingSummary: readOptionalString(values, 'closingSummary'),
  } satisfies SubmissionInput;
};

async function buildScenarioBundle(
  fixtureFile: string,
): Promise<{
  bundle: ReturnType<typeof buildHandoverBundle>;
  runtime: {
    context: {
      unitProfileId: string | null;
      specialtyOverlayIds: readonly string[];
    };
  };
}> {
  const scenario = PROFILE_REGRESSION_SCENARIOS.find((candidate) => candidate.fixtureFile === fixtureFile);
  if (!scenario) {
    throw new Error(`Unknown regression fixture ${fixtureFile}`);
  }

  vi.resetModules();
  process.env = { ...originalEnv };
  delete process.env.EXPO_PUBLIC_HANDOVER_PROFILE_ACTIVATION_JSON;
  delete process.env.HANDOVER_PROFILE_ACTIVATION_JSON;
  delete process.env.EXPO_PUBLIC_HANDOVER_UNITS_JSON;
  delete process.env.HANDOVER_UNITS_JSON;
  delete process.env.UNITS_CONFIG;

  process.env.EXPO_PUBLIC_HANDOVER_PROFILE_ACTIVATION_JSON = JSON.stringify(scenario.activation);
  if (scenario.unitsConfig) {
    process.env.UNITS_CONFIG = JSON.stringify(scenario.unitsConfig);
  }

  const { resolveHandoverProfileRuntime } = await import('@/src/lib/profile-runtime');
  const { buildHandoverInputPayload, buildProfileTraceInput } = await import('@/src/screens/handover/submission');
  const { buildHandoverBundle: buildScenarioHandoverBundle } = await import('@/src/lib/fhir-map');

  const runtime = resolveHandoverProfileRuntime({
    unitId: scenario.unitId,
    specialtyId: scenario.specialtyId,
  });

  const payload = buildHandoverInputPayload(readScenarioValues(scenario.values), {}, buildProfileTraceInput(runtime));

  return {
    bundle: buildScenarioHandoverBundle(payload, { now: () => scenario.now }),
    runtime,
  };
}

describe('FHIR Composition', () => {
  beforeEach(() => {
    vi.resetModules();
    process.env = { ...originalEnv };
    delete process.env.EXPO_PUBLIC_HANDOVER_PROFILE_ACTIVATION_JSON;
    delete process.env.HANDOVER_PROFILE_ACTIVATION_JSON;
    delete process.env.EXPO_PUBLIC_HANDOVER_UNITS_JSON;
    delete process.env.HANDOVER_UNITS_JSON;
    delete process.env.UNITS_CONFIG;
  });

  it('includes required sections with resolvable references', () => {
    const bundle = buildHandoverBundle(
      {
        patientId: 'pat-comp-1',
        encounterId: 'enc-comp-1',
        author: { id: 'nurse-7', display: 'Nurse Seven' },
        bedsideChecklist: {
          patientIdentityConfirmed: true,
          allergiesReviewed: true,
          bedsideNotes: 'Checklist completed.',
        },
        administrativeData: {
          unit: 'UCI',
          census: 12,
          staffIn: ['Nurse A'],
          staffOut: ['Nurse B'],
          shiftStart: '2025-10-20T08:00:00Z',
          shiftEnd: '2025-10-20T16:00:00Z',
          shiftType: 'Mañana',
          incidents: ['Sin incidentes'],
        },
        vitals: { hr: 88, rr: 18 },
        nutrition: { dietType: 'oral', intakeMl: 250 },
        treatments: [{ id: 'treat-1', type: 'mobilization', description: 'Mobilization', done: false }],
        sbar: {
          situation: 'Stable',
          background: 'Post-op',
          assessment: 'Pain controlled',
          recommendation: 'Continue monitoring',
        },
        closingSummary: 'Summary text',
      },
      { now: () => '2025-10-20T16:05:00Z' },
    );

    const compositionEntry = bundle.entry.find(
      (entry) => entry.resource.resourceType === 'Composition',
    );
    expect(compositionEntry).toBeDefined();

    const composition = compositionEntry!.resource as any;
    const sectionTitles = (composition.section ?? []).map((section: any) => section.title);
    const requiredTitles = [
      'Administrative',
      'Vital signs',
      'Care / Treatments',
      'SBAR',
      'Bedside checklist',
      'Notes / Summary',
    ];
    requiredTitles.forEach((title) => expect(sectionTitles).toContain(title));
    expect(sectionTitles).not.toContain('Clinical context');

    const entryReferenceSet = new Set(bundle.entry.map((entry) => entryReference(entry)));
    (composition.section ?? []).forEach((section: any) => {
      expect(section.code).toBeDefined();
      (section.entry ?? []).forEach((entry: any) => {
        expect(entry.reference).toMatch(/^urn:uuid:[0-9a-f]{32}$/);
        expect(entryReferenceSet.has(entry.reference)).toBe(true);
      });
    });
  });

  it('exports active profile context as additive Composition extensions and a contextual Observation', () => {
    const bundle = buildHandoverBundle(
      {
        values: {
          patientId: 'pat-context-1',
          encounterId: 'enc-context-1',
          author: { id: 'nurse-9', display: 'Nurse Nine' },
          bedsideChecklist: {
            patientIdentityConfirmed: true,
            allergiesReviewed: true,
            linesAndDevicesChecked: true,
            medicationPlanReviewed: true,
            safetyMeasuresApplied: true,
            questionsAnswered: true,
          },
          administrativeData: {
            unit: 'UCI neuro',
            census: 10,
            staffIn: ['Nurse In'],
            staffOut: ['Nurse Out'],
            shiftStart: '2025-10-20T08:00:00Z',
            shiftEnd: '2025-10-20T16:00:00Z',
            shiftType: 'Mañana',
          },
          pendingTasks: [
            {
              id: 'task-critical-1',
              category: 'critical-task',
              title: 'Reevaluar pupilas y Glasgow',
              status: 'pending',
              priority: 'critical',
              dueBy: '2025-10-20T16:10:00Z',
            },
          ],
        },
        profileTrace: {
          unitId: 'icu-neuro',
          requestedSpecialtyId: 'neuroicu',
          specialtyId: 'neuroicu',
          specialtySource: 'explicit',
          catalogUnitProfileId: 'specialized-critical-care',
          unitProfileId: 'specialized-critical-care',
          overlaySelections: [{ overlayId: 'neuro', source: 'specialty', specialtyId: 'neuroicu' }],
          catalogSpecialtyOverlayIds: ['neuro'],
          specialtyOverlayIds: ['neuro'],
          activeProfileIds: ['handover-core', 'specialized-critical-care', 'neuro'],
          hasHumanSpecialtyOverride: true,
        },
      },
      { now: () => '2025-10-20T16:05:00Z' },
    );

    const composition = bundle.entry.find((entry) => entry.resource.resourceType === 'Composition')?.resource as any;
    expect(composition?.extension).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          url: FHIR_EXTENSION_URLS.CONTEXT_VERSION,
          valueString: '1',
        }),
      ]),
    );

    const activeProfiles = (composition.extension ?? [])
      .filter((extension: any) => extension.url === ACTIVE_PROFILE_EXTENSION_URL)
      .map(readNestedExtension);

    expect(activeProfiles).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ profileId: 'handover-core', profileKind: 'core' }),
        expect.objectContaining({ profileId: 'specialized-critical-care', profileKind: 'unit-profile' }),
        expect.objectContaining({ profileId: 'neuro', profileKind: 'specialty-overlay' }),
      ]),
    );

    const contextSection = (composition.section ?? []).find((section: any) => section.title === 'Clinical context');
    expect(contextSection?.entry).toHaveLength(1);

    const reference = contextSection.entry[0]?.reference;
    const entryReferenceSet = new Set(bundle.entry.map((entry) => entryReference(entry)));
    expect(entryReferenceSet.has(reference)).toBe(true);

    const contextObservation = bundle.entry
      .map((entry) => entry.resource as any)
      .find(
        (resource) =>
          resource.resourceType === 'Observation' &&
          resource.code?.coding?.some((coding: any) => coding.code === FHIR_CODES.CONTEXT.CLINICAL_CONTEXT.code),
      );

    expect(contextObservation?.valueString).toContain('UCI especializada');
    expect(contextObservation?.component).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: expect.objectContaining({ text: 'Unit profile' }),
          valueString: expect.stringContaining('specialized-critical-care'),
        }),
        expect.objectContaining({
          code: expect.objectContaining({ text: 'Specialty overlay' }),
          valueString: expect.stringContaining('neuro'),
        }),
        expect.objectContaining({
          code: expect.objectContaining({ text: 'Contextual priority signal' }),
          valueString: expect.stringContaining('Neurodeterioro'),
        }),
        expect.objectContaining({
          code: expect.objectContaining({ text: 'Pending critical task count' }),
          valueInteger: 1,
        }),
      ]),
    );
    expect(contextObservation?.note?.[0]?.text).toContain('Reevaluar pupilas y Glasgow');
  });

  it('projects behavioral-health through the existing contextual export seam without creating a psychiatric FHIR contract', async () => {
    process.env.UNITS_CONFIG = JSON.stringify({
      units: [
        {
          id: 'sjd-a',
          name: 'Psiquiatria adulto demo',
          specialty: 'psych',
          profileId: 'behavioral-health',
        },
      ],
    });
    process.env.EXPO_PUBLIC_HANDOVER_PROFILE_ACTIVATION_JSON = JSON.stringify({
      unitProfiles: ['behavioral-health'],
    });

    const { resolveHandoverProfileRuntime } = await import('@/src/lib/profile-runtime');
    const { buildHandoverInputPayload, buildProfileTraceInput } = await import('@/src/screens/handover/submission');
    const { buildHandoverBundle: buildBehavioralHealthBundle } = await import('@/src/lib/fhir-map');

    const runtime = resolveHandoverProfileRuntime({ unitId: 'sjd-a', specialtyId: 'psych' });
    const behavioralHealthValues = {
      patientId: 'pat-psych-1',
      encounterId: 'enc-psych-1',
      author: { id: 'nurse-psych-1', display: 'Nurse Psych One' },
      bedsideChecklist: {
        patientIdentityConfirmed: true,
        allergiesReviewed: true,
        linesAndDevicesChecked: true,
        medicationPlanReviewed: true,
        safetyMeasuresApplied: true,
        questionsAnswered: true,
      },
      administrativeData: {
        unit: 'Psiquiatria adulto',
        census: 14,
        staffIn: ['Nurse In'],
        staffOut: ['Nurse Out'],
        shiftStart: '2025-10-20T08:00:00Z',
        shiftEnd: '2025-10-20T16:00:00Z',
        shiftType: 'Mañana',
      },
      psychosocial: {
        emotionalStatus: 'Ansiedad contenida y colaboracion parcial',
        familyVisits: true,
        familyNotes: 'Acompanamiento sintetico coordinado para continuidad del relevo.',
      },
      pendingTasks: [
        {
          id: 'task-psych-1',
          category: 'critical-task',
          title: 'Reevaluar observacion especial y continuidad terapeutica',
          status: 'pending',
          priority: 'critical',
          dueBy: '2025-10-20T16:15:00Z',
        },
      ],
    } satisfies SubmissionInput;
    const payload = buildHandoverInputPayload(behavioralHealthValues, {}, buildProfileTraceInput(runtime));
    const bundle = buildBehavioralHealthBundle(payload, { now: () => '2025-10-20T16:05:00Z' });

    expect(runtime.context.unitProfileId).toBe('behavioral-health');
    expect(runtime.context.specialtyOverlayIds).toEqual([]);

    const composition = bundle.entry.find((entry) => entry.resource.resourceType === 'Composition')?.resource as any;
    const activeProfiles = (composition.extension ?? [])
      .filter((extension: any) => extension.url === ACTIVE_PROFILE_EXTENSION_URL)
      .map(readNestedExtension);

    expect(activeProfiles).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ profileId: 'handover-core', profileKind: 'core' }),
        expect.objectContaining({ profileId: 'behavioral-health', profileKind: 'unit-profile' }),
      ]),
    );
    expect(activeProfiles.some((profile) => profile.profileKind === 'specialty-overlay')).toBe(false);

    const contextSection = (composition.section ?? []).find((section: any) => section.title === 'Clinical context');
    expect(contextSection?.entry).toHaveLength(1);

    const contextObservation = bundle.entry
      .map((entry) => entry.resource as any)
      .find(
        (resource) =>
          resource.resourceType === 'Observation' &&
          resource.code?.coding?.some((coding: any) => coding.code === FHIR_CODES.CONTEXT.CLINICAL_CONTEXT.code),
      );

    expect(contextObservation?.valueString).toContain('Salud mental');
    expect(contextObservation?.component).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: expect.objectContaining({ text: 'Unit profile' }),
          valueString: expect.stringContaining('behavioral-health'),
        }),
        expect.objectContaining({
          code: expect.objectContaining({ text: 'Contextual priority signal' }),
          valueString: expect.stringContaining('Necesidad de observacion conductual intensiva'),
        }),
        expect.objectContaining({
          code: expect.objectContaining({ text: 'Contextual priority signal' }),
          valueString: expect.stringContaining('Riesgo de ruptura terapeutica u omision relacional'),
        }),
        expect.objectContaining({
          code: expect.objectContaining({ text: 'Pending critical task count' }),
          valueInteger: 1,
        }),
      ]),
    );
    expect(contextObservation?.component?.some((component: any) => component.code?.text === 'Specialty overlay')).toBe(false);
    expect(contextObservation?.note?.[0]?.text).toContain('Reevaluar observacion especial y continuidad terapeutica');
  });

  it.each([
    ['uci-adulto-contextual-bundle.json', 'critical-care', []],
    ['hospitalizacion-general-medicina-interna-contextual-bundle.json', 'general-inpatient', []],
    ['urgencias-contextual-bundle.json', 'emergency', []],
    ['oncologia-eoprop-ia-contextual-bundle.json', 'ambulatory', ['onc']],
    ['contextual-clinical-context-bundle.json', 'specialized-critical-care', ['neuro']],
  ])(
    'keeps the contextual export stable for %s',
    async (fixtureFile, expectedUnitProfileId, expectedOverlayIds) => {
      const { bundle, runtime } = await buildScenarioBundle(fixtureFile);

      expect(runtime.context.unitProfileId).toBe(expectedUnitProfileId);
      expect(runtime.context.specialtyOverlayIds).toEqual(expectedOverlayIds);
      expect(bundle).toEqual(readFixtureBundle(fixtureFile));
    },
  );
});
