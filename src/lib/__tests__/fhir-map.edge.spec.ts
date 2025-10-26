import { describe, it, expect } from 'vitest';
import { mapVitalsToObservations } from '@/src/lib/fhir-map';

const ISO_NOW = '2025-10-19T12:00:00Z';

const LOINC = {
  RR: '9279-1',
  HR: '8867-4',
  SBP: '8480-6',
  TEMP: '8310-5',
  SPO2: '59408-5',
};

const byCode = (a: any, b: any) =>
  String(a?.code?.coding?.[0]?.code ?? '').localeCompare(String(b?.code?.coding?.[0]?.code ?? ''));

describe('mapVitalsToObservations — edge cases', () => {
  it('ignora valores undefined/null/NaN (no crea Observations inválidas)', () => {
    const obs = mapVitalsToObservations(
      {
        patientId: 'pat-EDG-1',
        vitals: { rr: undefined as any, hr: null as any, sbp: Number.NaN, temp: 36.5 },
      },
      { now: ISO_NOW },
    ).sort(byCode);

    // Solo Temp debe generarse
    expect(obs).toHaveLength(1);
    const first = obs[0];
    expect(first).toBeDefined();
    expect(first?.code?.coding?.[0]?.code).toBe(LOINC.TEMP);
    expect(first?.valueQuantity?.code).toBe('Cel');
  });

  it('filtra valores fuera de rango y mantiene UCUM en los válidos', () => {
    const obs = mapVitalsToObservations(
      {
        patientId: 'pat-EDG-2',
        vitals: { rr: 0, hr: 300, temp: 45 }, // extremos a propósito
      },
      { now: ISO_NOW },
    ).sort(byCode);

    const codes = obs.map(o => o.code?.coding?.[0]?.code).sort();
    expect(codes).toEqual([LOINC.TEMP]);

    const get = (c: string) => obs.find(o => o.code?.coding?.[0]?.code === c);
    const temp = get(LOINC.TEMP);
    expect(temp).toBeDefined();
    expect(temp?.valueQuantity?.code).toBe('Cel');

    for (const o of obs) expect(o.effectiveDateTime).toBe(ISO_NOW);
  });

  it('si no se pasa "now", effectiveDateTime existe y es ISO', () => {
    const obs = mapVitalsToObservations(
      { patientId: 'pat-EDG-3', vitals: { sbp: 120 } },
      /* sin now */ {},
    );

    expect(obs).toHaveLength(1);
    const only = obs[0];
    expect(only).toBeDefined();
    expect(only?.code?.coding?.[0]?.code).toBe(LOINC.SBP);
    expect(only?.valueQuantity?.code).toBe('mm[Hg]');
    expect(String(only?.effectiveDateTime)).toMatch(/^\d{4}-\d{2}-\d{2}T.+Z$/);
  });
});
