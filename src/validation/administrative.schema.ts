import { zHandover } from './schemas';

export const administrativeSchema = zHandover.pick({
  administrativeData: true,
});
