import { describe, expect, it } from 'vitest';

import * as medicationFacade from '../fhir-map/medication';
import * as vitalsFacade from '../fhir-map/vitals';
import {
  buildHandoverBundle,
  mapMedicationStatements,
  mapObservationVitals,
  mapVitalsToObservations,
  type MedicationResource,
} from '../fhir-map';

type MedicationResourceFromFacade = import('../fhir-map/medication').MedicationResource;

const expectMedicationResourceArray = (value: MedicationResourceFromFacade[]): MedicationResource[] => value;

const listResources = (bundle: ReturnType<typeof buildHandoverBundle>, resourceType: string) =>
  (bundle.entry ?? []).map((entry) => entry.resource).filter((resource) => resource?.resourceType === resourceType);

describe('fhir-map public facade compatibility', () => {
  it('preserves the medication secondary facade without leaking internal impl exports', () => {
    expect(medicationFacade).toMatchObject({
      mapMedicationStatements: expect.any(Function),
    });
    expect('mapMedicationStatementsImpl' in medicationFacade).toBe(false);
    expect('MedicationsMapperDependencies' in medicationFacade).toBe(false);

    const values = {
      patientId: 'pat-med-compat',
      medications: [
        {
          id: 'med-compat-1',
          name: 'Paracetamol',
          dose: '1 g',
          frequency: 'cada 8h',
          route: 'oral' as const,
        },
      ],
    };

    const fromFacade = expectMedicationResourceArray(medicationFacade.mapMedicationStatements(values, { now: '2024-01-01T00:00:00Z' }));
    const fromRoot = mapMedicationStatements(values, { now: '2024-01-01T00:00:00Z' });

    expect(fromFacade).toEqual(fromRoot);
  });

  it('preserves the vitals secondary facade without leaking internal impl exports', () => {
    expect(vitalsFacade).toMatchObject({
      mapObservationVitals: expect.any(Function),
      mapVitalsToObservations: expect.any(Function),
    });
    expect('mapObservationVitalsImpl' in vitalsFacade).toBe(false);
    expect('mapVitalsToObservationsImpl' in vitalsFacade).toBe(false);
    expect('mapOxygenObservationsImpl' in vitalsFacade).toBe(false);
    expect('VitalsMapperDependencies' in vitalsFacade).toBe(false);

    const observationInput = {
      patientId: 'pat-vitals-compat',
      hr: 82,
      rr: 18,
      sbp: 120,
      dbp: 76,
    };
    const vitalsInput = {
      patientId: 'pat-vitals-compat',
      vitals: {
        hr: 82,
        rr: 18,
        sbp: 120,
        dbp: 76,
      },
    };

    expect(vitalsFacade.mapObservationVitals(observationInput, { now: '2024-01-01T00:00:00Z' })).toEqual(
      mapObservationVitals(observationInput, { now: '2024-01-01T00:00:00Z' }),
    );
    expect(vitalsFacade.mapVitalsToObservations(vitalsInput, { now: '2024-01-01T00:00:00Z' })).toEqual(
      mapVitalsToObservations(vitalsInput, { now: '2024-01-01T00:00:00Z' }),
    );
  });

  it('keeps the main fhir-map entry point behavior for vitals bundles', () => {
    const bundle = buildHandoverBundle(
      {
        patientId: 'pat-root-vitals',
        vitals: { hr: 84, rr: 17, sbp: 122, dbp: 74 },
      },
      { now: '2024-01-01T00:00:00Z' },
    );

    const observations = listResources(bundle, 'Observation');
    const codes = observations.flatMap((resource: any) => resource.code?.coding?.map((coding: any) => coding.code) ?? []);

    expect(codes).toContain('8867-4');
    expect(codes).toContain('85354-9');
  });

  it('keeps the main fhir-map entry point behavior for medication bundles', () => {
    const bundle = buildHandoverBundle(
      {
        patientId: 'pat-root-medications',
        medications: [
          {
            id: 'med-root-1',
            name: 'Omeprazol',
            frequency: '1 vez/dia',
          },
        ],
      },
      { now: '2024-01-01T00:00:00Z' },
    );

    const medications = listResources(bundle, 'MedicationStatement');

    expect(medications).toHaveLength(1);
    expect((medications[0] as any).medicationCodeableConcept.text).toBe('Omeprazol');
  });
});
