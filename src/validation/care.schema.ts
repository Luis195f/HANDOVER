import { zHandoverObject } from "./schemas";

export const careSchema = zHandoverObject.pick({
  meds: true,
  medications: true,
  treatments: true,
  exams: true,
  procedures: true,
});
