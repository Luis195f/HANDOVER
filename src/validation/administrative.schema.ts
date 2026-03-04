import { z } from 'zod';
import { zHandoverObject } from './schemas';

const baseSchema = zHandover instanceof z.ZodEffects ? zHandover.innerType() : zHandover;

export const administrativeSchema = baseSchema.pick({
  administrativeData: true,
});
