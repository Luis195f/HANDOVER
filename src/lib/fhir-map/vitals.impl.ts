import { GLUCOSE_MMOL_TO_MGDL_FACTOR } from '@/src/validation/normalization';

import { FHIR_CODES, TERMINOLOGY_SYSTEMS, type TerminologyCode } from '../codes';
import type {
  BuildOptions,
  CodeableConcept,
  Observation,
  ObservationComponent,
  ObservationVitalsInput,
  OxygenValues,
  Reference,
  ResolvedBuildOptions,
  VitalsValues,
} from '../fhir-map';

export type VitalsMapperDependencies = {
  resolveOptions: (options?: BuildOptions) => ResolvedBuildOptions;
  patientReference: (patientId: string) => Reference;
  encounterReference: (encounterId?: string) => Reference | undefined;
  codeableConceptFromCode: (
    code: TerminologyCode<string>,
    overrideText?: string,
  ) => CodeableConcept;
  quantity: (value: number, unit: string, code: string) => Observation['valueQuantity'];
  normalizeIsoDateTimeValue: (value?: string) => string | undefined;
  observationVitalsSchema: { parse: (values: ObservationVitalsInput) => ObservationVitalsInput };
  oxygenTherapySchema: {
    parse: (values: NonNullable<OxygenValues['oxygenTherapy']>) => NonNullable<OxygenValues['oxygenTherapy']>;
  };
  avpuMap: Record<string, { code: string; display: string }>;
  profileVitalSigns: string;
  profileBloodPressure: string;
  profileObservation: string;
  vitalCategoryConcept: CodeableConcept;
  laboratoryCategoryConcept: CodeableConcept;
};

const ensureEffectiveDate = (
  parsed: ObservationVitalsInput,
  optionsMerged: ResolvedBuildOptions,
): { effective: string; issued: string } => {
  const effective = parsed.recordedAt ?? optionsMerged.now();
  const issued = parsed.issuedAt ?? effective;
  return { effective, issued };
};

export function mapObservationVitalsImpl(
  deps: VitalsMapperDependencies,
  values: ObservationVitalsInput,
  options?: BuildOptions,
): Observation[] {
  const hasMeasurement =
    values.hr !== undefined ||
    values.rr !== undefined ||
    values.tempC !== undefined ||
    values.spo2 !== undefined ||
    values.sbp !== undefined ||
    values.dbp !== undefined ||
    values.glucoseMgDl !== undefined ||
    values.glucoseMmolL !== undefined ||
    values.avpu !== undefined;

  if (!hasMeasurement) {
    return [];
  }

  const optionsMerged = deps.resolveOptions(options);
  const parsed = deps.observationVitalsSchema.parse(values);
  const { effective, issued } = ensureEffectiveDate(parsed, optionsMerged);
  const subject = deps.patientReference(parsed.patientId);
  const encounter = deps.encounterReference(parsed.encounterId);
  const glucoseDecimals = optionsMerged.glucoseDecimals ?? 0;

  const observations: Observation[] = [];

  if (parsed.sbp !== undefined || parsed.dbp !== undefined) {
    const components: ObservationComponent[] = [];
    if (parsed.sbp !== undefined) {
      components.push({
        code: deps.codeableConceptFromCode(FHIR_CODES.VITALS.BP_SYSTOLIC),
        valueQuantity: deps.quantity(parsed.sbp, 'mm[Hg]', 'mm[Hg]'),
      });
    }
    if (parsed.dbp !== undefined) {
      components.push({
        code: deps.codeableConceptFromCode(FHIR_CODES.VITALS.BP_DIASTOLIC),
        valueQuantity: deps.quantity(parsed.dbp, 'mm[Hg]', 'mm[Hg]'),
      });
    }
    observations.push({
      resourceType: 'Observation',
      meta: { profile: [deps.profileBloodPressure, deps.profileVitalSigns] },
      status: 'final',
      category: [deps.vitalCategoryConcept],
      code: deps.codeableConceptFromCode(FHIR_CODES.VITALS.BP_PANEL),
      subject,
      encounter,
      effectiveDateTime: effective,
      issued,
      component: components,
    });
  }

  if (parsed.hr !== undefined) {
    observations.push({
      resourceType: 'Observation',
      meta: { profile: [deps.profileVitalSigns] },
      status: 'final',
      category: [deps.vitalCategoryConcept],
      code: deps.codeableConceptFromCode(FHIR_CODES.VITALS.HEART_RATE),
      subject,
      encounter,
      effectiveDateTime: effective,
      issued,
      valueQuantity: deps.quantity(parsed.hr, '/min', '/min'),
    });
  }

  if (parsed.rr !== undefined) {
    observations.push({
      resourceType: 'Observation',
      meta: { profile: [deps.profileVitalSigns] },
      status: 'final',
      category: [deps.vitalCategoryConcept],
      code: deps.codeableConceptFromCode(FHIR_CODES.VITALS.RESP_RATE),
      subject,
      encounter,
      effectiveDateTime: effective,
      issued,
      valueQuantity: deps.quantity(parsed.rr, '/min', '/min'),
    });
  }

  if (parsed.tempC !== undefined) {
    observations.push({
      resourceType: 'Observation',
      meta: { profile: [deps.profileVitalSigns] },
      status: 'final',
      category: [deps.vitalCategoryConcept],
      code: deps.codeableConceptFromCode(FHIR_CODES.VITALS.TEMPERATURE),
      subject,
      encounter,
      effectiveDateTime: effective,
      issued,
      valueQuantity: deps.quantity(parsed.tempC, '°C', 'Cel'),
    });
  }

  if (parsed.spo2 !== undefined) {
    observations.push({
      resourceType: 'Observation',
      meta: { profile: [deps.profileVitalSigns] },
      status: 'final',
      category: [deps.vitalCategoryConcept],
      code: deps.codeableConceptFromCode(FHIR_CODES.VITALS.SPO2),
      subject,
      encounter,
      effectiveDateTime: effective,
      issued,
      valueQuantity: deps.quantity(parsed.spo2, '%', '%'),
    });
  }

  if (parsed.glucoseMgDl !== undefined || parsed.glucoseMmolL !== undefined) {
    const factor = GLUCOSE_MMOL_TO_MGDL_FACTOR;
    const valueMgDl =
      parsed.glucoseMgDl !== undefined
        ? parsed.glucoseMgDl
        : Number((parsed.glucoseMmolL! * factor).toFixed(glucoseDecimals));

    observations.push({
      resourceType: 'Observation',
      meta: { profile: [deps.profileObservation] },
      status: 'final',
      category: [deps.laboratoryCategoryConcept],
      code: deps.codeableConceptFromCode(FHIR_CODES.VITALS.GLUCOSE_MASS_BLD),
      subject,
      encounter,
      effectiveDateTime: effective,
      issued,
      valueQuantity: deps.quantity(valueMgDl, 'mg/dL', 'mg/dL'),
      note:
        parsed.glucoseMgDl === undefined && parsed.glucoseMmolL !== undefined
          ? [{ text: `Convertido desde ${parsed.glucoseMmolL} mmol/L (factor ${factor}).` }]
          : undefined,
    });
  }

  if (parsed.avpu !== undefined) {
    const details = deps.avpuMap[parsed.avpu];
    observations.push({
      resourceType: 'Observation',
      meta: { profile: [deps.profileVitalSigns] },
      status: 'final',
      category: [deps.vitalCategoryConcept],
      code: deps.codeableConceptFromCode(FHIR_CODES.VITALS.ACVPU, 'AVPU scale'),
      subject,
      encounter,
      effectiveDateTime: effective,
      issued,
      valueCodeableConcept: {
        coding: [
          {
            system: TERMINOLOGY_SYSTEMS.SNOMED,
            code: details.code,
            display: details.display,
          },
        ],
        text: details.display,
      },
    });
  }

  return observations;
}

export function mapVitalsToObservationsImpl(
  deps: VitalsMapperDependencies,
  input: { patientId: string; encounterId?: string; vitals?: VitalsValues },
  options?: BuildOptions,
): Observation[] {
  if (!input.vitals) {
    return [];
  }

  const sanitizeNumber = (value: unknown, min: number, max: number) =>
    Number.isFinite(value) && Number(value) >= min && Number(value) <= max
      ? Number(value)
      : undefined;
  const rawVitals = input.vitals as VitalsValues & {
    bgMgDl?: number;
    bgMmolL?: number;
    temp?: number;
    acvpu?: ObservationVitalsInput['avpu'];
  };
  const legacyBgMgDl = (input.vitals as { bgMgDl?: number }).bgMgDl;
  const legacyBgMmolL = (input.vitals as { bgMmolL?: number }).bgMmolL;
  const glucoseMgDl = Number.isFinite(input.vitals.glucoseMgDl)
    ? input.vitals.glucoseMgDl
    : undefined;
  const glucoseMmolL = Number.isFinite(input.vitals.glucoseMmolL)
    ? input.vitals.glucoseMmolL
    : undefined;
  const tempValue = Number.isFinite(rawVitals.tempC)
    ? rawVitals.tempC
    : Number.isFinite(rawVitals.temp)
      ? rawVitals.temp
      : undefined;
  const rawAvpu = rawVitals.avpu ?? rawVitals.acvpu;
  const avpuValue = typeof rawAvpu === 'string' && rawAvpu in deps.avpuMap ? rawAvpu : undefined;
  const recordedAt = typeof rawVitals.recordedAt === 'string' ? rawVitals.recordedAt : undefined;
  const issuedAt = typeof rawVitals.issuedAt === 'string' ? rawVitals.issuedAt : undefined;

  const normalizedVitals: VitalsValues = {
    hr: sanitizeNumber(rawVitals.hr, 30, 220),
    rr: sanitizeNumber(rawVitals.rr, 5, 60),
    tempC: sanitizeNumber(tempValue, 30, 45),
    spo2: sanitizeNumber(rawVitals.spo2, 50, 100),
    sbp: sanitizeNumber(rawVitals.sbp, 60, 260),
    dbp: sanitizeNumber(rawVitals.dbp, 30, 160),
    glucoseMgDl: sanitizeNumber(
      glucoseMgDl ?? (Number.isFinite(legacyBgMgDl) ? legacyBgMgDl : undefined),
      20,
      1000,
    ),
    glucoseMmolL: sanitizeNumber(
      glucoseMmolL ?? (Number.isFinite(legacyBgMmolL) ? legacyBgMmolL : undefined),
      1,
      55,
    ),
    avpu: avpuValue,
    recordedAt,
    issuedAt,
  };

  const baseObservations = mapObservationVitalsImpl(
    deps,
    {
      patientId: input.patientId,
      encounterId: input.encounterId,
      ...normalizedVitals,
    },
    options,
  );

  const filteredObservations = baseObservations.filter(
    (observation) =>
      !observation.code?.coding?.some(
        (coding) =>
          coding.system === TERMINOLOGY_SYSTEMS.LOINC &&
          coding.code === FHIR_CODES.VITALS.BP_PANEL.code,
      ),
  );

  if (normalizedVitals.sbp === undefined && normalizedVitals.dbp === undefined) {
    return filteredObservations;
  }

  const optionsMerged = deps.resolveOptions(options);
  const normalizedRecordedAt = deps.normalizeIsoDateTimeValue(normalizedVitals.recordedAt);
  const normalizedIssuedAt = deps.normalizeIsoDateTimeValue(normalizedVitals.issuedAt);
  const effective = normalizedRecordedAt ?? optionsMerged.now();
  const issued = normalizedIssuedAt ?? effective;
  const subject = deps.patientReference(input.patientId);
  const encounter = deps.encounterReference(input.encounterId);

  const bpIndividuals: Observation[] = [];
  if (normalizedVitals.sbp !== undefined) {
    bpIndividuals.push({
      resourceType: 'Observation',
      meta: { profile: [deps.profileVitalSigns] },
      status: 'final',
      category: [deps.vitalCategoryConcept],
      code: deps.codeableConceptFromCode(FHIR_CODES.VITALS.BP_SYSTOLIC),
      subject,
      encounter,
      effectiveDateTime: effective,
      issued,
      valueQuantity: deps.quantity(normalizedVitals.sbp, 'mm[Hg]', 'mm[Hg]'),
    });
  }
  if (normalizedVitals.dbp !== undefined) {
    bpIndividuals.push({
      resourceType: 'Observation',
      meta: { profile: [deps.profileVitalSigns] },
      status: 'final',
      category: [deps.vitalCategoryConcept],
      code: deps.codeableConceptFromCode(FHIR_CODES.VITALS.BP_DIASTOLIC),
      subject,
      encounter,
      effectiveDateTime: effective,
      issued,
      valueQuantity: deps.quantity(normalizedVitals.dbp, 'mm[Hg]', 'mm[Hg]'),
    });
  }

  return [...filteredObservations, ...bpIndividuals];
}

export function mapOxygenObservationsImpl(
  deps: VitalsMapperDependencies,
  values: OxygenValues,
  options?: BuildOptions,
): Observation[] {
  if (!values.oxygenTherapy) return [];
  const optionsMerged = deps.resolveOptions(options);
  const parsed = deps.oxygenTherapySchema.parse(values.oxygenTherapy);
  const subject = deps.patientReference(values.patientId);
  const encounter = deps.encounterReference(values.encounterId);
  const effective = parsed.start ?? optionsMerged.now();
  const issued = optionsMerged.now();

  const observations: Observation[] = [];

  if (parsed.fio2 !== undefined) {
    observations.push({
      resourceType: 'Observation',
      meta: { profile: [deps.profileVitalSigns] },
      status: 'final',
      category: [deps.vitalCategoryConcept],
      code: deps.codeableConceptFromCode(FHIR_CODES.VITALS.FIO2),
      subject,
      encounter,
      effectiveDateTime: effective,
      issued,
      valueQuantity: deps.quantity(parsed.fio2, '%', '%'),
    });
  }

  if (parsed.flowLMin !== undefined) {
    observations.push({
      resourceType: 'Observation',
      meta: { profile: [deps.profileVitalSigns] },
      status: 'final',
      category: [deps.vitalCategoryConcept],
      code: deps.codeableConceptFromCode(FHIR_CODES.VITALS.O2_FLOW),
      subject,
      encounter,
      effectiveDateTime: effective,
      issued,
      valueQuantity: deps.quantity(parsed.flowLMin, 'L/min', 'L/min'),
    });
  }

  return observations;
}


