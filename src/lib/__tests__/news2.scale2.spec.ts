import { describe, expect, it } from 'vitest';

import { computeNEWS2, type NEWS2Input } from '../news2';

const neutral: NEWS2Input = {
  rr: 16,
  spo2: 98,
  temp: 37,
  sbp: 120,
  hr: 80,
  avpu: 'A',
  o2: false,
};

describe('NEWS2 Scale 2 RCP parity', () => {
  it('scores 93% on air as zero with neutral physiology', () => {
    expect(computeNEWS2({ ...neutral, scale2: true, spo2: 93 })).toEqual({
      rr: 0, spo2: 0, temp: 0, sbp: 0, hr: 0, avpu: 0, o2: 0,
      total: 0, anyThree: false, band: 'BAJA',
    });
  });

  it('scores 94% on oxygen as one plus two with neutral physiology', () => {
    expect(computeNEWS2({ ...neutral, scale2: true, spo2: 94, o2: true })).toEqual({
      rr: 0, spo2: 1, temp: 0, sbp: 0, hr: 0, avpu: 0, o2: 2,
      total: 3, anyThree: false, band: 'MEDIA',
    });
  });

  it.each([
    [82, 3], [83, 3], [84, 2], [85, 2], [86, 1], [87, 1],
    [88, 0], [89, 0], [90, 0], [91, 0], [92, 0], [93, 0],
    [94, 0], [95, 0], [96, 0], [97, 0], [98, 0], [99, 0], [100, 0],
  ])('on air: SpO2 %i scores %i', (spo2, expectedSpO2) => {
    expect(computeNEWS2({ ...neutral, scale2: true, spo2 })).toMatchObject({
      spo2: expectedSpO2,
      o2: 0,
      total: expectedSpO2,
      anyThree: expectedSpO2 === 3,
    });
  });

  it.each([
    [82, 3, 5], [83, 3, 5], [84, 2, 4], [85, 2, 4], [86, 1, 3], [87, 1, 3],
    [88, 0, 2], [89, 0, 2], [90, 0, 2], [91, 0, 2], [92, 0, 2], [93, 1, 3],
    [94, 1, 3], [95, 2, 4], [96, 2, 4], [97, 3, 5], [98, 3, 5], [99, 3, 5], [100, 3, 5],
  ])('on oxygen: SpO2 %i scores %i, total %i', (spo2, expectedSpO2, total) => {
    expect(computeNEWS2({ ...neutral, scale2: true, spo2, o2: true })).toMatchObject({
      spo2: expectedSpO2,
      o2: 2,
      total,
      anyThree: expectedSpO2 === 3,
    });
  });

  it.each([
    [91, 3], [92, 2], [93, 2], [94, 1], [95, 1], [96, 0], [97, 0], [100, 0],
  ])('preserves Scale 1 at SpO2 %i with component %i', (spo2, expectedSpO2) => {
    for (const o2 of [false, true]) {
      const explicit = computeNEWS2({ ...neutral, spo2, o2, scale2: false });
      expect(explicit).toMatchObject({
        spo2: expectedSpO2,
        o2: o2 ? 2 : 0,
        total: expectedSpO2 + (o2 ? 2 : 0),
        anyThree: expectedSpO2 === 3,
      });
      expect(computeNEWS2({ ...neutral, spo2, o2 })).toEqual(explicit);
    }
  });

  const unchangedParameters: {
    input: NEWS2Input;
    parameter: 'rr' | 'temp' | 'sbp' | 'hr' | 'avpu';
    score: number;
  }[] = [
    { input: { rr: 8 }, parameter: 'rr', score: 3 },
    { input: { rr: 9 }, parameter: 'rr', score: 1 },
    { input: { rr: 11 }, parameter: 'rr', score: 1 },
    { input: { rr: 12 }, parameter: 'rr', score: 0 },
    { input: { rr: 20 }, parameter: 'rr', score: 0 },
    { input: { rr: 21 }, parameter: 'rr', score: 2 },
    { input: { rr: 24 }, parameter: 'rr', score: 2 },
    { input: { rr: 25 }, parameter: 'rr', score: 3 },
    { input: { temp: 35 }, parameter: 'temp', score: 3 },
    { input: { temp: 35.1 }, parameter: 'temp', score: 1 },
    { input: { temp: 36 }, parameter: 'temp', score: 1 },
    { input: { temp: 36.1 }, parameter: 'temp', score: 0 },
    { input: { temp: 38 }, parameter: 'temp', score: 0 },
    { input: { temp: 38.1 }, parameter: 'temp', score: 1 },
    { input: { temp: 39 }, parameter: 'temp', score: 1 },
    { input: { temp: 39.1 }, parameter: 'temp', score: 2 },
    { input: { sbp: 90 }, parameter: 'sbp', score: 3 },
    { input: { sbp: 91 }, parameter: 'sbp', score: 2 },
    { input: { sbp: 100 }, parameter: 'sbp', score: 2 },
    { input: { sbp: 101 }, parameter: 'sbp', score: 1 },
    { input: { sbp: 110 }, parameter: 'sbp', score: 1 },
    { input: { sbp: 111 }, parameter: 'sbp', score: 0 },
    { input: { sbp: 219 }, parameter: 'sbp', score: 0 },
    { input: { sbp: 220 }, parameter: 'sbp', score: 3 },
    { input: { hr: 40 }, parameter: 'hr', score: 3 },
    { input: { hr: 41 }, parameter: 'hr', score: 1 },
    { input: { hr: 50 }, parameter: 'hr', score: 1 },
    { input: { hr: 51 }, parameter: 'hr', score: 0 },
    { input: { hr: 90 }, parameter: 'hr', score: 0 },
    { input: { hr: 91 }, parameter: 'hr', score: 1 },
    { input: { hr: 110 }, parameter: 'hr', score: 1 },
    { input: { hr: 111 }, parameter: 'hr', score: 2 },
    { input: { hr: 130 }, parameter: 'hr', score: 2 },
    { input: { hr: 131 }, parameter: 'hr', score: 3 },
    { input: { avpu: 'A' }, parameter: 'avpu', score: 0 },
    { input: { avpu: 'C' }, parameter: 'avpu', score: 3 },
    { input: { avpu: 'V' }, parameter: 'avpu', score: 3 },
    { input: { avpu: 'P' }, parameter: 'avpu', score: 3 },
    { input: { avpu: 'U' }, parameter: 'avpu', score: 3 },
  ];

  it.each(unchangedParameters)('preserves $parameter for $input', ({ input, parameter, score }) => {
    for (const scale2 of [false, true]) {
      const result = computeNEWS2({ ...neutral, ...input, scale2 });
      expect(result[parameter]).toBe(score);
      expect(result.total).toBe(score);
      expect(result.anyThree).toBe(score === 3);
    }
  });

  it('preserves independent components and a red flag from another parameter', () => {
    expect(computeNEWS2({
      rr: 25, spo2: 94, temp: 39.1, sbp: 100, hr: 110, avpu: 'C', o2: true, scale2: true,
    })).toEqual({
      rr: 3, spo2: 1, temp: 2, sbp: 2, hr: 1, avpu: 3, o2: 2,
      total: 14, anyThree: true, band: 'CRÍTICA',
    });
  });

  const partialCases: { input: NEWS2Input; spo2: number; o2: number; total: number; anyThree: boolean }[] = [
    { input: {}, spo2: 0, o2: 0, total: 0, anyThree: false },
    { input: { scale2: true }, spo2: 0, o2: 0, total: 0, anyThree: false },
    { input: { scale2: true, o2: true }, spo2: 0, o2: 2, total: 2, anyThree: false },
    { input: { scale2: true, spo2: 83 }, spo2: 3, o2: 0, total: 3, anyThree: true },
    { input: { scale2: true, spo2: 88 }, spo2: 0, o2: 0, total: 0, anyThree: false },
    { input: { scale2: true, spo2: 93 }, spo2: 0, o2: 0, total: 0, anyThree: false },
    { input: { scale2: true, spo2: 94, o2: true }, spo2: 1, o2: 2, total: 3, anyThree: false },
    { input: { spo2: 94 }, spo2: 1, o2: 0, total: 1, anyThree: false },
  ];

  it.each(partialCases)('preserves partial-input semantics apart from the Scale 2 fix: $input', ({ input, ...expected }) => {
    expect(computeNEWS2(input)).toMatchObject({
      rr: 0, temp: 0, sbp: 0, hr: 0, avpu: 0, ...expected,
    });
  });
});
