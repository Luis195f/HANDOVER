import { z } from 'zod';
import { zHandover } from './schemas';

const baseSchema = zHandover instanceof z.ZodEffects ? zHandover.innerType() : zHandover;

export const careSchema = baseSchema.pick({
  meds: true,
  medications: true,
  treatments: true,
  exams: true,
  procedures: true,
});
