import { z } from 'zod';
import { zHandoverObject } from './schemas';

const baseSchema = zHandover instanceof z.ZodEffects ? zHandover.innerType() : zHandover;

export const vitalsSchema = baseSchema.pick({
  vitals: true,
});
