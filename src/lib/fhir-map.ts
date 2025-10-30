import { z } from 'zod';

import { CATEGORY, LOINC, SNOMED } from './codes';
import { hashHex, fhirId } from './crypto';

const DEFAULT_OPTS = { now: () => new Date().toISOString() } as const;
const resolveOptions = (options?: Partial<typeof DEFAULT_OPTS>) =>
  ({ ...DEFAULT_OPTS, ...options }) as typeof DEFAULT_OPTS;

type ISODateTimeString = `${number}-${number}-${number}T${string}`;

type Coding = {
  system: string;
  code: string;
  display?: string;
};

type CodeableConcept = {
  coding: Coding[];
  text?: string;
};

type Quantity = {
  value: number;
  unit?: string;
  system?: string;
  code?: string;
};

type Reference = {
  reference: string;
  type?: string;
  display?: string;
};

type Meta = {
  profile: readonly string[];
};

type Annotation = {
  text: string;
};

type Period = {
  start: string;
  end?: string;
};

type ObservationComponent = {
  code: CodeableConcept;
  valueQuantity?: Quantity;
};

type Observation = {
  resourceType: 'Observation';
  id?: string;
  meta?: Meta;
  status: 'final';
  category: CodeableConcept[];
  code: CodeableConcept;
  subject: Reference;
  encounter?: Reference;
  effectiveDateTime: string;
  issued?: string;
  valueQuantity?: Quantity;
  component?: ObservationComponent[];
};

type MedicationStatement = {
  resourceType: 'MedicationStatement';
  id?: string;
  status: 'active' | 'completed' | 'intended';
  medicationCodeableConcept: CodeableConcept;
  subject: Reference;
  encounter?: Reference;
  effectivePeriod?: Period;
  dateAsserted: string;
  note?: Annotation[];
};

type Procedure = {
  resourceType: 'Procedure';
  id?: string;
  status: 'in-progress' | 'completed';
  code: CodeableConcept;
  subject: Reference;
  encounter?: Reference;
  performedDateTime?: string;
  performedPeriod?: Period;
  reasonCode?: CodeableConcept[];
  bodySite?: CodeableConcept[];
  note?: Annotation[];
};

type DeviceUseStatement = {
  resourceType: 'DeviceUseStatement';
  id?: string;
  status: 'active' | 'completed';
  subject: Reference;
  encounter?: Reference;
  device: Reference;
  timingPeriod?: Period;
  reasonCode?: CodeableConcept[];
  note?: Annotation[];
};

type Attachment = {
  contentType: string;
  url?: string;
  data?: string;
  size?: number;
  hash?: string;
  title?: string;
};

type DocumentReferenceContent = {
  attachment: Attachment;
};

type DocumentReference = {
  resourceType: 'DocumentReference';
  id?: string;
  status: 'current';
  type?: CodeableConcept;
  category?: CodeableConcept[];
  subject: Reference;
  encounter?: Reference;
  author?: Reference[];
  date: string;
  content: DocumentReferenceContent[];
};

type CompositionAttester = {
  mode: 'professional' | 'legal' | 'official' | 'personal';
  time?: string;
  party?: Reference;
};

type CompositionSection = {
  title: string;
  code?: CodeableConcept;
  entry: Reference[];
};

type Composition = {
  resourceType: 'Composition';
  id?: string;
  status: 'final' | 'amended';
  type: CodeableConcept;
  subject: Reference;
  encounter?: Reference;
  date: string;
  author: Reference[];
  title: string;
  attester?: CompositionAttester[];
  section?: CompositionSection[];
};

type FhirResource = Observation | MedicationStatement | Procedure | DeviceUseStatement | DocumentReference | Composition;

type BundleEntry = {
  fullUrl: string;
  resource: FhirResource;
  request: {
    method: 'POST';
    url: string;
  };
};

type Bundle = {
  resourceType: 'Bundle';
  type: 'transaction';
  entry: BundleEntry[];
};

const TEST_LOINC = {
  ...LOINC,
  BP_PANEL: LOINC.bpPanel,
  SBP: LOINC.sbp,
  DBP: LOINC.dbp,
  RR: LOINC.rr,
  SPO2: LOINC.spo2,
  TEMP: LOINC.temp,
  HR: LOINC.hr,
  GLUCOSE_MGDL: LOINC.glucoseMgDl,
  GLUCOSE_MMOLL: LOINC.glucoseMmolL,
  FIO2: '3151-8',
  O2_FLOW: '3150-0',
} as const;

const PROFILE_VITAL_SIGNS = 'http://hl7.org/fhir/StructureDefinition/vitalsigns';
const PROFILE_BLOOD_PRESSURE = 'http://hl7.org/fhir/StructureDefinition/bp';
const DEFAULT_COMPOSITION_TYPE: CodeableConcept = {
  coding: [
    {
      system: 'http://loinc.org',
      code: '11503-0',
      display: 'Discharge summary',
    },
  ],
  text: 'Clinical handover',
};

const vitalCategoryConcept: CodeableConcept = {
  coding: [
    {
      system: CATEGORY.vitalSigns.system,
      code: CATEGORY.vitalSigns.code,
      display: 'Vital Signs',
    },
  ],
};

const isoDateTime = z
  .string()
  .datetime({ offset: true })
  .transform((value) => new Date(value).toISOString());

const ObservationVitalsSchema = z.object({
  patientId: z.string().min(1),
  encounterId: z.string().min(1).optional(),
  recordedAt: isoDateTime.optional(),
  issuedAt: isoDateTime.optional(),
  hr: z.number().min(30).max(220).optional(),
  rr: z.number().min(5).max(60).optional(),
  tempC: z.number().min(30).max(45).optional(),
  spo2: z.number().min(50).max(100).optional(),
  sbp: z.number().min(60).max(260).optional(),
  dbp: z.number().min(30).max(160).optional(),
  glucoseMgDl: z.number().min(20).max(1000).optional(),
  glucoseMmolL: z.number().min(1).max(55).optional(),
});

const MedicationCodingSchema = z.object({
  system: z.string().min(1),
  code: z.string().min(1),
  display: z.string().optional(),
});

const MedicationStatementSchema = z
  .object({
    status: z.enum(['active', 'completed', 'intended']).default('active'),
    code: MedicationCodingSchema.optional(),
    display: z.string().optional(),
    note: z.string().optional(),
    start: isoDateTime.optional(),
    end: isoDateTime.optional(),
  })
  .refine((value) => value.code !== undefined || value.display !== undefined, {
    message: 'Medication requires a coded concept or display text',
    path: ['code'],
  })
  .refine((value) => {
    if (!value.start || !value.end) return true;
    return value.start <= value.end;
  }, {
    message: 'Medication end must be after start',
    path: ['end'],
  });

const OxygenTherapySchema = z
  .object({
    status: z.enum(['in-progress', 'completed']).default('in-progress'),
    start: isoDateTime.optional(),
    end: isoDateTime.optional(),
    reason: z.string().optional(),
    bodySite: z.string().optional(),
    note: z.string().optional(),
    deviceId: z.string().optional(),
    deviceDisplay: z.string().optional(),
  })
  .refine((value) => {
    if (!value.start && !value.end) return true;
    if (value.start && value.end) {
      return value.start <= value.end;
    }
    return true;
  }, {
    message: 'Oxygen therapy end must be after start',
    path: ['end'],
  });

const SecureUrlSchema = z
  .string()
  .url()
  .refine((value) => value.startsWith('https://'), {
    message: 'Attachment URL must be secure (https)',
  });

const AudioAttachmentSchema = z
  .object({
    url: SecureUrlSchema.optional(),
    dataBase64: z
      .string()
      .regex(/^[A-Za-z0-9+/=]+$/)
      .optional(),
    size: z.number().int().positive().optional(),
    hash: z.string().optional(),
    contentType: z.string().min(1).default('audio/m4a'),
    title: z.string().optional(),
  })
  .refine((value) => value.url !== undefined || value.dataBase64 !== undefined, {
    message: 'Audio attachment requires a secure URL or base64 data',
    path: ['url'],
  })
  .refine((value) => {
    if (value.dataBase64) {
      return value.size !== undefined && value.hash !== undefined;
    }
    return true;
  }, {
    message: 'Base64 audio requires size and hash',
    path: ['size'],
  });

const AttesterSchema = z.object({
  mode: z.enum(['professional', 'legal', 'official', 'personal']),
  time: isoDateTime.optional(),
  partyReference: z.string().optional(),
  partyDisplay: z.string().optional(),
});

type ObservationVitalsInput = z.infer<typeof ObservationVitalsSchema>;
type MedicationStatementInput = z.infer<typeof MedicationStatementSchema>;
type OxygenTherapyInput = z.infer<typeof OxygenTherapySchema>;
type AudioAttachmentInput = z.infer<typeof AudioAttachmentSchema>;
type AttesterInput = z.infer<typeof AttesterSchema>;

type MedicationValues = {
  patientId: string;
  encounterId?: string;
  medications?: MedicationStatementInput[];
};

type OxygenValues = {
  patientId: string;
  encounterId?: string;
  oxygenTherapy?: OxygenTherapyInput | null;
};

type DocumentValues = {
  patientId: string;
  encounterId?: string;
  author?: AuthorInput;
  audioAttachment?: AudioAttachmentInput | null;
};

type CompositionValues = {
  patientId: string;
  encounterId?: string;
  author?: AuthorInput;
  composition?: CompositionInput;
};

type BundleReferenceIndex = {
  vitals: string[];
  medications: string[];
  oxygen: string[];
  attachments: string[];
};

export type AuthorInput = {
  reference?: string;
  type?: string;
  id?: string;
  display?: string;
};

export type CompositionInput = {
  status?: 'final' | 'amended';
  title?: string;
  type?: CodeableConcept;
  attesters?: AttesterInput[];
};

export type VitalsValues = Omit<ObservationVitalsInput, 'patientId' | 'encounterId'>;

export type HandoverValues = {
  patientId: string;
  encounterId?: string;
  author?: AuthorInput;
  vitals?: VitalsValues;
  medications?: MedicationStatementInput[];
  oxygenTherapy?: OxygenTherapyInput | null;
  audioAttachment?: AudioAttachmentInput | null;
  composition?: CompositionInput;
};

export type HandoverInput = HandoverValues | { values: HandoverValues };

export type BuildOptions = Partial<typeof DEFAULT_OPTS>;

const UCUM = 'http://unitsofmeasure.org';

function patientReference(patientId: string): Reference {
  return { reference: `Patient/${patientId}`, type: 'Patient' };
}

function encounterReference(encounterId?: string): Reference | undefined {
  if (!encounterId) return undefined;
  return { reference: `Encounter/${encounterId}`, type: 'Encounter' };
}

function codingFromLoinc(code: string, display: string): CodeableConcept {
  return {
    coding: [
      {
        system: 'http://loinc.org',
        code,
        display,
      },
    ],
    text: display,
  };
}

function quantity(value: number, unit: string, code: string): Quantity {
  return {
    value,
    unit,
    system: UCUM,
    code,
  };
}

function ensureAuthorReference(values: { author?: AuthorInput }): Reference {
  const author = values.author;
  if (author?.reference) {
    return {
      reference: author.reference,
      type: author.type,
      display: author.display,
    };
  }
  const id = author?.id ?? 'handover-app';
  return {
    reference: `Practitioner/${id}`,
    type: 'Practitioner',
    display: author?.display ?? 'Handover Practitioner',
  };
}

function mapAttesters(inputs?: CompositionInput['attesters']): CompositionAttester[] | undefined {
  if (!inputs || inputs.length === 0) return undefined;
  return inputs.map((attester) => {
    const base: CompositionAttester = {
      mode: attester.mode,
    };
    if (attester.time) {
      base.time = attester.time;
    }
    if (attester.partyReference || attester.partyDisplay) {
      base.party = {
        reference: attester.partyReference ?? '',
        display: attester.partyDisplay,
      };
    }
    return base;
  });
}

function stableHash(...parts: string[]): string {
  return hashHex(parts.join('|'), 32);
}

const stableUrn = (...parts: string[]) => `urn:uuid:${stableHash(...parts)}`;

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(',')}]`;
  }
  const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) =>
    a.localeCompare(b),
  );
  return `{${entries
    .map(([key, val]) => `${JSON.stringify(key)}:${stableStringify(val)}`)
    .join(',')}}`;
}

const FHIR_ID_PREFIX: Record<FhirResource['resourceType'], string> = {
  Observation: 'obs-',
  MedicationStatement: 'ms-',
  Procedure: 'proc-',
  DeviceUseStatement: 'dus-',
  DocumentReference: 'doc-',
  Composition: 'comp-',
};

function assignStableIds(
  resource: FhirResource,
  patientId: string,
): { resource: FhirResource; fullUrl: string } {
  const { id: _ignored, ...rest } = resource;
  const key = `${resource.resourceType}|${patientId}|${stableStringify(rest)}`;
  const prefix = FHIR_ID_PREFIX[resource.resourceType] ?? '';
  const id = fhirId(prefix, key);
  const urn = `urn:uuid:${hashHex(key, 32)}`;
  const withId = { ...resource, id } as FhirResource;
  return { resource: withId, fullUrl: urn };
}

function ensureEffectiveDate(
  parsed: ObservationVitalsInput,
  optionsMerged: typeof DEFAULT_OPTS,
): { effective: string; issued: string } {
  const effective = parsed.recordedAt ?? optionsMerged.now();
  const issued = parsed.issuedAt ?? effective;
  return { effective, issued };
}

export function mapObservationVitals(
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
    values.glucoseMmolL !== undefined;

  if (!hasMeasurement) {
    return [];
  }

  const optionsMerged = resolveOptions(options);
  const parsed = ObservationVitalsSchema.parse(values);
  const { effective, issued } = ensureEffectiveDate(parsed, optionsMerged);
  const subject = patientReference(parsed.patientId);
  const encounter = encounterReference(parsed.encounterId);

  const observations: Observation[] = [];

  if (parsed.sbp !== undefined || parsed.dbp !== undefined) {
    const components: ObservationComponent[] = [];
    if (parsed.sbp !== undefined) {
      components.push({
        code: codingFromLoinc(LOINC.sbp, 'Systolic blood pressure'),
        valueQuantity: quantity(parsed.sbp, 'mm[Hg]', 'mm[Hg]'),
      });
    }
    if (parsed.dbp !== undefined) {
      components.push({
        code: codingFromLoinc(LOINC.dbp, 'Diastolic blood pressure'),
        valueQuantity: quantity(parsed.dbp, 'mm[Hg]', 'mm[Hg]'),
      });
    }
    observations.push({
      resourceType: 'Observation',
      meta: { profile: [PROFILE_BLOOD_PRESSURE] },
      status: 'final',
      category: [vitalCategoryConcept],
      code: codingFromLoinc(LOINC.bpPanel, 'Blood pressure panel'),
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
      meta: { profile: [PROFILE_VITAL_SIGNS] },
      status: 'final',
      category: [vitalCategoryConcept],
      code: codingFromLoinc(LOINC.hr, 'Heart rate'),
      subject,
      encounter,
      effectiveDateTime: effective,
      issued,
      valueQuantity: quantity(parsed.hr, 'beats/minute', '/min'),
    });
  }

  if (parsed.rr !== undefined) {
    observations.push({
      resourceType: 'Observation',
      meta: { profile: [PROFILE_VITAL_SIGNS] },
      status: 'final',
      category: [vitalCategoryConcept],
      code: codingFromLoinc(LOINC.rr, 'Respiratory rate'),
      subject,
      encounter,
      effectiveDateTime: effective,
      issued,
      valueQuantity: quantity(parsed.rr, 'breaths/minute', '/min'),
    });
  }

  if (parsed.tempC !== undefined) {
    observations.push({
      resourceType: 'Observation',
      meta: { profile: [PROFILE_VITAL_SIGNS] },
      status: 'final',
      category: [vitalCategoryConcept],
      code: codingFromLoinc(LOINC.temp, 'Body temperature'),
      subject,
      encounter,
      effectiveDateTime: effective,
      issued,
      valueQuantity: quantity(parsed.tempC, '°C', 'Cel'),
    });
  }

  if (parsed.spo2 !== undefined) {
    observations.push({
      resourceType: 'Observation',
      meta: { profile: [PROFILE_VITAL_SIGNS] },
      status: 'final',
      category: [vitalCategoryConcept],
      code: codingFromLoinc(LOINC.spo2, 'Oxygen saturation'),
      subject,
      encounter,
      effectiveDateTime: effective,
      issued,
      valueQuantity: quantity(parsed.spo2, '%', '%'),
    });
  }

  if (parsed.glucoseMgDl !== undefined) {
    observations.push({
      resourceType: 'Observation',
      meta: { profile: [PROFILE_VITAL_SIGNS] },
      status: 'final',
      category: [vitalCategoryConcept],
      code: codingFromLoinc(LOINC.glucoseMgDl, 'Glucose [Mass/volume] in Blood'),
      subject,
      encounter,
      effectiveDateTime: effective,
      issued,
      valueQuantity: quantity(parsed.glucoseMgDl, 'mg/dL', 'mg/dL'),
    });
  }

  if (parsed.glucoseMmolL !== undefined) {
    observations.push({
      resourceType: 'Observation',
      meta: { profile: [PROFILE_VITAL_SIGNS] },
      status: 'final',
      category: [vitalCategoryConcept],
      code: codingFromLoinc(LOINC.glucoseMmolL, 'Glucose [Moles/volume] in Blood'),
      subject,
      encounter,
      effectiveDateTime: effective,
      issued,
      valueQuantity: quantity(parsed.glucoseMmolL, 'mmol/L', 'mmol/L'),
    });
  }

  return observations;
}

export function mapMedicationStatements(
  values: MedicationValues,
  options?: BuildOptions,
): MedicationStatement[] {
  const optionsMerged = resolveOptions(options);
  if (!values.medications || values.medications.length === 0) {
    return [];
  }
  const subject = patientReference(values.patientId);
  const encounter = encounterReference(values.encounterId);
  const nowIso = optionsMerged.now();

  return values.medications.map((input) => {
    const parsed = MedicationStatementSchema.parse(input);
    const concept: CodeableConcept = parsed.code
      ? {
          coding: [parsed.code],
          text: parsed.display ?? parsed.code.display,
        }
      : {
          coding: [],
          text: parsed.display ?? 'Medication',
        };

    const period: Period | undefined = parsed.start || parsed.end
      ? {
          start: parsed.start ?? nowIso,
          end: parsed.end ?? undefined,
        }
      : undefined;

    const note = parsed.note ? [{ text: parsed.note }] : undefined;

    return {
      resourceType: 'MedicationStatement',
      status: parsed.status,
      medicationCodeableConcept: concept,
      subject,
      encounter,
      effectivePeriod: period,
      dateAsserted: nowIso,
      note,
    };
  });
}

export function mapDeviceUse(
  values: OxygenValues,
  options?: BuildOptions,
): Array<Procedure | DeviceUseStatement> {
  const optionsMerged = resolveOptions(options);
  if (!values.oxygenTherapy) return [];
  const parsed = OxygenTherapySchema.parse(values.oxygenTherapy);
  const subject = patientReference(values.patientId);
  const encounter = encounterReference(values.encounterId);

  const start = parsed.start ?? optionsMerged.now();
  const procedure: Procedure = {
    resourceType: 'Procedure',
    status: parsed.status,
    code: {
      coding: [
        {
          system: 'http://snomed.info/sct',
          code: SNOMED.oxygenTherapy,
          display: 'Administration of oxygen therapy',
        },
      ],
      text: 'Oxygen therapy',
    },
    subject,
    encounter,
  };

  if (parsed.end) {
    procedure.performedPeriod = { start, end: parsed.end };
  } else {
    procedure.performedDateTime = start;
  }

  if (parsed.reason) {
    procedure.reasonCode = [
      {
        coding: [
          {
            system: 'http://snomed.info/sct',
            code: parsed.reason,
          },
        ],
        text: parsed.reason,
      },
    ];
  }

  if (parsed.bodySite) {
    procedure.bodySite = [
      {
        coding: [
          {
            system: 'http://snomed.info/sct',
            code: parsed.bodySite,
            display: parsed.bodySite,
          },
        ],
        text: parsed.bodySite,
      },
    ];
  }

  if (parsed.note) {
    procedure.note = [{ text: parsed.note }];
  }

  const resources: Array<Procedure | DeviceUseStatement> = [procedure];

  if (parsed.deviceDisplay || parsed.deviceId) {
    resources.push({
      resourceType: 'DeviceUseStatement',
      status: parsed.end ? 'completed' : 'active',
      subject,
      encounter,
      device: {
        reference: parsed.deviceId ? `Device/${parsed.deviceId}` : 'Device/oxygen-source',
        display: parsed.deviceDisplay ?? 'Oxygen delivery device',
      },
      timingPeriod: parsed.end ? { start, end: parsed.end } : { start },
    });
  }

  return resources;
}

export function mapDocumentReferenceAudio(
  values: DocumentValues,
  options?: BuildOptions,
): DocumentReference | undefined {
  const optionsMerged = resolveOptions(options);
  if (!values.audioAttachment) return undefined;
  const parsed = AudioAttachmentSchema.parse(values.audioAttachment);
  const subject = patientReference(values.patientId);
  const encounter = encounterReference(values.encounterId);
  const authorRef = ensureAuthorReference(values);

  const attachment: Attachment = {
    contentType: parsed.contentType,
    title: parsed.title,
  };

  if (parsed.url) {
    attachment.url = parsed.url;
  }
  if (parsed.dataBase64) {
    attachment.data = parsed.dataBase64;
    attachment.size = parsed.size;
    attachment.hash = parsed.hash;
  }

  return {
    resourceType: 'DocumentReference',
    status: 'current',
    subject,
    encounter,
    author: [authorRef],
    date: optionsMerged.now(),
    content: [{ attachment }],
    category: [
      {
        coding: [
          {
            system: 'http://terminology.hl7.org/CodeSystem/document-classcodes',
            code: 'LP29684-5',
            display: 'Audio recording',
          },
        ],
        text: 'Audio handover',
      },
    ],
  };
}

export function buildComposition(
  values: CompositionValues,
  refs: BundleReferenceIndex,
  options?: BuildOptions,
): Composition {
  const optionsMerged = resolveOptions(options);
  const authorRef = ensureAuthorReference(values);
  const type = values.composition?.type ?? DEFAULT_COMPOSITION_TYPE;
  const status = values.composition?.status ?? 'final';
  const title = values.composition?.title ?? 'Clinical handover summary';
  const sections: CompositionSection[] = [];

  if (refs.vitals.length > 0) {
    sections.push({
      title: 'Vital signs',
      code: codingFromLoinc(LOINC.bpPanel, 'Vital signs'),
      entry: refs.vitals.map((reference) => ({ reference })),
    });
  }

  if (refs.medications.length > 0) {
    sections.push({
      title: 'Medications',
      entry: refs.medications.map((reference) => ({ reference })),
    });
  }

  if (refs.oxygen.length > 0) {
    sections.push({
      title: 'Oxygen therapy',
      entry: refs.oxygen.map((reference) => ({ reference })),
    });
  }

  if (refs.attachments.length > 0) {
    sections.push({
      title: 'Attachments',
      entry: refs.attachments.map((reference) => ({ reference })),
    });
  }

  const subject = patientReference(values.patientId);
  const encounter = encounterReference(values.encounterId);

  return {
    resourceType: 'Composition',
    status,
    type,
    subject,
    encounter,
    date: optionsMerged.now(),
    author: [authorRef],
    title,
    attester: mapAttesters(values.composition?.attesters),
    section: sections.length > 0 ? sections : undefined,
  };
}

export function buildHandoverBundle(
  input: HandoverInput,
  options?: BuildOptions,
): Bundle {
  const values = 'values' in input ? input.values : input;
  const optionsMerged = resolveOptions(options);
  const nowIso = optionsMerged.now();
  const sharedOptions: BuildOptions = { now: () => nowIso };

  const observations = values.vitals
    ? mapObservationVitals(
        {
          patientId: values.patientId,
          encounterId: values.encounterId,
          ...values.vitals,
        },
        sharedOptions,
      )
    : [];

  const medications = mapMedicationStatements(
    {
      patientId: values.patientId,
      encounterId: values.encounterId,
      medications: values.medications,
    },
    sharedOptions,
  );

  const oxygenResources = mapDeviceUse(
    {
      patientId: values.patientId,
      encounterId: values.encounterId,
      oxygenTherapy: values.oxygenTherapy,
    },
    sharedOptions,
  );

  const document = mapDocumentReferenceAudio(
    {
      patientId: values.patientId,
      encounterId: values.encounterId,
      author: values.author,
      audioAttachment: values.audioAttachment,
    },
    sharedOptions,
  );

  const entries: BundleEntry[] = [];
  const vitalsRefs: string[] = [];
  const medicationRefs: string[] = [];
  const oxygenRefs: string[] = [];
  const attachmentRefs: string[] = [];

  observations.forEach((observation) => {
    const { resource, fullUrl } = assignStableIds(observation, values.patientId);
    entries.push({
      fullUrl,
      resource,
      request: { method: 'POST', url: 'Observation' },
    });
    vitalsRefs.push(fullUrl);
  });

  medications.forEach((medication) => {
    const { resource, fullUrl } = assignStableIds(medication, values.patientId);
    entries.push({
      fullUrl,
      resource,
      request: { method: 'POST', url: 'MedicationStatement' },
    });
    medicationRefs.push(fullUrl);
  });

  oxygenResources.forEach((resource) => {
    const { resource: withId, fullUrl } = assignStableIds(resource, values.patientId);
    entries.push({
      fullUrl,
      resource: withId,
      request: { method: 'POST', url: resource.resourceType },
    });
    oxygenRefs.push(fullUrl);
  });

  if (document) {
    const { resource, fullUrl } = assignStableIds(document, values.patientId);
    entries.push({
      fullUrl,
      resource,
      request: { method: 'POST', url: 'DocumentReference' },
    });
    attachmentRefs.push(fullUrl);
  }

  const composition = buildComposition(
    {
      patientId: values.patientId,
      encounterId: values.encounterId,
      author: values.author,
      composition: values.composition,
    },
    {
      vitals: vitalsRefs,
      medications: medicationRefs,
      oxygen: oxygenRefs,
      attachments: attachmentRefs,
    },
    sharedOptions,
  );

  const { resource: compositionWithId, fullUrl: compositionFullUrl } = assignStableIds(
    composition,
    values.patientId,
  );

  entries.push({
    fullUrl: compositionFullUrl,
    resource: compositionWithId,
    request: { method: 'POST', url: 'Composition' },
  });

  return {
    resourceType: 'Bundle',
    type: 'transaction',
    entry: entries,
  };
}

export type {
  Observation,
  MedicationStatement,
  Procedure,
  DeviceUseStatement,
  DocumentReference,
  Composition,
  Bundle,
};

export const __test__ = {
  stableUrn,
  stableHash,
  stableStringify,
  LOINC: TEST_LOINC,
};
