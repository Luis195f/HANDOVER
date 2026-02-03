import { zHandover } from './schemas';

export const careSchema = zHandover.pick({
  meds: true,
  medications: true,
  treatments: true,
  exams: true,
  procedures: true,
});
