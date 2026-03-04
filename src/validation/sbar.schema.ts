import { z } from 'zod';
import { zHandoverObject } from './schemas';

const baseSchema = zHandover instanceof z.ZodEffects ? zHandover.innerType() : zHandover;

export const sbarSchema = baseSchema.pick({
  sbarSituation: true,
  sbarBackground: true,
  sbarAssessment: true,
  sbarRecommendation: true,
});
