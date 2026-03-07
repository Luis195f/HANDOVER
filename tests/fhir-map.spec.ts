import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import {
  buildFhirBundleFromFormData,
  buildHandoverBundle,
  mapObservationVitals,
  NANDA_DIAGNOSIS_SYSTEM_URI,
  NIC_INTERVENTION_SYSTEM_URI,
  NOC_OUTCOME_SYSTEM_URI,
  type HandoverData,
  type HandoverValues,
  validateBundle,
} from '@/src/lib/fhir-map';
import { SNOMED_SYSTEM } from '@/src/data/snomed-dict';
import { zHandover } from '@/src/validation/schemas';

const NOW = '2025-01-05T10:30:00.000Z';

const makeCoding = (code: string, display: string) => ({
  system: SNOMED_SYSTEM,
  code,
  display,
});

const baseValues: HandoverValues = {
  patientId: 'patient-001',
  encounterId: 'enc-777',
  author: { id: 'nurse-33', display: 'Nurse Test' },
  bedsideChecklist: {
    patientIdentityConfirmed: true,
    allergiesReviewed: true,
    linesAndDevicesChecked: false,
    medicationPlanReviewed: false,
    safetyMeasuresApplied: false,
    questionsAnswered: false,
  },
  vitals: {
    recordedAt: '2025-01-05T09:45:00+00:00',
    issuedAt: '2025-01-05T09:50:00+00:00',
    hr: 78,
    rr: 16,
    tempC: 37.2,
    spo2: 96,
    sbp: 118,
    dbp: 75,
    glucoseMgDl: 110,
  },
  medications: [
    {
      status: 'active',
      code: {
        system: 'http://www.nlm.nih.gov/research/umls/rxnorm',
        code: '161',
        display: 'Paracetamol 500mg tablet',
      },
      start: '2025-01-05T08:00:00+00:00',
      note: 'Given after breakfast',
    },
  ],
  oxygenTherapy: {
    status: 'in-progress',
    start: '2025-01-05T09:00:00+00:00',
    deviceDisplay: 'Nasal cannula',
  },
  audioAttachment: {
    url: 'https://example.org/audio/handover.m4a',
    contentType: 'audio/m4a',
    title: 'Shift wrap-up',
  },
  composition: {
    status: 'final',
    title: 'SBAR summary',
  },
};

const isoUtcString = () =>
  z.string().refine((value) => value.endsWith('Z'), {
    message: 'timestamp must be normalized to UTC (ending with Z)',
  });

const referenceSchema = z.object({
  reference: z.string().min(1),
  type: z.string().optional(),
  display: z.string().optional(),
});

const quantitySchema = z.object({
  value: z.number(),
  system: z.string().optional(),
  unit: z.string().optional(),
  code: z.string().optional(),
});

const observationSchema = z.object({
  resourceType: z.literal('Observation'),
  status: z.literal('final'),
  meta: z.object({ profile: z.array(z.string()).min(1) }),
  category: z
    .array(
      z.object({
        coding: z.array(z.object({ system: z.string(), code: z.string() })).min(1),
      }),
    )
    .min(1),
  code: z.object({ coding: z.array(z.object({ system: z.string(), code: z.string() })).min(1) }),
  subject: referenceSchema,
  encounter: referenceSchema.optional(),
  effectiveDateTime: isoUtcString(),
  issued: isoUtcString(),
  valueQuantity: quantitySchema.optional(),
  valueCodeableConcept: z
    .object({
      coding: z.array(z.object({ system: z.string().optional(), code: z.string().optional(), display: z.string().optional() })).optional(),
      text: z.string().optional(),
    })
    .optional(),
  component: z
    .array(
      z.object({
        code: z.object({ coding: z.array(z.object({ system: z.string(), code: z.string() })).min(1) }),
        valueQuantity: quantitySchema.optional(),
      }),
    )
    .optional(),
});

const medicationStatementSchema = z.object({
  resourceType: z.literal('MedicationStatement'),
  status: z.enum(['active', 'completed', 'intended']),
  medicationCodeableConcept: z.object({
    coding: z.array(z.object({ system: z.string().optional(), code: z.string().optional(), display: z.string().optional() })),
    text: z.string().optional(),
  }),
  subject: referenceSchema,
  encounter: referenceSchema.optional(),
  effectivePeriod: z
    .object({
      start: isoUtcString(),
      end: isoUtcString().optional(),
    })
    .optional(),
  dateAsserted: isoUtcString(),
  note: z.array(z.object({ text: z.string() })).optional(),
});

const procedureSchema = z.object({
  resourceType: z.literal('Procedure'),
  status: z.enum(['in-progress', 'completed']),
  code: z.object({ coding: z.array(z.object({ system: z.string(), code: z.string() })).min(1) }),
  subject: referenceSchema,
  encounter: referenceSchema.optional(),
  performedDateTime: isoUtcString().optional(),
  performedPeriod: z
    .object({
      start: isoUtcString(),
      end: isoUtcString().optional(),
    })
    .optional(),
});

const deviceUseStatementSchema = z.object({
  resourceType: z.literal('DeviceUseStatement'),
  status: z.enum(['active', 'completed']),
  subject: referenceSchema,
  encounter: referenceSchema.optional(),
  device: referenceSchema,
  timingPeriod: z
    .object({
      start: isoUtcString(),
      end: isoUtcString().optional(),
    })
    .optional(),
});

const documentReferenceSchema = z.object({
  resourceType: z.literal('DocumentReference'),
  status: z.literal('current'),
  subject: referenceSchema,
  encounter: referenceSchema.optional(),
  author: z.array(referenceSchema).min(1),
  date: isoUtcString(),
  content: z
    .array(
      z.object({
        attachment: z.object({
          contentType: z.string().min(1),
          url: z.string().optional(),
          data: z.string().optional(),
          size: z.number().int().positive().optional(),
          hash: z.string().optional(),
          title: z.string().optional(),
        }),
      }),
    )
    .min(1),
});

const compositionSchema = z.object({
  resourceType: z.literal('Composition'),
  status: z.enum(['final', 'amended']),
  type: z.object({ coding: z.array(z.object({ system: z.string(), code: z.string() })).min(1) }),
  subject: referenceSchema,
  encounter: referenceSchema.optional(),
  date: isoUtcString(),
  author: z.array(referenceSchema).min(1),
  title: z.string().min(1),
  section: z
    .array(
      z.object({
        title: z.string().optional(),
        entry: z.array(referenceSchema).optional(),
      }),
    )
    .optional(),
});

const patientSchema = z.object({
  resourceType: z.literal('Patient'),
  id: z.string().optional(),
  identifier: z.array(z.object({ system: z.string(), value: z.string() })).optional(),
});

const practitionerSchema = z.object({
  resourceType: z.literal('Practitioner'),
  id: z.string().optional(),
  identifier: z.array(z.object({ system: z.string(), value: z.string() })).optional(),
});

const encounterSchema = z.object({
  resourceType: z.literal('Encounter'),
  id: z.string().optional(),
  status: z.string(),
  class: z.object({ system: z.string(), code: z.string(), display: z.string().optional() }),
  subject: referenceSchema.optional(),
});

const deviceSchema = z.object({
  resourceType: z.literal('Device'),
  id: z.string().optional(),
  status: z.string().optional(),
});

const resourceValidators = {
  Observation: observationSchema,
  MedicationStatement: medicationStatementSchema,
  Procedure: procedureSchema,
  DeviceUseStatement: deviceUseStatementSchema,
  DocumentReference: documentReferenceSchema,
  Composition: compositionSchema,
  Patient: patientSchema,
  Practitioner: practitionerSchema,
  Encounter: encounterSchema,
  Device: deviceSchema,
} as const;

function collectReferenceStrings(resource: unknown): string[] {
  const refs: string[] = [];
  const stack = [resource];
  while (stack.length) {
    const current = stack.pop();
    if (Array.isArray(current)) {
      stack.push(...current);
      continue;
    }
    if (current && typeof current === 'object') {
      if ('reference' in current && typeof (current as any).reference === 'string') {
        refs.push((current as any).reference);
      }
      for (const value of Object.values(current)) {
        stack.push(value);
      }
    }
  }
  return refs;
}

function entryReference(entry: { fullUrl?: string; resource: { resourceType: string; id?: string } }): string {
  return entry.fullUrl ?? `${entry.resource.resourceType}/${entry.resource.id ?? ''}`;
}

describe('mapObservationVitals', () => {
  it('creates individual observations with correct codings and UTC timestamps', () => {
    const observations = mapObservationVitals(
      {
        patientId: baseValues.patientId,
        encounterId: baseValues.encounterId,
        ...baseValues.vitals!,
      },
      { now: () => NOW },
    );

    expect(observations).toHaveLength(6);
    const glucoseCodes = new Set(['2339-0', '15074-8']);
    const effectiveDates = new Set(observations.map((obs) => obs.effectiveDateTime));
    expect(effectiveDates).toEqual(new Set(['2025-01-05T09:45:00.000Z']));
    observations.forEach((obs) => {
      const obsCode = obs.code?.coding?.[0]?.code;
      if (obsCode && glucoseCodes.has(obsCode)) {
        expect(obs.category[0]?.coding[0]?.code).toBe('laboratory');
        expect(obs.meta?.profile ?? []).not.toContain('http://hl7.org/fhir/StructureDefinition/vitalsigns');
      } else {
        expect(obs.category[0]?.coding[0]?.code).toBe('vital-signs');
        expect(obs.meta?.profile?.length).toBeGreaterThan(0);
      }
      expect(obs.issued).toBe('2025-01-05T09:50:00.000Z');
      expect(obs.subject.reference).toBe(`Patient/${baseValues.patientId}`);
    });
  });

  it('rejects out of range values', () => {
    expect(() =>
      mapObservationVitals(
        {
          patientId: 'patient-xyz',
          tempC: 55,
        },
        { now: () => NOW },
      ),
    ).toThrow();
  });
});

describe('buildHandoverBundle', () => {
  it('builds a transaction bundle with stable IDs and complete references', () => {
    const bundle = buildHandoverBundle(baseValues, { now: () => NOW });

    expect(bundle.resourceType).toBe('Bundle');
    expect(bundle.type).toBe('transaction');
    expect(bundle.entry.length).toBeGreaterThanOrEqual(5);

    const fullUrls = bundle.entry.map((entry) => entry.fullUrl);
    expect(new Set(fullUrls).size).toBe(fullUrls.length);
    const entryReferences = bundle.entry.map((entry) => entryReference(entry));
    expect(new Set(entryReferences).size).toBe(entryReferences.length);

    const compositionEntry = bundle.entry.find(
      (entry) => entry.resource.resourceType === 'Composition',
    );
    expect(compositionEntry).toBeDefined();
    const composition = compositionEntry!.resource as any;
    expect(composition.date).toBe(NOW);
    expect(composition.status).toBe('final');
    const sectionRefs = (composition.section ?? []).flatMap((section: any) =>
      section.entry?.map((ref: any) => ref.reference) ?? [],
    );
    sectionRefs.forEach((ref: string) => {
      expect(ref).toMatch(/^urn:uuid:[0-9a-f]{32}$/);
      expect(entryReferences).toContain(ref);
    });

    const documentEntry = bundle.entry.find(
      (entry) => entry.resource.resourceType === 'DocumentReference',
    );
    expect(documentEntry).toBeDefined();
    const attachment = (documentEntry!.resource as any).content[0].attachment;
    expect(attachment.url).toBe('https://example.org/audio/handover.m4a');
    expect(attachment.contentType).toBe('audio/m4a');

    bundle.entry.forEach((entry) => {
      expect(entry.request).toEqual({ method: 'POST', url: entry.resource.resourceType });
    });
  });

  it('includes the handwritten signature in the Bundle', () => {
    const bundle = buildHandoverBundle(
      {
        ...baseValues,
        signatures: {
          outgoing: {
            userId: 'nurse-33',
            fullName: 'Nurse Test',
            unitId: 'UCI-1',
            signedAt: NOW,
            imageBase64: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJ',
            method: 'session',
          },
        },
      },
      { now: () => NOW },
    );

    expect(bundle.signature).toHaveLength(1);
    const signature = bundle.signature?.[0];
    expect(signature?.who?.identifier?.value).toBe('nurse-33');
    expect(signature?.onBehalfOf?.identifier?.value).toBe('UCI-1');
    expect(signature?.data).toBe('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJ');
  });

  it('validates every generated resource against simplified FHIR schemas', () => {
    const bundle = buildHandoverBundle(baseValues, { now: () => NOW });

    const typeCounts = new Map<string, number>();
    bundle.entry.forEach((entry) => {
      typeCounts.set(entry.resource.resourceType, (typeCounts.get(entry.resource.resourceType) ?? 0) + 1);
      const validator = resourceValidators[
        entry.resource.resourceType as keyof typeof resourceValidators
      ];
      expect(validator, `missing validator for ${entry.resource.resourceType}`).toBeDefined();
      validator.parse(entry.resource as never);
      expect(entry.fullUrl).toMatch(/^urn:uuid:[0-9a-f]{32}$/);
      expect(entry.request).toEqual({ method: 'POST', url: entry.resource.resourceType });
    });

    expect(typeCounts.get('Observation')).toBeGreaterThanOrEqual(1);
    expect(typeCounts.get('MedicationStatement')).toBeGreaterThanOrEqual(1);
    expect(typeCounts.get('Procedure')).toBeGreaterThanOrEqual(1);
    expect(typeCounts.get('DeviceUseStatement')).toBeGreaterThanOrEqual(1);
    expect(typeCounts.get('DocumentReference')).toBe(1);
    expect(typeCounts.get('Composition')).toBe(1);
  });

  it('resolves all internal references to bundle entries', () => {
    const bundle = buildHandoverBundle(baseValues, { now: () => NOW });
    const entryReferenceSet = new Set(bundle.entry.map((entry) => entryReference(entry)));

    bundle.entry.forEach((entry) => {
      const references = collectReferenceStrings(entry.resource);
      references.forEach((reference) => {
        expect(entryReferenceSet.has(reference)).toBe(true);
      });
    });
  });

  it('links Composition.encounter to the normalized encounter entry', () => {
    const bundle = buildHandoverBundle({ ...baseValues, encounterId: '' }, { now: () => NOW });
    const encounterEntry = bundle.entry.find((entry) => entry.resource.resourceType === 'Encounter');
    const compositionEntry = bundle.entry.find((entry) => entry.resource.resourceType === 'Composition');
    expect(encounterEntry).toBeDefined();
    expect(compositionEntry).toBeDefined();

    const composition = compositionEntry!.resource as any;
    expect(composition.encounter?.reference).toBe(entryReference(encounterEntry!));
  });

  it('uses the patient fullUrl for every patient reference in the transaction bundle', () => {
    const bundle = buildHandoverBundle(baseValues, { now: () => NOW });
    const patientEntry = bundle.entry.find((entry) => entry.resource.resourceType === 'Patient');
    expect(patientEntry).toBeDefined();

    const expectedPatientReference = entryReference(patientEntry!);

    bundle.entry
      .filter((entry) => 'subject' in entry.resource && entry.resource.resourceType !== 'Patient')
      .forEach((entry) => {
        expect((entry.resource as any).subject?.reference).toBe(expectedPatientReference);
      });
  });

  it('produces deterministic fullUrls for repeated builds', () => {
    const first = buildHandoverBundle(baseValues, { now: () => NOW });
    const second = buildHandoverBundle(baseValues, { now: () => NOW });

    const firstUrls = first.entry.map((entry) => entry.fullUrl);
    const secondUrls = second.entry.map((entry) => entry.fullUrl);
    expect(secondUrls).toEqual(firstUrls);

    const combinedUrls = [...first.entry, ...second.entry].map((entry) => entry.fullUrl);
    expect(new Set(combinedUrls).size).toBe(first.entry.length);
  });
});

describe('buildFhirBundleFromFormData', () => {


  it('maps NANDA nursing diagnosis as Condition.code.coding using the NANDA URI', () => {
    const handover: HandoverData = zHandover.parse({
      administrativeData: {
        unit: 'UCI',
        census: 8,
        staffIn: ['Nurse In'],
        staffOut: ['Nurse Out'],
        shiftStart: '2025-01-05T08:00:00Z',
        shiftEnd: '2025-01-05T16:00:00Z',
        shiftType: 'Mañana',
      },
      patientId: 'patient-nanda-1',
      bedsideChecklist: {
        patientIdentityConfirmed: true,
        allergiesReviewed: true,
        linesAndDevicesChecked: true,
        medicationPlanReviewed: true,
        safetyMeasuresApplied: true,
        questionsAnswered: true,
      },
      dxMedical: makeCoding('195967001', 'Neumonía'),
      dxNursing: '',
      dxNursingStructured: [
        { system: 'NANDA', code: '00030', display: 'Deterioro del intercambio gaseoso' },
      ],
    });

    const bundle = buildFhirBundleFromFormData(handover, { now: () => '2025-01-05T16:00:00Z' });
    const nandaCondition = bundle.entry
      .map((entry) => entry.resource)
      .find(
        (resource) =>
          resource.resourceType === 'Condition' &&
          resource.code?.coding?.[0]?.system === NANDA_DIAGNOSIS_SYSTEM_URI,
      ) as any;

    expect(nandaCondition).toBeDefined();
    expect(nandaCondition.code.coding[0]).toMatchObject({
      system: NANDA_DIAGNOSIS_SYSTEM_URI,
      code: '00030',
      display: 'Deterioro del intercambio gaseoso',
    });
  });


  it('maps minimum viable NNN concepts to Condition, Procedure and Observation resources in the same bundle', () => {
    const handover: HandoverData = zHandover.parse({
      administrativeData: {
        unit: 'UCI',
        census: 8,
        staffIn: ['Nurse In'],
        staffOut: ['Nurse Out'],
        shiftStart: '2025-01-05T08:00:00Z',
        shiftEnd: '2025-01-05T16:00:00Z',
        shiftType: 'Mañana',
      },
      patientId: 'patient-nnn-1',
      bedsideChecklist: {
        patientIdentityConfirmed: true,
        allergiesReviewed: true,
        linesAndDevicesChecked: true,
        medicationPlanReviewed: true,
        safetyMeasuresApplied: true,
        questionsAnswered: true,
      },
      dxMedical: makeCoding('195967001', 'Neumonía'),
      dxNursing: '',
      dxNursingStructured: [
        { system: 'NANDA', code: '00030', display: 'Deterioro del intercambio gaseoso' },
      ],
      treatments: [
        {
          id: 'tx-nic-1',
          type: 'other',
          description: 'Control del dolor',
          code: { system: 'NIC', code: '2210', display: 'Administración de analgésicos' },
        },
      ],
      outcomes: [
        {
          nocCode: '0402',
          nocDisplay: 'Estado respiratorio: permeabilidad de las vías aéreas',
          baseline: 2,
          target: 4,
          current: 3,
        },
      ],
    });

    const bundle = buildFhirBundleFromFormData(handover, { now: () => '2025-01-05T16:00:00Z' });
    const resources = bundle.entry.map((entry) => entry.resource as any);

    const nandaCondition = resources.find(
      (resource) =>
        resource.resourceType === 'Condition' &&
        resource.code?.coding?.some((coding: any) => coding.system === NANDA_DIAGNOSIS_SYSTEM_URI),
    );
    const nicProcedure = resources.find(
      (resource) =>
        resource.resourceType === 'Procedure' &&
        resource.code?.coding?.some((coding: any) => coding.system === NIC_INTERVENTION_SYSTEM_URI),
    );
    const nocObservation = resources.find(
      (resource) =>
        resource.resourceType === 'Observation' &&
        resource.code?.coding?.some((coding: any) => coding.system === NOC_OUTCOME_SYSTEM_URI),
    );

    expect(nandaCondition?.code?.coding).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ system: NANDA_DIAGNOSIS_SYSTEM_URI, code: '00030' }),
      ]),
    );
    expect(nicProcedure?.code?.coding).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ system: NIC_INTERVENTION_SYSTEM_URI, code: '2210' }),
      ]),
    );
    expect(nocObservation?.category).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          coding: expect.arrayContaining([
            expect.objectContaining({ code: 'outcome' }),
          ]),
        }),
      ]),
    );
    expect(nocObservation?.component).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: expect.objectContaining({
            coding: expect.arrayContaining([expect.objectContaining({ code: 'baseline' })]),
          }),
          valueInteger: 2,
        }),
        expect.objectContaining({
          code: expect.objectContaining({
            coding: expect.arrayContaining([expect.objectContaining({ code: 'target' })]),
          }),
          valueInteger: 4,
        }),
      ]),
    );
  });
  it('maps dxNursing legacy text fallback without pressure-ulcer-risk categorization', () => {
    const handover: HandoverData = zHandover.parse({
      administrativeData: {
        unit: 'UCI',
        census: 8,
        staffIn: ['Nurse In'],
        staffOut: ['Nurse Out'],
        shiftStart: '2025-01-05T08:00:00Z',
        shiftEnd: '2025-01-05T16:00:00Z',
        shiftType: 'Mañana',
      },
      patientId: 'patient-legacy-nursing-1',
      bedsideChecklist: {
        patientIdentityConfirmed: true,
        allergiesReviewed: true,
        linesAndDevicesChecked: true,
        medicationPlanReviewed: true,
        safetyMeasuresApplied: true,
        questionsAnswered: true,
      },
      dxMedical: makeCoding('195967001', 'Neumonía'),
      dxNursing: 'Dolor agudo',
      dxNursingStructured: [],
    });

    const bundle = buildFhirBundleFromFormData(handover, { now: () => '2025-01-05T16:00:00Z' });
    const legacyCondition = bundle.entry
      .map((entry) => entry.resource)
      .find((resource) => resource.resourceType === 'Condition' && resource.code?.text === 'Dolor agudo') as any;

    expect(legacyCondition).toBeDefined();
    const categoryCodings = (legacyCondition.category ?? []).flatMap((cat: any) => cat.coding ?? []);
    expect(categoryCodings.some((coding: any) => coding.code === '714658008')).toBe(false);
  });

  it('does not classify dxMedical as fall risk in diagnosis mapping', () => {
    const handover: HandoverData = zHandover.parse({
      administrativeData: {
        unit: 'UCI',
        census: 8,
        staffIn: ['Nurse In'],
        staffOut: ['Nurse Out'],
        shiftStart: '2025-01-05T08:00:00Z',
        shiftEnd: '2025-01-05T16:00:00Z',
        shiftType: 'Mañana',
      },
      patientId: 'patient-medical-dx-1',
      bedsideChecklist: {
        patientIdentityConfirmed: true,
        allergiesReviewed: true,
        linesAndDevicesChecked: true,
        medicationPlanReviewed: true,
        safetyMeasuresApplied: true,
        questionsAnswered: true,
      },
      dxMedical: makeCoding('195967001', 'Neumonía'),
      dxNursing: '',
      dxNursingStructured: [],
    });

    const bundle = buildFhirBundleFromFormData(handover, { now: () => '2025-01-05T16:00:00Z' });
    const medicalCondition = bundle.entry
      .map((entry) => entry.resource)
      .find(
        (resource) =>
          resource.resourceType === 'Condition' &&
          resource.code?.coding?.[0]?.system === SNOMED_SYSTEM &&
          resource.code?.coding?.[0]?.code === '195967001',
      ) as any;

    expect(medicalCondition).toBeDefined();
    const categoryCodings = (medicalCondition.category ?? []).flatMap((cat: any) => cat.coding ?? []);
    expect(categoryCodings.some((coding: any) => coding.code === '129839007')).toBe(false);
  });

  it('creates a transaction bundle valid for handover data', () => {
    const handover: HandoverData = zHandover.parse({
      administrativeData: {
        unit: 'UCI',
        census: 10,
        staffIn: ['Nurse In'],
        staffOut: ['Nurse Out'],
        shiftStart: '2025-01-05T08:00:00Z',
        shiftEnd: '2025-01-05T16:00:00Z',
        shiftType: 'Mañana',
        incidents: ['Sin incidentes'],
      },
      status: 'final',
      patientId: 'patient-zod-1',
      vitals: { hr: 80, rr: 18, tempC: 37.1, spo2: 97, sbp: 120, dbp: 78 },
      dxMedical: makeCoding('195967001', 'Neumonía'),
      dxNursing: makeCoding('370143000', 'Caída accidental'),
      evolution: 'Paciente estable, responde bien a la oxigenoterapia',
      closingSummary: 'Turno sin novedades relevantes',
      sbarSituation: 'Paciente ingresó por neumonía',
      sbarBackground: 'Sin comorbilidades previas relevantes',
      sbarAssessment: 'Sat 97% con oxígeno a 2 L/min',
      sbarRecommendation: 'Continuar antibiótico IV y vigilancia de signos',
      medications: [
        { id: 'med-1', name: 'Paracetamol', dose: '1 g', route: 'iv', frequency: 'c/8h' },
      ],
      treatments: [
        { id: 'tx-1', type: 'woundCare', description: 'Cambio de apósito', scheduledAt: '2025-01-05T12:00:00Z' },
      ],
      oxygenTherapy: { flowLMin: 2, deviceDisplay: 'Cánula nasal' },
      nutrition: { dietType: 'oral', tolerance: 'Buena', intakeMl: 1200 },
      elimination: { urineMl: 900, stoolPattern: 'normal', hasRectalTube: false },
      mobility: { mobilityLevel: 'independent' },
      skin: { skinStatus: 'Piel íntegra', hasPressureInjury: false },
      fluidBalance: { intakeMl: 1200, outputMl: 900, netBalanceMl: 300 },
      painAssessment: { hasPain: true, evaScore: 3, location: 'Torácico', actionsTaken: 'Analgesia' },
      braden: {
        sensoryPerception: 3,
        moisture: 3,
        activity: 3,
        mobility: 3,
        nutrition: 3,
        frictionShear: 3,
        totalScore: 18,
        riskLevel: 'bajo',
      },
      glasgow: { eye: 4, verbal: 5, motor: 6, total: 15, severity: 'leve' },
      bedsideChecklist: {
        patientIdentityConfirmed: true,
        allergiesReviewed: true,
        linesAndDevicesChecked: true,
        medicationPlanReviewed: true,
        safetyMeasuresApplied: true,
        questionsAnswered: true,
      },
      risksStructured: [{ type: 'fall', present: true, notes: 'Precaución al movilizar' }],
      signatures: {
        outgoing: {
          userId: 'nurse-1',
          fullName: 'Nurse Example',
          unitId: 'UCI-1',
          signedAt: '2025-01-05T16:00:00Z',
          imageBase64: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJ',
          method: 'session',
        },
      },
      audioUri: 'https://example.org/audio/shift.m4a',
    });

    const bundle = buildFhirBundleFromFormData(handover, { now: () => '2025-01-05T16:00:00Z' });
    const validation = validateBundle(bundle);
    expect(bundle.resourceType).toBe('Bundle');
    expect(bundle.type).toBe('transaction');
    expect(validation.ok).toBe(true);
    expect(validation.errors).toHaveLength(0);

    const resourcesByType = bundle.entry.reduce<Record<string, number>>((acc, entry) => {
      const type = entry.resource.resourceType;
      acc[type] = (acc[type] ?? 0) + 1;
      return acc;
    }, {});

    expect(resourcesByType.Patient).toBe(1);
    expect(resourcesByType.Composition).toBe(1);
    expect((resourcesByType.Observation ?? 0) > 0).toBe(true);
    expect((resourcesByType.MedicationStatement ?? 0) > 0).toBe(true);
    expect(bundle.entry.every((entry) => entry.request.method === 'POST')).toBe(true);

    const composition = bundle.entry.find((entry) => entry.resource.resourceType === 'Composition')
      ?.resource as any;
    expect(composition?.event?.[0]?.period).toEqual({
      start: '2025-01-05T08:00:00Z',
      end: '2025-01-05T16:00:00Z',
    });
  });
});

