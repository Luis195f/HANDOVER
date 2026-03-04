import { describe, expect, it } from 'vitest';

import { buildHandoverBundle } from '../fhir-map';
import { TEST_RISK_CODES } from './fhir-map.test-constants';

const NOW = '2025-01-01T08:00:00.000Z';

type BundleEntry = { resource?: { resourceType?: string; [key: string]: any } };

function extractConditions(entries: BundleEntry[] = []) {
  return entries
    .filter((entry) => entry.resource?.resourceType === 'Condition')
    .map((entry) => entry.resource!);
}

describe('mapRiskConditions', () => {
  it('genera Condition por cada riesgo activado', () => {
    const bundle = buildHandoverBundle(
      {
        patientId: 'pat-risk-001',
        risksStructured: [
          { type: 'fall', present: true, actions: [] },
          { type: 'pressureUlcer', present: true, actions: [] },
          { type: 'isolation', present: true, actions: [] },
        ],
      },
      { now: () => NOW },
    );

    const conditions = extractConditions(bundle.entry as BundleEntry[]);
    expect(conditions).toHaveLength(3);

    const codes = conditions.map((condition) => condition.code?.coding?.[0]?.code).sort();
    expect(codes).toEqual([
      TEST_RISK_CODES.SOCIAL_ISOLATION.code,
      TEST_RISK_CODES.FALL.code,
      TEST_RISK_CODES.PRESSURE_ULCER.code,
    ].sort());

    const patientEntry = (bundle.entry as Array<BundleEntry & { fullUrl?: string }>).find(
      (entry) => entry.resource?.resourceType === 'Patient'
    );
    const patientReference = patientEntry?.fullUrl;

    conditions.forEach((condition) => {
      expect(condition.subject?.reference).toBe(patientReference);
      expect(condition.recordedDate).toBe(NOW);
      expect(condition.category?.[0]?.coding?.[0]?.code).toBe('problem-list-item');
    });
  });

  it('omite riesgos no marcados', () => {
    const bundle = buildHandoverBundle(
      {
        patientId: 'pat-risk-002',
        risksStructured: [{ type: 'fall', present: false, actions: [] }],
      },
      { now: () => NOW },
    );

    const conditions = extractConditions(bundle.entry as BundleEntry[]);
    expect(conditions).toHaveLength(0);
  });
});
