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
        risks: { fall: true, pressureUlcer: true, isolation: true },
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

    conditions.forEach((condition) => {
      expect(condition.subject?.reference).toBe('Patient/pat-risk-001');
      expect(condition.recordedDate).toBe(NOW);
      expect(condition.category?.[0]?.coding?.[0]?.code).toBe('problem-list-item');
    });
  });

  it('omite riesgos no marcados', () => {
    const bundle = buildHandoverBundle(
      {
        patientId: 'pat-risk-002',
        risks: { fall: false },
      },
      { now: () => NOW },
    );

    const conditions = extractConditions(bundle.entry as BundleEntry[]);
    expect(conditions).toHaveLength(0);
  });
});
