import { z } from 'zod';
import { zHandover } from './schemas';

const baseSchema = zHandover instanceof z.ZodEffects ? zHandover.innerType() : zHandover;

export const checklistSchema = baseSchema.pick({
  bedsideChecklist: true,
});
