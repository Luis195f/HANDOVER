import { z } from 'zod';
import { zVitals, type HandoverValues } from '@/src/validation/schemas';

export const NEWS2_RR_MESSAGE = 'NEWS2 no calculable: verificar frecuencia respiratoria';
const reviewSchema = z.object({
  originalValue: z.number().finite(),
  source: z.enum(['fhir', 'manual', 'legacy-draft']),
  unit: z.string().regex(/^(\/min|breaths\/min|resp\/min|min\^-1)$/).optional().catch(undefined),
  observedAt: z.string().datetime({ offset: true }).optional().catch(undefined),
  reason: z.literal('RR_NON_INTEGER'),
  resolution: z.enum(['pending', 'corrected']),
});
export type RrReview = z.infer<typeof reviewSchema>;
export type RrDraft = Partial<HandoverValues> & { news2RrReview?: unknown };

export function parseRespiratoryRate(value: unknown): number | undefined {
  if (typeof value !== 'number' && (typeof value !== 'string' || !/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(value))) return undefined;
  const number = Number(value);
  return Number.isFinite(number) ? number : undefined;
}

export function readRrReview(value: unknown): RrReview | undefined {
  const parsed = reviewSchema.safeParse(value);
  if (!parsed.success || Number.isInteger(parsed.data.originalValue)) return undefined;
  const data = parsed.data;
  return { originalValue: data.originalValue, source: data.source, unit: data.unit,
    observedAt: data.observedAt, reason: 'RR_NON_INTEGER', resolution: data.resolution };
}

export function createRrReviewGate(initial?: unknown) {
  let review = readRrReview(initial);
  let current: unknown;
  let revision = 0;
  const observe = (value: unknown, manual = false, source: RrReview['source'] = 'manual') => {
    const previousResolution = review?.resolution;
    if (!Object.is(current, value)) { current = value; revision += 1; }
    const number = parseRespiratoryRate(value);
    if (number !== undefined && !Number.isInteger(number) && (!review || review.resolution === 'corrected')) {
      review = { originalValue: number, source, reason: 'RR_NON_INTEGER', resolution: 'pending' };
    }
    if (review) {
      const valid = typeof value === 'number' && zVitals.innerType().shape.rr.safeParse(value).success;
      if (!valid) review.resolution = 'pending';
      else if (manual) review.resolution = 'corrected';
    }
    if (previousResolution !== review?.resolution) revision += 1;
    return review?.resolution === 'pending';
  };
  return {
    observe,
    snapshot: () => readRrReview(review),
    capture: () => revision,
    isCurrent: (token: number) => token === revision,
    invalidate: () => { revision += 1; },
    restore: (value: unknown, metadata: unknown) => {
      if (review?.resolution !== 'pending') review = readRrReview(metadata);
      revision += 1;
      return observe(value, false, 'legacy-draft');
    },
  };
}

export function withoutNews2Vitals<T extends { vitals?: unknown }>(values: T, blocked: boolean) {
  if (!blocked) return values;
  const { vitals: _vitals, ...independent } = values;
  return independent;
}

export function unpackRrDraft(snapshot: RrDraft) {
  const { news2RrReview, ...values } = snapshot;
  return { values, review: readRrReview(news2RrReview) };
}

export function packRrDraft(values: Partial<HandoverValues>, review: unknown): RrDraft {
  const clean = unpackRrDraft(values).values;
  return { ...clean, news2RrReview: readRrReview(review) };
}
