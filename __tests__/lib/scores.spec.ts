import { describe, expect, it } from 'vitest';

import { DEFAULT_RISK_CONFIG } from '@/src/config/riskConfig';
import { calculateBraden } from '@/src/lib/scores/braden';
import { calculateNews2 } from '@/src/lib/scores/news2';
import { evaluateRisk } from '@/src/lib/scores/riskRules';

describe('calculateNews2', () => {
  it('calcula NEWS2 alto con parámetros críticos', () => {
    const result = calculateNews2({
      respiratoryRate: 30,
      spo2: 85,
      systolicBP: 90,
      heartRate: 140,
      temperature: 39.5,
      consciousness: 'V',
      onOxygen: true,
    });

    expect(result.total).toBeGreaterThanOrEqual(DEFAULT_RISK_CONFIG.news2HighThreshold);
    expect(result.componentScores.respiratoryRate).toBeGreaterThan(0);
  });

  it('calcula NEWS2 moderado', () => {
    const result = calculateNews2({
      respiratoryRate: 22,
      spo2: 94,
      systolicBP: 100,
      heartRate: 105,
      temperature: 37.5,
      consciousness: 'A',
      onOxygen: false,
    });

    expect(result.total).toBe(6);
  });
});

describe('calculateBraden', () => {
  it('suma subescalas y marca faltantes como NaN', () => {
    const result = calculateBraden({
      sensoryPerception: 2,
      moisture: 3,
      activity: 2,
      mobility: 3,
      nutrition: 2,
      frictionShear: null,
    });

    expect(result.total).toBe(12);
    expect(Number.isNaN(result.subscaleScores.frictionShear ?? undefined)).toBe(true);
  });
});

describe('evaluateRisk', () => {
  it('marca riesgo alto por NEWS2', () => {
    const news2 = calculateNews2({
      respiratoryRate: 28,
      spo2: 90,
      systolicBP: 88,
      heartRate: 130,
      temperature: 38.5,
      consciousness: 'C',
      onOxygen: true,
    });

    const result = evaluateRisk(news2, null, DEFAULT_RISK_CONFIG);

    expect(result.level).toBe('high');
    expect(result.reasons.some((reason) => reason.includes('NEWS2'))).toBe(true);
  });

  it('marca riesgo alto por Braden bajo', () => {
    const braden = calculateBraden({
      sensoryPerception: 2,
      moisture: 2,
      activity: 2,
      mobility: 2,
      nutrition: 2,
      frictionShear: 2,
    });

    const result = evaluateRisk(null, braden, DEFAULT_RISK_CONFIG);

    expect(result.level).toBe('high');
    expect(result.reasons.some((reason) => reason.includes('Braden'))).toBe(true);
  });

  it('marca riesgo moderado por NEWS2', () => {
    const news2 = calculateNews2({
      respiratoryRate: 22,
      spo2: 93,
      systolicBP: 110,
      heartRate: 90,
      temperature: 37.0,
      consciousness: 'A',
      onOxygen: false,
    });

    const result = evaluateRisk(news2, null, DEFAULT_RISK_CONFIG);

    expect(result.level).toBe('moderate');
  });
});
