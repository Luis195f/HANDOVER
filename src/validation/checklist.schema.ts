import { zHandover } from './schemas';

export const checklistSchema = zHandover.pick({
  bedsideChecklist: true,
});
