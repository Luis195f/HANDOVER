import { describe, expect, it } from 'vitest';

import { FHIR_CODES } from '../codes';
import { buildHandoverBundle, type HandoverValues } from '../fhir-map';

type SimpleCode = { system: string; code: string };

type CodedResource = {
  resourceType?: string;
  code?: { coding?: Array<{ system?: string; code?: string }> };
};

const FIXED_NOW = '2024-05-01T10:00:00Z';

const findResourceByCode = (
  resources: CodedResource[],
  resourceType: string,
  code: SimpleCode,
) =>
  resources.find(
    (resource) =>
      resource?.resourceType === resourceType &&
      resource?.code?.coding?.some(
        (coding) => coding?.system === code.system && coding?.code === code.code,
      ),
  );

describe('FHIR terminology consistency checks', () => {
  describe('dictionary definitions', () => {
    it('pins LOINC entries for temperature and heart rate and SNOMED for fall risk', () => {
      expect(FHIR_CODES.VITALS.TEMPERATURE).toEqual({
        system: 'http://loinc.org',
        code: '8310-5',
        display: 'Body temperature',
      });

      expect(FHIR_CODES.VITALS.HEART_RATE).toEqual({
        system: 'http://loinc.org',
        code: '8867-4',
        display: 'Heart rate',
      });

      expect(FHIR_CODES.RISK.FALL).toEqual({
        system: 'http://snomed.info/sct',
        code: '129839007',
        display: 'At risk for falls (finding)',
      });
    });
  });

  describe('mapping output', () => {
    it('reuses the dictionary codes for vitals, EVA scale, and fall-risk condition', () => {
      const values: HandoverValues = {
        patientId: 'patient-123',
        encounterId: 'encounter-001',
        vitals: {
          hr: 78,
          tempC: 37.2,
        },
        painAssessment: {
          hasPain: true,
          evaScore: 6,
        },
        risks: { fall: true },
      };

      const bundle = buildHandoverBundle(values, { now: () => FIXED_NOW });
      const resources = bundle.entry.map((entry) => entry.resource);

      const temperatureObservation = findResourceByCode(
        resources,
        'Observation',
        FHIR_CODES.VITALS.TEMPERATURE,
      );
      expect(temperatureObservation?.code?.coding?.[0]).toEqual(FHIR_CODES.VITALS.TEMPERATURE);

      const heartRateObservation = findResourceByCode(
        resources,
        'Observation',
        FHIR_CODES.VITALS.HEART_RATE,
      );
      expect(heartRateObservation?.code?.coding?.[0]).toEqual(FHIR_CODES.VITALS.HEART_RATE);

      const evaObservation = findResourceByCode(resources, 'Observation', FHIR_CODES.SCALES.EVA);
      expect(evaObservation?.code?.coding?.[0]).toEqual(FHIR_CODES.SCALES.EVA);

      const fallCondition = findResourceByCode(resources, 'Condition', FHIR_CODES.RISK.FALL);
      expect(fallCondition?.code?.coding?.[0]).toEqual(FHIR_CODES.RISK.FALL);
    });
  });
});
