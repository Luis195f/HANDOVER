import { zHandoverObject } from "./schemas";

export const checklistSchema = zHandoverObject.pick({
  bedsideChecklist: true,
});
