import { describe, expect, it } from "vitest";

import { validateResourceWithZod } from "@/src/lib/fhir-validation";

describe("FHIR Zod validation", () => {
  it("validateResourceWithZod catches missing required fields", () => {
    const badObservation = { resourceType: "Observation", code: {} };

    const result = validateResourceWithZod(badObservation);

    expect(result.isValid).toBe(false);
    expect(result.errors.some((error) => /Required|required/.test(error.message))).toBe(true);
  });
});
