import { describe, expect, it, expectTypeOf } from 'vitest';

import {
  ALERT_CODES,
  BOOLEAN_CODES,
  CATEGORY,
  CONDITION_CODES,
  DOCUMENT_CLASS_CODES,
  EXAM_CODES,
  FHIR_CODES,
  LOINC,
  MEDICATION_ROUTE_CODES,
  SNOMED,
  TERMINOLOGY_SYSTEMS,
  type LoincCode,
  type TerminologyCode,
} from '@/src/lib/codes';

// Compile-time helpers to ensure literal unions stay narrow.
type ExpectTrue<T extends true> = T;
type ExpectFalse<T extends false> = T;
type IsAssignable<A, B> = [A] extends [B] ? true : false;

type _CheckHrCode = ExpectTrue<IsAssignable<'8867-4', LoincCode>>;
type _CheckRandomCode = ExpectFalse<IsAssignable<'not-a-code', LoincCode>>;

describe('FHIR terminology dictionary', () => {
  it('exposes the canonical LOINC identifiers for vitals', () => {
    expect(LOINC.hr).toBe('8867-4');
    expect(LOINC.rr).toBe('9279-1');
    expect(LOINC.temp).toBe('8310-5');
    expect(LOINC.spo2).toBe('59408-5');
    expect(LOINC.sbp).toBe('8480-6');
    expect(LOINC.dbp).toBe('8462-4');
    expect(LOINC.bpPanel).toBe('85354-9');
    expect(LOINC.vitalSignsPanel).toBe('85353-1');
    expect(LOINC.glucoseMgDl).toBe('2339-0');
    expect(LOINC.glucoseMmolL).toBe('15074-8');
    expect(LOINC.fio2).toBe('3151-8');
    expect(LOINC.o2Flow).toBe('3150-0');
    expect(LOINC.acvpu).toBe('67775-7');
  });

  it('keeps observation categories tied to the HL7 system', () => {
    const system = TERMINOLOGY_SYSTEMS.OBSERVATION_CATEGORY;
    expect(CATEGORY.vitalSigns).toMatchObject<TerminologyCode<string>>({
      system,
      code: 'vital-signs',
      display: 'Vital Signs',
    });
    expect(CATEGORY.laboratory).toMatchObject<TerminologyCode<string>>({
      system,
      code: 'laboratory',
      display: 'Laboratory',
    });
    expect(CATEGORY.survey).toMatchObject<TerminologyCode<string>>({
      system,
      code: 'survey',
      display: 'Survey',
    });
    expect(CATEGORY.imaging).toMatchObject<TerminologyCode<string>>({
      system,
      code: 'imaging',
      display: 'Imaging',
    });
  });

  it('defines SNOMED, condition, and risk codes as coded concepts', () => {
    expect(SNOMED.oxygenTherapy).toBe('371907003');
    expect(FHIR_CODES.RISK.FALL).toMatchObject({
      system: TERMINOLOGY_SYSTEMS.SNOMED,
      code: '129839007',
    });
    expect(FHIR_CODES.RISK.PRESSURE_ULCER.code).toBe('714658008');
    expect(FHIR_CODES.RISK.SOCIAL_ISOLATION.code).toBe('1144779008');
    expect(CONDITION_CODES.ACTIVE).toMatchObject({
      system: TERMINOLOGY_SYSTEMS.CONDITION_CLINICAL_STATUS,
      code: 'active',
    });
    expect(CONDITION_CODES.UNCONFIRMED.code).toBe('unconfirmed');
    expect(CONDITION_CODES.PROBLEM_LIST_ITEM.code).toBe('problem-list-item');
  });

  it('exposes reusable dictionary entries for vitals, scales, exams, and medication routes', () => {
    expect(FHIR_CODES.VITALS.HEART_RATE).toMatchObject({
      system: TERMINOLOGY_SYSTEMS.LOINC,
      code: LOINC.hr,
    });
    expect(FHIR_CODES.VITALS.BP_PANEL.code).toBe(LOINC.bpPanel);
    expect(FHIR_CODES.VITALS.GLUCOSE_MASS_BLD.code).toBe(LOINC.glucoseMgDl);
    expect(FHIR_CODES.SCALES.EVA.code).toBe(LOINC.painEva);
    expect(FHIR_CODES.SCALES.BRADEN.code).toBe(LOINC.bradenScale);
    expect(FHIR_CODES.SCALES.GLASGOW.code).toBe(LOINC.glasgowTotal);
    expect(FHIR_CODES.CARE.NUTRITION.system).toBe(TERMINOLOGY_SYSTEMS.HANDOVER_CARE);
    expect(EXAM_CODES.LABORATORY).toMatchObject({
      system: TERMINOLOGY_SYSTEMS.HANDOVER_EXAM,
      code: 'lab',
    });
    expect(MEDICATION_ROUTE_CODES.iv).toMatchObject({
      system: TERMINOLOGY_SYSTEMS.V3_ROUTE_OF_ADMINISTRATION,
      code: 'IV',
    });
  });

  it('keeps local boolean and document-class codes stable for downstream consumers', () => {
    expect(BOOLEAN_CODES.YES).toMatchObject({
      system: TERMINOLOGY_SYSTEMS.HANDOVER_BOOLEAN,
      code: 'yes',
    });
    expect(BOOLEAN_CODES.NO.code).toBe('no');
    expect(DOCUMENT_CLASS_CODES.AUDIO_RECORDING.code).toBe('LP29684-5');
    expect(DOCUMENT_CLASS_CODES.ATTACHMENT.system).toBe(TERMINOLOGY_SYSTEMS.DOCUMENT_CLASSCODES);
  });

  it('keeps alert identifiers stable for downstream consumers', () => {
    expect(ALERT_CODES.news2).toBe('alert.news2');
    expect(ALERT_CODES.catheterOverdue).toBe('alert.catheter.overdue');
    expect(ALERT_CODES.oxygenProlonged).toBe('alert.oxygen.prolonged');
  });

  it('exports reusable typing helpers', () => {
    expectTypeOf(CATEGORY.vitalSigns).toMatchTypeOf<TerminologyCode<string>>();
    expectTypeOf(FHIR_CODES.RISK.FALL).toMatchTypeOf<TerminologyCode<string>>();
    expectTypeOf(FHIR_CODES.VITALS.HEART_RATE).toMatchTypeOf<TerminologyCode<string>>();
  });
});
