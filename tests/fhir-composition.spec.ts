import { readFileSync } from 'node:fs';

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { buildHandoverBundle } from '@/src/lib/fhir-map';
import { FHIR_CODES, FHIR_EXTENSION_URLS } from '@/src/lib/codes';
import { PROFILE_REGRESSION_SCENARIOS } from './fixtures/fhir/profileRegressionScenarios';

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

  const payload = buildHandoverInputPayload(
    scenario.values as any,
    {},
    buildProfileTraceInput(runtime),
  );

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

  it.each([
    ['uci-adulto-contextual-bundle.json', 'critical-care', []],
    ['hospitalizacion-general-medicina-interna-contextual-bundle.json', 'general-inpatient', []],
    ['urgencias-contextual-bundle.json', 'emergency', []],
    ['oncologia-eoprop-ia-contextual-bundle.json', 'ambulatory', ['onc']],
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

