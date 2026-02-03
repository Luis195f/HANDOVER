import { zHandover } from './schemas';

export const vitalsSchema = zHandover.pick({
  vitals: true,
});
