import { describe, expect, it } from 'vitest';

import { computeAlerts } from './alerts';
import type { RiskItem } from '../types/handover';

const fallRisk: RiskItem = { type: 'fall', present: true, actions: [], notes: undefined };
const highVitals = { rr: 30, spo2: 85, tempC: 39, sbp: 80, hr: 130 };

describe('computeAlerts', () => {
  it('requires an active risk in addition to high NEWS2', () => {
    expect(computeAlerts({ vitals: highVitals })).toEqual([]);
    expect(computeAlerts({ vitals: highVitals, risksStructured: [fallRisk] })
      .some((alert) => alert.id === 'news2-high-with-risk')).toBe(true);
  });

  it('does not treat malformed vital signs as a NEWS2 alert', () => {
    const alerts = computeAlerts({
      vitals: { rr: Number.NaN },
      risksStructured: [{ ...fallRisk, actions: ['bedRailsUp'] }],
    });
    expect(alerts).toEqual([]);
  });

  it('keeps deterministic active risk alerts without duplicate kinds', () => {
    const alerts = computeAlerts({
      risksStructured: [fallRisk, { ...fallRisk }],
    });
    expect(alerts.map((alert) => alert.id)).toEqual(['risk-fall-no-actions']);
  });
});
