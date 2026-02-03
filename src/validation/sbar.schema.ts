import { zHandover } from './schemas';

export const sbarSchema = zHandover.pick({
  sbarSituation: true,
  sbarBackground: true,
  sbarAssessment: true,
  sbarRecommendation: true,
});
