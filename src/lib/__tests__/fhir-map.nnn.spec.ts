import { describe, expect, it } from 'vitest';

import { buildHandoverBundle } from '@/src/lib/fhir-map';

function listConditions(bundle: any) {
  return (bundle.entry ?? []).map((entry: any) => entry.resource).filter((resource: any) => resource?.resourceType === 'Condition');
}

describe('FHIR map NNN seams', () => {
  it('maps structured NANDA diagnoses without duplicating legacy free text fallback', () => {
    const bundle = buildHandoverBundle(
      {
        patientId: 'pat-nnn-1',
        dxNursing: 'Legacy diagnosis',
        dxNursingStructured: [
          {
            system: 'NANDA',
            code: '00004',
            display: 'Riesgo de infeccion',
          },
        ],
      },
      { now: '2025-02-01T10:00:00Z' },
    );

    const conditions = listConditions(bundle);
    expect(conditions).toHaveLength(1);
    expect(conditions[0].code?.coding?.[0]?.system).toBe('urn:handover:terminology:NANDA-I');
    expect(conditions[0].code?.coding?.[0]?.code).toBe('00004');
    expect(conditions[0].code?.text).toBe('Riesgo de infeccion');
  });

  it('falls back to legacy nursing text when no structured NANDA diagnosis exists', () => {
    const bundle = buildHandoverBundle(
      {
        patientId: 'pat-nnn-2',
        dxNursing: 'Diagnostico legado',
      },
      { now: '2025-02-01T10:00:00Z' },
    );

    const conditions = listConditions(bundle);
    expect(conditions).toHaveLength(1);
    expect(conditions[0].code?.coding ?? []).toHaveLength(0);
    expect(conditions[0].code?.text).toBe('Diagnostico legado');
  });
});
