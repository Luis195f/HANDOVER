import { describe, expect, it } from 'vitest';

import { SNOMED } from '@/src/lib/codes';
import { buildHandoverBundle, type HandoverValues } from '@/src/lib/fhir-map';
import {
  HandoverValidationError,
  listResources,
  validateHandoverBundle,
} from '@/src/lib/fhir/validation';

describe('FHIR handover bundle validation', () => {
  const NOW = '2025-03-01T12:34:56.000Z';
  const values: HandoverValues = {
    patientId: 'patient-900',
    encounterId: 'encounter-321',
    author: { id: 'nurse-007', display: 'Nurse Zero Seven' },
    vitals: {
      recordedAt: '2025-03-01T12:00:00.000Z',
      issuedAt: '2025-03-01T12:05:00.000Z',
      hr: 86,
      rr: 18,
      tempC: 37.1,
      spo2: 97,
      sbp: 122,
      dbp: 78,
      glucoseMgDl: 108,
      avpu: 'A',
    },
    medications: [
      {
        status: 'active',
        code: {
          system: 'http://www.nlm.nih.gov/research/umls/rxnorm',
          code: '161',
          display: 'Paracetamol 500 mg tablet',
        },
        note: 'Administered after lunch',
        start: '2025-03-01T11:00:00.000Z',
      },
    ],
    oxygenTherapy: {
      status: 'in-progress',
      start: '2025-03-01T10:30:00.000Z',
      flowLMin: 3,
      fio2: 40,
      deviceDisplay: 'Nasal cannula',
      note: 'Wean as tolerated',
    },
    audioAttachment: {
      url: 'https://cdn.example.org/audio/handover.m4a',
      contentType: 'audio/m4a',
      title: 'SBAR summary',
    },
    composition: {
      status: 'final',
      title: 'End of shift summary',
    },
  };

  it('validates structural constraints for Bundle and embedded resources', () => {
    const bundle = buildHandoverBundle(values, { now: () => NOW });
    const result = validateHandoverBundle(bundle);

    expect(result.bundle.resourceType).toBe('Bundle');
    expect(result.bundle.type).toBe('transaction');
    expect(result.bundle.entry.length).toBeGreaterThanOrEqual(7);

    expect(result.encounterReference).toBe('Encounter/encounter-321');

    const composition = result.composition;
    expect(composition.title).toBe('End of shift summary');
    expect(composition.section?.map((section) => section.title)).toEqual([
      'Vital signs',
      'Medications',
      'Oxygen therapy',
      'Attachments',
    ]);

    const observations = listResources(result, 'Observation');
    expect(observations.length).toBeGreaterThanOrEqual(5);
    observations.forEach((observation) => {
      expect(observation.subject.reference).toBe('Patient/patient-900');
      expect(observation.encounter?.reference).toBe('Encounter/encounter-321');
      expect(new Date(observation.effectiveDateTime).toISOString()).toBe(
        observation.effectiveDateTime,
      );
      expect(new Date(observation.issued).toISOString()).toBe(observation.issued);
    });

    const medicationStatements = listResources(result, 'MedicationStatement');
    expect(medicationStatements).toHaveLength(1);
    expect(medicationStatements[0]?.medicationCodeableConcept.coding[0]?.code).toBe('161');

    const oxygenProcedures = listResources(result, 'Procedure');
    expect(oxygenProcedures).toHaveLength(1);
    expect(oxygenProcedures[0]?.code.coding[0]?.code).toBe(SNOMED.oxygenTherapy);

    const deviceUse = listResources(result, 'DeviceUseStatement');
    expect(deviceUse).toHaveLength(1);
    expect(deviceUse[0]?.device.display).toBe('Nasal cannula');
    expect(deviceUse[0]?.timingPeriod?.start).toBe('2025-03-01T10:30:00.000Z');

    const documentRefs = listResources(result, 'DocumentReference');
    expect(documentRefs).toHaveLength(1);
    expect(documentRefs[0]?.content[0]?.attachment.url).toBe(
      'https://cdn.example.org/audio/handover.m4a',
    );
  });

  it('fails fast when bundle structure deviates from expectations', () => {
    const bundle = buildHandoverBundle(values, { now: () => NOW });
    // Remove DeviceUseStatement reference from Composition to force a validation error
    const compositionEntry = bundle.entry.find(
      (entry) => entry.resource.resourceType === 'Composition',
    );
    if (!compositionEntry) throw new Error('Expected Composition in bundle');

    compositionEntry.resource.section = (compositionEntry.resource.section ?? []).map((section) => ({
      ...section,
      entry: section.title === 'Oxygen therapy' ? section.entry?.slice(0, 1) ?? [] : section.entry,
    }));

    expect(() => validateHandoverBundle(bundle)).toThrow(HandoverValidationError);
  });
});
