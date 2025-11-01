import { z } from 'zod';

type ZodIssue = {
  path?: (string | number)[];
  message?: string;
  [key: string]: unknown;
};

const isoInstant = z
  .string()
  .refine((value) => {
    if (!value.endsWith('Z')) return false;
    const timestamp = Date.parse(value);
    return Number.isFinite(timestamp);
  }, { message: 'Expected an ISO-8601 instant (UTC)' });

const referenceSchema = z.object({
  reference: z.string().min(1),
  type: z.string().optional(),
  display: z.string().optional(),
});

const codingSchema = z.object({
  system: z.string().min(1),
  code: z.string().min(1),
  display: z.string().optional(),
});

const codeableConceptSchema = z.object({
  coding: z.array(codingSchema).min(1),
  text: z.string().optional(),
});

const quantitySchema = z.object({
  value: z.number(),
  unit: z.string().optional(),
  system: z.string().optional(),
  code: z.string().optional(),
});

const annotationSchema = z.object({
  text: z.string(),
});

const periodSchema = z.object({
  start: isoInstant,
  end: isoInstant.optional(),
});

const observationComponentSchema = z.object({
  code: codeableConceptSchema,
  valueQuantity: quantitySchema.optional(),
  valueCodeableConcept: codeableConceptSchema.optional(),
});

const observationSchema = z.object({
  resourceType: z.literal('Observation'),
  status: z.literal('final'),
  meta: z.object({ profile: z.array(z.string().min(1)).min(1) }),
  category: z.array(codeableConceptSchema).min(1),
  code: codeableConceptSchema,
  subject: referenceSchema,
  encounter: referenceSchema.optional(),
  effectiveDateTime: isoInstant,
  issued: isoInstant,
  valueQuantity: quantitySchema.optional(),
  valueCodeableConcept: codeableConceptSchema.optional(),
  component: z.array(observationComponentSchema).optional(),
  hasMember: z.array(referenceSchema).optional(),
});

const medicationCodeableConceptSchema = z.object({
  coding: z.array(codingSchema).min(1),
  text: z.string().optional(),
});

const medicationStatementSchema = z.object({
  resourceType: z.literal('MedicationStatement'),
  status: z.enum(['active', 'completed', 'intended']),
  medicationCodeableConcept: medicationCodeableConceptSchema,
  subject: referenceSchema,
  encounter: referenceSchema.optional(),
  effectivePeriod: periodSchema.optional(),
  dateAsserted: isoInstant,
  note: z.array(annotationSchema).optional(),
});

const procedureSchema = z.object({
  resourceType: z.literal('Procedure'),
  status: z.enum(['in-progress', 'completed']),
  code: codeableConceptSchema,
  subject: referenceSchema,
  encounter: referenceSchema.optional(),
  performedDateTime: isoInstant.optional(),
  performedPeriod: periodSchema.optional(),
  reasonCode: z.array(codeableConceptSchema).optional(),
  bodySite: z.array(codeableConceptSchema).optional(),
  note: z.array(annotationSchema).optional(),
});

const deviceReferenceSchema = z.object({
  reference: z.string().min(1),
  type: z.string().optional(),
  display: z.string().optional(),
});

const deviceUseStatementSchema = z.object({
  resourceType: z.literal('DeviceUseStatement'),
  status: z.enum(['active', 'completed']),
  subject: referenceSchema,
  encounter: referenceSchema.optional(),
  device: deviceReferenceSchema,
  timingPeriod: periodSchema.optional(),
  reasonCode: z.array(codeableConceptSchema).optional(),
  note: z.array(annotationSchema).optional(),
});

const attachmentSchema = z.object({
  contentType: z.string().min(1),
  url: z.string().url().optional(),
  data: z.string().optional(),
  size: z.number().int().nonnegative().optional(),
  hash: z.string().optional(),
  title: z.string().optional(),
});

const documentReferenceSchema = z.object({
  resourceType: z.literal('DocumentReference'),
  status: z.literal('current'),
  type: codeableConceptSchema.optional(),
  category: z.array(codeableConceptSchema).optional(),
  subject: referenceSchema,
  encounter: referenceSchema.optional(),
  author: z.array(referenceSchema).min(1),
  date: isoInstant,
  content: z.array(z.object({ attachment: attachmentSchema })).min(1),
});

const narrativeSchema = z.object({
  status: z.enum(['generated', 'additional', 'extensions']),
  div: z.string(),
});

const compositionSectionSchema = z.object({
  title: z.string().optional(),
  code: codeableConceptSchema.optional(),
  text: narrativeSchema.optional(),
  entry: z.array(referenceSchema).optional(),
});

const compositionSchema = z.object({
  resourceType: z.literal('Composition'),
  status: z.enum(['final', 'amended']),
  type: codeableConceptSchema,
  subject: referenceSchema,
  encounter: referenceSchema.optional(),
  date: isoInstant,
  author: z.array(referenceSchema).min(1),
  title: z.string().min(1),
  attester: z
    .array(
      z.object({
        mode: z.enum(['professional', 'legal', 'official', 'personal']),
        time: isoInstant.optional(),
        party: referenceSchema.optional(),
      }),
    )
    .optional(),
  section: z.array(compositionSectionSchema).optional(),
});

const resourceUnion = z.discriminatedUnion('resourceType', [
  observationSchema,
  medicationStatementSchema,
  procedureSchema,
  deviceUseStatementSchema,
  documentReferenceSchema,
  compositionSchema,
]);

const bundleEntrySchema = z.object({
  fullUrl: z
    .string()
    .regex(/^urn:uuid:[0-9a-f]{32}$/i, 'Expected stable URN fullUrl'),
  resource: resourceUnion,
  request: z.object({
    method: z.literal('POST'),
    url: z.string().min(1),
  }),
});

export const handoverBundleSchema = z.object({
  resourceType: z.literal('Bundle'),
  type: z.literal('transaction'),
  entry: z.array(bundleEntrySchema).min(1),
});

export type HandoverResource = z.infer<typeof resourceUnion>;
export type HandoverBundle = z.infer<typeof handoverBundleSchema>;

export class HandoverValidationError extends Error {
  public readonly issues?: readonly ZodIssue[];

  constructor(message: string, issues?: readonly ZodIssue[]) {
    super(message);
    this.name = 'HandoverValidationError';
    this.issues = issues;
  }
}

export type HandoverValidationResult = {
  bundle: HandoverBundle;
  entriesByFullUrl: Map<string, HandoverResource>;
  composition: Extract<HandoverResource, { resourceType: 'Composition' }>;
  compositionReferences: Set<string>;
  encounterReference?: string;
};

const RESOURCE_TYPE_LABELS: Record<HandoverResource['resourceType'], string> = {
  Observation: 'Observation',
  MedicationStatement: 'MedicationStatement',
  Procedure: 'Procedure',
  DeviceUseStatement: 'DeviceUseStatement',
  DocumentReference: 'DocumentReference',
  Composition: 'Composition',
};

function ensureCompositionReferences(
  composition: Extract<HandoverResource, { resourceType: 'Composition' }>,
  entriesByFullUrl: Map<string, HandoverResource>,
): Set<string> {
  const references = new Set<string>();
  for (const section of composition.section ?? []) {
    for (const entry of section.entry ?? []) {
      references.add(entry.reference);
      if (!entriesByFullUrl.has(entry.reference)) {
        throw new HandoverValidationError(
          `Composition references missing bundle entry: ${entry.reference}`,
        );
      }
    }
  }

  for (const [fullUrl, resource] of entriesByFullUrl.entries()) {
    if (resource.resourceType === 'Composition') continue;
    if (!references.has(fullUrl)) {
      throw new HandoverValidationError(
        `Composition is missing reference to ${RESOURCE_TYPE_LABELS[resource.resourceType]} (${fullUrl})`,
      );
    }
  }

  return references;
}

function extractEncounterReference(bundle: HandoverBundle): string | undefined {
  const encounterRefs = new Set<string>();

  for (const entry of bundle.entry) {
    const resource = entry.resource;
    if ('encounter' in resource && resource.encounter?.reference) {
      encounterRefs.add(resource.encounter.reference);
    }
  }

  if (encounterRefs.size > 1) {
    throw new HandoverValidationError(
      `Encounter reference mismatch between resources: ${Array.from(encounterRefs).join(', ')}`,
    );
  }

  return encounterRefs.values().next()?.value;
}

export function validateHandoverBundle(input: unknown): HandoverValidationResult {
  let bundle: HandoverBundle;
  try {
    bundle = handoverBundleSchema.parse(input);
  } catch (error) {
    if (error && typeof error === 'object' && 'issues' in error) {
      const issues = (error as { issues: readonly ZodIssue[] }).issues;
      throw new HandoverValidationError('Bundle structure is invalid', issues);
    }
    if (error instanceof Error) throw error;
    throw new Error(String(error));
  }

  const entriesByFullUrl = new Map<string, HandoverResource>();
  for (const entry of bundle.entry) {
    entriesByFullUrl.set(entry.fullUrl, entry.resource);
  }

  const composition = bundle.entry.find(
    (entry): entry is { fullUrl: string; resource: Extract<HandoverResource, { resourceType: 'Composition' }>; request: { method: 'POST'; url: string } } =>
      entry.resource.resourceType === 'Composition',
  )?.resource;

  if (!composition) {
    throw new HandoverValidationError('Bundle is missing Composition resource');
  }

  const compositionReferences = ensureCompositionReferences(composition, entriesByFullUrl);
  const encounterReference = extractEncounterReference(bundle);

  if (!composition.subject.reference.startsWith('Patient/')) {
    throw new HandoverValidationError(
      `Composition.subject must point to a Patient reference (received ${composition.subject.reference})`,
    );
  }

  if (!bundle.entry.some((entry) => entry.resource.resourceType === 'Observation')) {
    throw new HandoverValidationError('Bundle is missing Observation resources');
  }

  if (!bundle.entry.some((entry) => entry.resource.resourceType === 'MedicationStatement')) {
    throw new HandoverValidationError('Bundle is missing MedicationStatement resources');
  }

  if (!bundle.entry.some((entry) => entry.resource.resourceType === 'DocumentReference')) {
    throw new HandoverValidationError('Bundle is missing DocumentReference resources');
  }

  if (!bundle.entry.some((entry) => entry.resource.resourceType === 'DeviceUseStatement')) {
    throw new HandoverValidationError('Bundle is missing DeviceUseStatement resources');
  }

  return {
    bundle,
    entriesByFullUrl,
    composition,
    compositionReferences,
    encounterReference,
  };
}

export function listResources<T extends HandoverResource['resourceType']>(
  result: HandoverValidationResult,
  type: T,
): Extract<HandoverResource, { resourceType: T }>[] {
  const resources: Extract<HandoverResource, { resourceType: T }>[] = [];
  for (const resource of result.entriesByFullUrl.values()) {
    if (resource.resourceType === type) {
      resources.push(resource as Extract<HandoverResource, { resourceType: T }>);
    }
  }
  return resources;
}
