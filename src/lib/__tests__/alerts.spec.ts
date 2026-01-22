import { describe, expect, it } from 'vitest';

import { computeAlerts } from '../alerts';
import type { Handover, RiskItem } from '@/src/types/handover';

const baseHandover: Handover = {
  administrativeData: {
    unit: 'icu-a',
    census: 0,
    staffIn: [],
    staffOut: [],
    shiftStart: '2024-01-01T08:00:00.000Z',
    shiftEnd: '2024-01-01T16:00:00.000Z',
    shiftType: 'Mañana',
    incidents: [],
  },
  patientId: 'pat-001',
  status: 'draft',
  vitals: {},
  risksStructured: [],
};

function withRisks(risks: RiskItem[]): Handover {
  return { ...baseHandover, risksStructured: risks };
}

function withOverrides(overrides: Partial<Handover>): Handover {
  return { ...baseHandover, ...overrides };
}

describe('computeAlerts', () => {
  it('marca alerta por riesgo de caída sin medidas básicas', () => {
    const alerts = computeAlerts(
      withRisks([{ type: 'fall', present: true, actions: [], notes: undefined }]),
    );

    const fallAlert = alerts.find(alert => alert.id === 'risk-fall-no-actions');
    expect(fallAlert?.severity).toBe('warning');
    expect(fallAlert?.source).toBe('risk');
  });

  it('advierte riesgo de UPP con Braden alto sin acciones', () => {
    const risks: RiskItem[] = [{ type: 'pressureUlcer', present: true, actions: [], notes: undefined }];
    const braden = {
      sensoryPerception: 2,
      moisture: 2,
      activity: 2,
      mobility: 2,
      nutrition: 2,
      frictionShear: 1,
      totalScore: 11,
      riskLevel: 'alto' as const,
    };

    const alerts = computeAlerts(withOverrides({ risksStructured: risks, braden }));
    const pressureAlert = alerts.find(alert => alert.id === 'risk-pressure-no-actions');

    expect(pressureAlert?.severity).toBe('warning');
    expect(pressureAlert?.riskType).toBe('pressureUlcer');
  });

  it('eleva alerta crítica cuando NEWS2 alto coincide con riesgos', () => {
    const vitals = { rr: 30, spo2: 90, tempC: 39, sbp: 85, hr: 130, o2: true, avpu: 'V' as const };
    const risks: RiskItem[] = [
      { type: 'fall', present: true, actions: ['bedRailsUp'], notes: undefined },
    ];

    const alerts = computeAlerts(withOverrides({ vitals, risksStructured: risks }));
    const combined = alerts.find(alert => alert.id === 'news2-high-with-risk');

    expect(combined?.severity).toBe('critical');
    expect(combined?.source).toBe('vitals');
  });
});
