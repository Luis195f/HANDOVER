import { describe, expect, it } from 'vitest';

import { buildHandoverBundle } from '@/src/lib/fhir-map';
import { validateBundle } from '@/src/lib/fhir/validators';

describe('FHIR bundle validation', () => {
  const NOW = '2025-04-05T10:15:00.000Z';
  const values = {
    patientId: 'patient-12345',
    encounterId: 'enc-67890',
    author: { id: 'nurse-007', display: 'Nurse Example' },
    vitals: {
      recordedAt: '2025-04-05T09:45:00.000Z',
      issuedAt: '2025-04-05T09:47:00.000Z',
      hr: 82,
      rr: 18,
      sbp: 118,
      dbp: 74,
      tempC: 37.1,
      spo2: 95,
      glucoseMgDl: 110,
    },
    medications: [
      {
        status: 'active',
        code: {
          system: 'http://www.nlm.nih.gov/research/umls/rxnorm',
          code: '161',
          display: 'Paracetamol 500mg tablet',
        },
        start: '2025-04-05T08:00:00.000Z',
        note: 'Administered during morning rounds',
      },
    ],
    oxygenTherapy: {
      status: 'in-progress',
      start: '2025-04-05T09:00:00.000Z',
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
    composition: {
      status: 'final',
      title: 'Clinical handover summary',
    },
    sbar: {
      situation: 'Post-operative monitoring',
      background: 'Appendectomy performed yesterday',
      assessment: 'Stable vitals, mild pain controlled with medication',
      recommendation: 'Continue oxygen therapy, monitor vitals hourly',
    },
  } as const;

  it('generates a structurally valid FHIR transaction bundle with coherent references', () => {
    const bundle = buildHandoverBundle(values, { now: () => NOW });
    const {
      bundle: parsedBundle,
      observations,
      medicationStatements,
      deviceUseStatements,
      documentReferences,
      compositions,
    } = validateBundle(bundle);

    expect(parsedBundle.resourceType).toBe('Bundle');
    expect(parsedBundle.type).toBe('transaction');

    expect(observations.length).toBeGreaterThan(0);
    expect(medicationStatements.length).toBe(1);
    expect(deviceUseStatements.length).toBe(1);
    expect(documentReferences.length).toBe(1);
    expect(compositions.length).toBe(1);

    const [composition] = compositions;
    const [documentReference] = documentReferences;

    const entries = parsedBundle.entry ?? [];
    const resourcesByFullUrl = new Map<string, any>();
    for (const entry of entries) {
      if (entry.fullUrl && entry.resource) {
        resourcesByFullUrl.set(entry.fullUrl, entry.resource);
      }
    }

    const patientReference = `Patient/${values.patientId}`;
    const encounterReference = `Encounter/${values.encounterId}`;

    for (const observation of observations) {
      expect(observation.subject.reference).toBe(patientReference);
      expect(observation.encounter?.reference).toBe(encounterReference);
    }

    for (const medication of medicationStatements) {
      expect(medication.subject.reference).toBe(patientReference);
      expect(medication.encounter?.reference).toBe(encounterReference);
    }

    for (const deviceUse of deviceUseStatements) {
      expect(deviceUse.subject.reference).toBe(patientReference);
      expect(deviceUse.encounter?.reference).toBe(encounterReference);
    }

    expect(documentReference.subject.reference).toBe(patientReference);
    expect(documentReference.encounter?.reference).toBe(encounterReference);

    expect(composition.subject.reference).toBe(patientReference);
    expect(composition.encounter?.reference).toBe(encounterReference);

    const collectSectionRefs = (title: string) =>
      (composition.section ?? [])
        .filter((section) => section.title === title)
        .flatMap((section) => section.entry?.map((ref) => ref.reference) ?? []);

    const vitalsRefs = collectSectionRefs('Vital signs');
    expect(vitalsRefs.length).toBeGreaterThan(0);
    for (const ref of vitalsRefs) {
      const resource = resourcesByFullUrl.get(ref);
      expect(resource?.resourceType).toBe('Observation');
    }

    const medicationsRefs = collectSectionRefs('Medications');
    expect(medicationsRefs).toHaveLength(1);
    expect(resourcesByFullUrl.get(medicationsRefs[0])?.resourceType).toBe('MedicationStatement');

    const oxygenRefs = collectSectionRefs('Oxygen therapy');
    expect(oxygenRefs.length).toBeGreaterThan(0);
    const oxygenTypes = oxygenRefs.map((ref) => resourcesByFullUrl.get(ref)?.resourceType);
    expect(oxygenTypes).toContain('DeviceUseStatement');
    expect(oxygenTypes).toContain('Observation');

    const attachmentRefs = collectSectionRefs('Attachments');
    expect(attachmentRefs).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/^urn:uuid:/),
      ]),
    );
    for (const ref of attachmentRefs) {
      expect(resourcesByFullUrl.get(ref)?.resourceType).toBe('DocumentReference');
    }

    const allCompositionRefs = new Set(
      (composition.section ?? []).flatMap((section) => section.entry?.map((ref) => ref.reference) ?? []),
    );
    for (const ref of allCompositionRefs) {
      expect(resourcesByFullUrl.has(ref)).toBe(true);
    }
  });
});
