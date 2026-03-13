import { describe, expect, it } from 'vitest';

import {
  CATEGORY,
  CONDITION_CODES,
  EXAM_CODES,
  FHIR_CODES,
  MEDICATION_ROUTE_CODES,
  TERMINOLOGY_SYSTEMS,
} from '../codes';
import { buildHandoverBundle, type HandoverValues } from '../fhir-map';

type SimpleCode = { system: string; code: string };

type CodedResource = {
  resourceType?: string;
  code?: { coding?: Array<{ system?: string; code?: string }> };
  category?: Array<{ coding?: Array<{ system?: string; code?: string }> }>;
  dosage?: Array<{ route?: { coding?: Array<{ system?: string; code?: string }> } }>;
  medicationCodeableConcept?: { coding?: Array<{ system?: string; code?: string }>; text?: string };
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

const findMedicationByName = (resources: CodedResource[], name: string) =>
  resources.find(
    (resource) =>
      resource?.resourceType === 'MedicationStatement' &&
      resource?.medicationCodeableConcept?.text === name,
  );

describe('FHIR terminology consistency checks', () => {
  describe('dictionary definitions', () => {
    it('pins canonical codes for vitals, conditions, exams, and medication routes', () => {
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

      expect(CONDITION_CODES.ACTIVE).toEqual({
        system: TERMINOLOGY_SYSTEMS.CONDITION_CLINICAL_STATUS,
        code: 'active',
        display: 'Active',
      });

      expect(EXAM_CODES.LABORATORY).toEqual({
        system: TERMINOLOGY_SYSTEMS.HANDOVER_EXAM,
        code: 'lab',
        display: 'Laboratory result',
      });

      expect(MEDICATION_ROUTE_CODES.iv).toEqual({
        system: TERMINOLOGY_SYSTEMS.V3_ROUTE_OF_ADMINISTRATION,
        code: 'IV',
        display: 'Intravenous',
      });
    });
  });

  describe('mapping output', () => {
    it('reuses centralized codes for vitals, scales, risks, exams, and medication routes', () => {
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
        glasgow: {
          eye: 4,
          verbal: 5,
          motor: 6,
          total: 15,
          severity: 'leve',
        },
        nutrition: {
          dietType: 'oral',
          intakeMl: 800,
        },
        exams: [{ type: 'laboratory', state: 'result', description: 'Hemograma completo' }],
        medications: [
          {
            id: 'med-1',
            name: 'Paracetamol',
            code: {
              system: TERMINOLOGY_SYSTEMS.ATC,
              code: 'N02BE01',
              display: 'Paracetamol',
            },
            route: 'iv',
            dose: '1 g',
            frequency: 'cada 8h',
          },
        ],
        bedsideChecklist: {
          patientIdentityConfirmed: true,
          allergiesReviewed: true,
          linesAndDevicesChecked: false,
          medicationPlanReviewed: false,
          safetyMeasuresApplied: false,
          questionsAnswered: false,
        },
        risksStructured: [{ type: 'fall', present: true, actions: [] }],
      };

      const bundle = buildHandoverBundle(values, { now: () => FIXED_NOW });
      const resources = bundle.entry.map((entry) => entry.resource) as CodedResource[];

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

      const glasgowObservation = findResourceByCode(
        resources,
        'Observation',
        FHIR_CODES.SCALES.GLASGOW,
      );
      expect(glasgowObservation?.code?.coding?.[0]).toEqual(FHIR_CODES.SCALES.GLASGOW);

      const fallCondition = findResourceByCode(resources, 'Condition', FHIR_CODES.RISK.FALL);
      expect(fallCondition?.code?.coding?.[0]).toEqual(FHIR_CODES.RISK.FALL);
      expect((fallCondition as { clinicalStatus?: { coding?: Array<{ code?: string }> } })?.clinicalStatus?.coding?.[0]?.code).toBe(
        CONDITION_CODES.ACTIVE.code,
      );

      const laboratoryExam = findResourceByCode(resources, 'Observation', EXAM_CODES.LABORATORY);
      expect(laboratoryExam?.code?.coding?.[0]).toEqual(EXAM_CODES.LABORATORY);
      expect(laboratoryExam?.category?.[0]?.coding?.[0]).toEqual(CATEGORY.laboratory);

      const nutritionObservation = findResourceByCode(resources, 'Observation', FHIR_CODES.CARE.NUTRITION);
      expect(nutritionObservation?.code?.coding?.[0]).toEqual(FHIR_CODES.CARE.NUTRITION);

      const medication = findMedicationByName(resources, 'Paracetamol');
      expect(medication?.dosage?.[0]?.route?.coding?.[0]).toEqual(MEDICATION_ROUTE_CODES.iv);
    });
  });
});
