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
          { id: 'med-2', name: 'Omeprazol', frequency: '1 vez/dia' },
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

  it('no usa campo legacy meds como fallback (requiere lista canónica medications[])', () => {
    const bundle = buildHandoverBundle({ patientId, medications: [], meds: 'Metamizol 2 g IV' }, { now });
    const meds = listResources(bundle, 'MedicationStatement');
    expect(meds).toHaveLength(0);
  });

  it('genera MedicationAdministration para medicaciones no continuas con alertas', () => {
    const bundle = buildHandoverBundle(
      {
        patientId,
        medications: [
          {
            id: 'med-3',
            name: 'Furosemida',
            dose: '20 mg',
            route: 'iv',
            frequency: 'cada 8h',
            isContinuous: false,
            isHighAlert: true,
            startTime: '2024-01-01T08:00:00Z',
          },
        ],
      },
      { now },
    );

    const administrations = listResources(bundle, 'MedicationAdministration');
    expect(administrations).toHaveLength(1);
    expect(administrations[0].status).toBe('in-progress');
    expect(administrations[0].medicationCodeableConcept.text).toBe('Furosemida');
    expect(administrations[0].dosage?.route?.coding?.[0]?.code).toBe('IV');
    expect(administrations[0].dosage?.dose?.value).toBe(20);
    expect(administrations[0].extension?.[0]?.valueBoolean).toBe(true);
  });

  it('mapea tratamientos no farmacologicos a Procedure', () => {
    const bundle = buildHandoverBundle(
      {
        patientId,
        treatments: [
          { id: 'tx-1', type: 'woundCare', description: 'Cura de ulcera sacra', scheduledAt: '2024-01-02T10:00:00Z' },
        ],
      },
      { now },
    );

    const procedures = listResources(bundle, 'Procedure');
    expect(procedures).toHaveLength(1);
    expect(procedures[0].status).toBe('in-progress');
    expect(procedures[0].code.coding?.[0]?.code).toBe('woundCare');
    expect(procedures[0].note?.[0]?.text).toContain('Cura de ulcera sacra');
  });

  it('incluye codificacion NIC opcional en Procedure cuando treatments[].code esta presente', () => {
    const bundle = buildHandoverBundle(
      {
        patientId,
        treatments: [
          {
            id: 'tx-nic-1',
            type: 'other',
            description: 'Control del dolor',
            code: {
              system: 'NIC',
              code: '2210',
              display: 'Administracion de analgesicos',
            },
          },
        ],
      },
      { now },
    );

    const procedures = listResources(bundle, 'Procedure');
    expect(procedures).toHaveLength(1);

    const nicCoding = procedures[0].code.coding?.find(
      (coding: { system?: string; code?: string }) => coding.system === 'urn:handover:terminology:NIC',
    );

    expect(nicCoding?.code).toBe('2210');
    expect(nicCoding?.display).toBe('Administracion de analgesicos');
  });
  it('maps NOC outcomes to Observation resources with category outcome and explicit scores', () => {
    const bundle = buildHandoverBundle(
      {
        patientId,
        outcomes: [
          {
            nocCode: '0402',
            nocDisplay: 'Estado respiratorio: permeabilidad de las vías aéreas',
            baseline: 2,
            target: 4,
            current: 3,
          },
        ],
      },
      { now },
    );

    const observations = listResources(bundle, 'Observation');
    const outcomeObservation = observations.find(
      (item) => item.category?.some((cat: any) => cat.coding?.some((coding: any) => coding.code === 'outcome')),
    );

    expect(outcomeObservation).toBeTruthy();
    expect(outcomeObservation.code?.coding?.[0]?.system).toBe('urn:handover:terminology:NOC');
    expect(outcomeObservation.code?.coding?.[0]?.code).toBe('0402');
    expect(outcomeObservation.code?.coding?.[0]?.display).toBe(
      'Estado respiratorio: permeabilidad de las vías aéreas',
    );

    const baselineComponent = outcomeObservation.component?.find(
      (component: any) => component.code?.coding?.[0]?.code === 'baseline',
    );
    const targetComponent = outcomeObservation.component?.find(
      (component: any) => component.code?.coding?.[0]?.code === 'target',
    );
    const currentComponent = outcomeObservation.component?.find(
      (component: any) => component.code?.coding?.[0]?.code === 'current',
    );

    expect(baselineComponent?.valueInteger).toBe(2);
    expect(targetComponent?.valueInteger).toBe(4);
    expect(currentComponent?.valueInteger).toBe(3);
  });
});
