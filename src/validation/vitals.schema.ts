import { zHandoverObject } from "./schemas";

export const vitalsSchema = zHandoverObject.pick({
  vitals: true,
});
