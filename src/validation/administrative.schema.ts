import { zHandoverObject } from "./schemas";

export const administrativeSchema = zHandoverObject.pick({
  administrativeData: true,
  turnContext: true,
});

