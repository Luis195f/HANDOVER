import { describe, expect, it, vi } from 'vitest';

import { confirmHighRiskSubmission, deriveRiskEvaluationFromValues } from '@/src/lib/scores/handoverRisk';

describe('Risk evaluation helpers', () => {
  it('combina NEWS2 y Braden para marcar riesgo alto con motivos', () => {
    const evaluation = deriveRiskEvaluationFromValues(
      {
        rr: 30,
        spo2: 85,
        sbp: 85,
        hr: 140,
        tempC: 39.5,
        avpu: 'C',
      },
      {
        sensoryPerception: 1,
        moisture: 1,
        activity: 1,
        mobility: 1,
        nutrition: 1,
        frictionShear: 1,
        totalScore: 6,
        riskLevel: 'alto',
      },
      {},
    );

    expect(evaluation.level).toBe('high');
    expect(evaluation.reasons.some((reason) => reason.includes('NEWS2 elevado'))).toBe(true);
    expect(evaluation.reasons.some((reason) => reason.includes('Braden bajo'))).toBe(true);
  });

  it('solicita confirmación cuando se envía con riesgo alto', async () => {
    const evaluation = deriveRiskEvaluationFromValues(
      { rr: 28, spo2: 90, sbp: 95, hr: 130, tempC: 38.5, avpu: 'V' },
      undefined,
      {},
    );
    const alertMock = vi.fn((_, __, buttons?: Array<{ onPress?: () => void }>) => {
      buttons?.find((btn) => btn?.text?.includes('Confirmar'))?.onPress?.();
    });

    const confirmed = await confirmHighRiskSubmission('final', evaluation, alertMock);

    expect(alertMock).toHaveBeenCalled();
    expect(confirmed).toBe(true);
  });

  it('no bloquea borradores cuando el riesgo es alto', async () => {
    const evaluation = deriveRiskEvaluationFromValues({ rr: 25, spo2: 92, sbp: 100, hr: 120, tempC: 38.2, avpu: 'A' }, undefined, {});
    const alertMock = vi.fn();

    const confirmed = await confirmHighRiskSubmission('draft', evaluation, alertMock);

    expect(alertMock).not.toHaveBeenCalled();
    expect(confirmed).toBe(true);
  });
});
