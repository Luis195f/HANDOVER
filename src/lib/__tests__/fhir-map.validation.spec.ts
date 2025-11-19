import { describe, it, expect } from 'vitest';
import { buildHandoverBundle } from '../fhir-map';
import { TEST_SYSTEMS, TEST_VITAL_CODES } from './fhir-map.test-constants';

const findBy = (bundle: any, code: string) =>
  (bundle.entry ?? []).map((e: any) => e.resource).find(
    (r: any) => r?.resourceType === 'Observation' &&
      r?.code?.coding?.some((c: any) => c.system === TEST_SYSTEMS.LOINC && String(c.code) === String(code))
  );

describe('Validación Zod — coerción y rangos', () => {
  const patientId = 'pat-001';
  const now = '2025-10-21T18:20:00Z';

  it('coacciona strings numéricos (hr:"88", temp:"37.5")', () => {
    const b = buildHandoverBundle({ patientId, vitals: { hr: "88" as any, temp: "37.5" as any } }, { now });
    const hr = findBy(b, TEST_VITAL_CODES.HEART_RATE.code);
    const t  = findBy(b, TEST_VITAL_CODES.TEMPERATURE.code);
    expect(hr?.valueQuantity?.value).toBe(88);
    expect(t?.valueQuantity?.value).toBe(37.5);
  });

  it('lanza si hay valores no numéricos (hr:"oops")', () => {
    expect(() =>
      buildHandoverBundle({ patientId, vitals: { hr: "oops" as any } }, { now })
    ).toThrow();
  });

  it('lanza si hay rangos absurdos (temp: 50°C)', () => {
    expect(() =>
      buildHandoverBundle({ patientId, vitals: { temp: 50 } }, { now })
    ).toThrow();
  });
});
