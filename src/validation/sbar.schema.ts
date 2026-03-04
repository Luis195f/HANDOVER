import { zHandoverObject } from "./schemas";

export const sbarSchema = zHandoverObject.pick({
  sbarSituation: true,
  sbarBackground: true,
  sbarAssessment: true,
  sbarRecommendation: true,
});
