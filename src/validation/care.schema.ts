import { zHandoverObject } from "./schemas";

export const careSchema = zHandoverObject.pick({
  meds: true,
  medications: true,
  treatments: true,
  pendingTasks: true,
  exams: true,
  procedures: true,
  contingencyPlan: true,
});

