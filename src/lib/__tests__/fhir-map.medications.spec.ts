import { describe, expect, it } from 'vitest';

import { buildHandoverBundle } from '../fhir-map';

const listResources = (bundle: any, resourceType: string) =>
  (bundle.entry ?? []).map((entry: any) => entry.resource).filter((res: any) => res?.resourceType === resourceType);

describe('FHIR map — medicaciones estructuradas y tratamientos', () => {
  const patientId = 'pat-001';
  const now = () => '2024-01-01T00:00:00Z';

  it('genera un MedicationStatement por cada MedicationItem estructurado', () => {
    const bundle = buildHandoverBundle(
      {
        patientId,
        medications: [
          {
            id: 'med-1',
            name: 'Paracetamol',
            code: { system: 'http://www.whocc.no/atc', code: 'N02BE01', display: 'Paracetamol' },
            dose: '1 g',
            route: 'iv',
            frequency: 'cada 8h',
          },
          { id: 'med-2', name: 'Omeprazol', frequency: '1 vez/día' },
        ],
      },
      { now },
    );

    const meds = listResources(bundle, 'MedicationStatement');
    expect(meds).toHaveLength(2);
    expect(meds[0].medicationCodeableConcept.text).toBe('Paracetamol');
    expect(meds[0].medicationCodeableConcept.coding?.[0]?.code).toBe('N02BE01');
    expect(meds[0].dosage?.[0]?.text).toContain('1 g');
    expect(meds[1].medicationCodeableConcept.text).toBe('Omeprazol');
  });

  it('utiliza el campo de texto libre como fallback cuando no hay lista estructurada', () => {
    const bundle = buildHandoverBundle({ patientId, medications: [], meds: 'Metamizol 2 g IV' }, { now });
    const meds = listResources(bundle, 'MedicationStatement');
    expect(meds.length).toBeGreaterThan(0);
    expect(meds.some((item: any) => item.medicationCodeableConcept.text === 'Metamizol 2 g IV')).toBe(true);
  });

  it('mapea tratamientos no farmacológicos a Procedure', () => {
    const bundle = buildHandoverBundle(
      {
        patientId,
        treatments: [
          { id: 'tx-1', type: 'woundCare', description: 'Cura de úlcera sacra', scheduledAt: '2024-01-02T10:00:00Z' },
        ],
      },
      { now },
    );

    const procedures = listResources(bundle, 'Procedure');
    expect(procedures).toHaveLength(1);
    expect(procedures[0].status).toBe('in-progress');
    expect(procedures[0].code.coding?.[0]?.code).toBe('woundCare');
    expect(procedures[0].note?.[0]?.text).toContain('Cura de úlcera sacra');
  });
});
