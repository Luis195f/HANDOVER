import { describe, expect, it } from 'vitest';

import { buildHandoverBundle } from '@/src/lib/fhir-map';
import { validateBundle } from '@/src/lib/fhir/validators';

describe('FHIR handover bundle', () => {
  it('bundle contiene Observation/MedicationStatement/DeviceUse/DocumentReference válidos', () => {
    const bundle = buildHandoverBundle(
      {
        patientId: 'pat-1',
        encounterId: 'enc-1',
        author: { id: 'nurse-007', display: 'Nurse Example' },
        vitals: {
          hr: 82,
          rr: 18,
          sbp: 118,
          dbp: 74,
          tempC: 37.1,
          spo2: 95,
        },
        medications: [
          {
            status: 'active',
            display: 'Paracetamol 500mg tablet',
            note: 'Administered during morning rounds',
          },
        ],
        oxygenTherapy: {
          status: 'in-progress',
          deviceDisplay: 'Nasal cannula',
          flowLMin: 4,
          fio2: 32,
          note: 'Patient tolerating well',
        },
        audioAttachment: {
          url: 'https://example.org/fhir/handover/audio.m4a',
          contentType: 'audio/m4a',
          title: 'Shift summary',
        },
        composition: { title: 'Clinical handover summary' },
        sbar: {
          situation: 'Post-operative monitoring',
          background: 'Appendectomy performed yesterday',
          assessment: 'Stable vitals, mild pain controlled with medication',
          recommendation: 'Continue oxygen therapy, monitor vitals hourly',
        },
      },
      { now: () => '2025-04-05T10:15:00.000Z' }
    );

    const {
      bundle: parsed,
      observations,
      medicationStatements,
      deviceUseStatements,
      documentReferences,
      compositions,
    } = validateBundle(bundle);

    expect(parsed.resourceType).toBe('Bundle');
    expect(parsed.type).toBe('transaction');

    expect(observations.length).toBeGreaterThan(0);
    expect(medicationStatements).toHaveLength(1);
    expect(deviceUseStatements).toHaveLength(1);
    expect(documentReferences).toHaveLength(1);
    expect(compositions).toHaveLength(1);

    const patientReference = 'Patient/pat-1';
    const encounterReference = 'Encounter/enc-1';
    const [composition] = compositions;
    const [documentReference] = documentReferences;

    for (const observation of observations) {
      expect(observation.subject.reference).toBe(patientReference);
      expect(observation.encounter?.reference).toBe(encounterReference);
    }

    for (const medication of medicationStatements) {
      expect(medication.subject.reference).toBe(patientReference);
      expect(medication.encounter?.reference).toBe(encounterReference);
    }

    for (const device of deviceUseStatements) {
      expect(device.subject.reference).toBe(patientReference);
      expect(device.encounter?.reference).toBe(encounterReference);
    }

    expect(documentReference.subject.reference).toBe(patientReference);
    expect(documentReference.encounter?.reference).toBe(encounterReference);
    expect(documentReference.author?.[0]?.reference).toMatch(/^Practitioner\//);

    expect(composition.subject.reference).toBe(patientReference);
    expect(composition.encounter?.reference).toBe(encounterReference);
    expect(composition.author[0]?.reference).toMatch(/^Practitioner\//);
    expect(composition.section?.length).toBeGreaterThan(0);

    const entries = parsed.entry ?? [];
    const resourcesByFullUrl = new Map(entries.map((entry) => [entry.fullUrl, entry.resource]));

    const collectRefs = (title: string) =>
      (composition.section ?? [])
        .filter((section) => section.title === title)
        .flatMap((section) => section.entry?.map((ref) => ref.reference) ?? []);

    const vitalRefs = collectRefs('Vital signs');
    expect(vitalRefs.length).toBeGreaterThan(0);
    for (const ref of vitalRefs) {
      expect(resourcesByFullUrl.get(ref)?.resourceType).toBe('Observation');
    }

    const medRefs = collectRefs('Medications');
    expect(medRefs).toHaveLength(1);
    expect(resourcesByFullUrl.get(medRefs[0])?.resourceType).toBe('MedicationStatement');

    const oxygenRefs = collectRefs('Oxygen therapy');
    expect(oxygenRefs.length).toBeGreaterThan(0);
    const oxygenTypes = new Set(oxygenRefs.map((ref) => resourcesByFullUrl.get(ref)?.resourceType));
    expect(oxygenTypes.has('Observation')).toBe(true);
    expect(oxygenTypes.has('DeviceUseStatement')).toBe(true);

    const attachmentRefs = collectRefs('Attachments');
    expect(attachmentRefs).toEqual(expect.arrayContaining([expect.stringMatching(/^urn:uuid:/)]));
    for (const ref of attachmentRefs) {
      expect(resourcesByFullUrl.get(ref)?.resourceType).toBe('DocumentReference');
    }
  });
});
