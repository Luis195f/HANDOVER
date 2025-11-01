import { z } from 'zod';

import type {
  Bundle,
  Composition,
  DeviceUseStatement,
  DocumentReference,
  MedicationStatement,
  Observation,
} from '../fhir-map';

const isoDateTime = z
  .string()
  .refine((value) => {
    if (typeof value !== 'string') return false;
    const timestamp = Date.parse(value);
    return Number.isFinite(timestamp);
  }, { message: 'Value must be a valid ISO-8601 date-time string' });

const referenceSchema = z
  .object({
    reference: z.string().min(1),
    type: z.string().optional(),
    display: z.string().optional(),
  })
  .passthrough();

const codingSchema = z
  .object({
    system: z.string().optional(),
    code: z.union([z.string(), z.number()]).optional(),
    display: z.string().optional(),
  })
  .passthrough();

const codeableConceptSchema = z
  .object({
    coding: z.array(codingSchema).min(1).optional(),
    text: z.string().optional(),
  })
  .refine((value) => value.coding !== undefined || value.text !== undefined, {
    message: 'CodeableConcept requires coding or text',
  })
  .passthrough();

const quantitySchema = z
  .object({
    value: z.number(),
    unit: z.string().optional(),
    system: z.string().optional(),
    code: z.union([z.string(), z.number()]).optional(),
  })
  .passthrough();

const periodSchema = z
  .object({
    start: isoDateTime,
    end: isoDateTime.optional(),
  })
  .passthrough();

const attachmentSchema = z
  .object({
    contentType: z.string().min(1),
    url: z.string().url().optional(),
    title: z.string().optional(),
    data: z.string().optional(),
    size: z.number().optional(),
    hash: z.string().optional(),
  })
  .refine((value) => value.url !== undefined || value.data !== undefined, {
    message: 'Attachment requires either an URL or inline data',
  })
  .passthrough();

const observationSchema = z
  .object({
    resourceType: z.literal('Observation'),
    status: z.string().min(1),
    meta: z
      .object({
        profile: z.array(z.string()).min(1),
      })
      .optional(),
    category: z
      .array(
        z
          .object({
            coding: z.array(codingSchema).min(1),
            text: z.string().optional(),
          })
          .passthrough(),
      )
      .optional(),
    code: codeableConceptSchema,
    subject: referenceSchema,
    encounter: referenceSchema.optional(),
    effectiveDateTime: isoDateTime,
    issued: isoDateTime.optional(),
    valueQuantity: quantitySchema.optional(),
    valueCodeableConcept: codeableConceptSchema.optional(),
    valueString: z.string().optional(),
    component: z
      .array(
        z
          .object({
            code: codeableConceptSchema,
            valueQuantity: quantitySchema.optional(),
            valueCodeableConcept: codeableConceptSchema.optional(),
            valueString: z.string().optional(),
          })
          .passthrough(),
      )
      .optional(),
    hasMember: z.array(referenceSchema).optional(),
  })
  .superRefine((value, ctx) => {
    const hasValue =
      value.valueQuantity !== undefined ||
      value.valueCodeableConcept !== undefined ||
      value.valueString !== undefined ||
      (value.component !== undefined && value.component.length > 0) ||
      (value.hasMember !== undefined && value.hasMember.length > 0);
    if (!hasValue) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Observation requires a value, component, or hasMember reference',
        path: ['valueQuantity'],
      });
    }
  })
  .passthrough();

const medicationStatementSchema = z
  .object({
    resourceType: z.literal('MedicationStatement'),
    status: z.enum(['active', 'completed', 'entered-in-error', 'intended']).or(z.string().min(1)),
    medicationCodeableConcept: codeableConceptSchema,
    subject: referenceSchema,
    encounter: referenceSchema.optional(),
    effectiveDateTime: isoDateTime.optional(),
    effectivePeriod: periodSchema.optional(),
    dateAsserted: isoDateTime.optional(),
    dosage: z.any().optional(),
    note: z.array(z.object({ text: z.string() }).passthrough()).optional(),
  })
  .passthrough();

const deviceUseStatementSchema = z
  .object({
    resourceType: z.literal('DeviceUseStatement'),
    status: z.enum(['active', 'completed', 'entered-in-error']).or(z.string().min(1)),
    subject: referenceSchema,
    encounter: referenceSchema.optional(),
    device: z
      .object({
        reference: z.string().min(1),
        display: z.string().optional(),
      })
      .passthrough(),
    timingPeriod: periodSchema,
  })
  .passthrough();

const documentReferenceSchema = z
  .object({
    resourceType: z.literal('DocumentReference'),
    status: z.string().min(1),
    subject: referenceSchema,
    encounter: referenceSchema.optional(),
    author: z.array(referenceSchema).min(1),
    date: isoDateTime,
    content: z.array(z.object({ attachment: attachmentSchema }).passthrough()).min(1),
    category: z.array(codeableConceptSchema).min(1),
  })
  .passthrough();

const compositionSectionSchema = z
  .object({
    title: z.string().optional(),
    code: codeableConceptSchema.optional(),
    text: z
      .object({
        status: z.string().optional(),
        div: z.string().optional(),
      })
      .passthrough()
      .optional(),
    entry: z.array(referenceSchema).optional(),
  })
  .passthrough();

const compositionSchema = z
  .object({
    resourceType: z.literal('Composition'),
    status: z.string().min(1),
    type: codeableConceptSchema,
    subject: referenceSchema,
    encounter: referenceSchema.optional(),
    date: isoDateTime,
    author: z.array(referenceSchema).min(1),
    title: z.string().min(1),
    section: z.array(compositionSectionSchema).optional(),
  })
  .passthrough();

const bundleEntrySchema = z
  .object({
    fullUrl: z.string().min(1),
    resource: z.record(z.any()).optional(),
    request: z
      .object({
        method: z.string().min(1),
        url: z.string().min(1),
      })
      .passthrough()
      .optional(),
  })
  .passthrough();

const bundleSchema = z
  .object({
    resourceType: z.literal('Bundle'),
    type: z.literal('transaction'),
    entry: z.array(bundleEntrySchema).min(1),
  })
  .passthrough();

type ValidatedBundle = {
  bundle: Bundle;
  observations: Observation[];
  medicationStatements: MedicationStatement[];
  deviceUseStatements: DeviceUseStatement[];
  documentReferences: DocumentReference[];
  compositions: Composition[];
};

export function validateBundle(input: unknown): ValidatedBundle {
  const parsedBundle = bundleSchema.parse(input) as Bundle & { entry: Array<{ resource?: any }> };

  const observations: Observation[] = [];
  const medicationStatements: MedicationStatement[] = [];
  const deviceUseStatements: DeviceUseStatement[] = [];
  const documentReferences: DocumentReference[] = [];
  const compositions: Composition[] = [];

  for (const entry of parsedBundle.entry ?? []) {
    const resource = entry.resource;
    if (!resource || typeof resource !== 'object') continue;

    switch ((resource as { resourceType?: string }).resourceType) {
      case 'Observation':
        observations.push(observationSchema.parse(resource) as Observation);
        break;
      case 'MedicationStatement':
        medicationStatements.push(medicationStatementSchema.parse(resource) as MedicationStatement);
        break;
      case 'DeviceUseStatement':
        deviceUseStatements.push(deviceUseStatementSchema.parse(resource) as DeviceUseStatement);
        break;
      case 'DocumentReference':
        documentReferences.push(documentReferenceSchema.parse(resource) as DocumentReference);
        break;
      case 'Composition':
        compositions.push(compositionSchema.parse(resource) as Composition);
        break;
      default:
        break;
    }
  }

  return {
    bundle: parsedBundle,
    observations,
    medicationStatements,
    deviceUseStatements,
    documentReferences,
    compositions,
  };
}

export const schemas = {
  isoDateTime,
  reference: referenceSchema,
  codeableConcept: codeableConceptSchema,
  quantity: quantitySchema,
  observation: observationSchema,
  medicationStatement: medicationStatementSchema,
  deviceUseStatement: deviceUseStatementSchema,
  documentReference: documentReferenceSchema,
  composition: compositionSchema,
  bundle: bundleSchema,
};

export type { ValidatedBundle };
