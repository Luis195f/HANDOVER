import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { getValidationErrorsFromBundle, validateBundle } from '@/src/lib/fhir-validation';

type BundleEntry = {
  fullUrl?: string;
  resource?: {
    resourceType?: string;
    subject?: { reference?: string };
    encounter?: { reference?: string };
    context?: { reference?: string };
    author?: Array<{ reference?: string }>;
    device?: { reference?: string };
    code?: { coding?: Array<{ code?: string }> };
    section?: Array<{ title?: string; entry?: Array<{ reference?: string }> }>;
  };
};

const loadFixture = () =>
  JSON.parse(
    readFileSync(resolve(process.cwd(), 'tests/fixtures/fhir/representative-transaction-bundle.json'), 'utf8'),
  ) as { entry?: BundleEntry[] };

describe('Representative FHIR transaction bundle fixture', () => {
  it('covers diagnosis, medication, treatment, device, attachment, and scale resources with valid references', () => {
    const bundle = loadFixture();
    const validation = validateBundle(bundle);
    const embeddedErrors = getValidationErrorsFromBundle(bundle) ?? [];

    expect(validation.isValid).toBe(true);
    expect(validation.errors).toEqual([]);
    expect(embeddedErrors).toEqual([]);

    const entries = bundle.entry ?? [];
    const fullUrls = new Set(entries.map((entry) => entry.fullUrl).filter(Boolean));
    const counts = entries.reduce<Record<string, number>>((acc, entry) => {
      const resourceType = entry.resource?.resourceType;
      if (!resourceType) return acc;
      acc[resourceType] = (acc[resourceType] ?? 0) + 1;
      return acc;
    }, {});

    expect(counts.Condition).toBe(1);
    expect(counts.MedicationStatement).toBe(1);
    expect(counts.Procedure).toBe(1);
    expect(counts.Device).toBe(1);
    expect(counts.DeviceUseStatement).toBe(1);
    expect(counts.DocumentReference).toBe(1);
    expect(counts.Observation).toBe(3);

    const composition = entries.find((entry) => entry.resource?.resourceType === 'Composition')?.resource;
    const sectionTitles = (composition?.section ?? []).map((section) => section.title);
    expect(sectionTitles).toEqual(
      expect.arrayContaining(['Diagnoses', 'Medications', 'Treatments', 'Devices', 'Attachments', 'Scales']),
    );

    for (const section of composition?.section ?? []) {
      for (const ref of section.entry ?? []) {
        expect(fullUrls.has(ref.reference)).toBe(true);
      }
    }

    const scaleCodes = entries
      .filter((entry) => entry.resource?.resourceType === 'Observation')
      .flatMap((entry) => entry.resource?.code?.coding ?? [])
      .map((coding) => coding.code);

    expect(scaleCodes).toEqual(expect.arrayContaining(['38208-5', '38876-5', '9267-6']));
  });

  it('keeps patient, encounter, practitioner and section linkages internally coherent', () => {
    const bundle = loadFixture();
    const entries = bundle.entry ?? [];
    const byFullUrl = new Map(entries.map((entry) => [entry.fullUrl, entry.resource] as const));

    const patientEntry = entries.find((entry) => entry.resource?.resourceType === 'Patient');
    const practitionerEntry = entries.find((entry) => entry.resource?.resourceType === 'Practitioner');
    const encounterEntry = entries.find((entry) => entry.resource?.resourceType === 'Encounter');
    const compositionEntry = entries.find((entry) => entry.resource?.resourceType === 'Composition');

    expect(patientEntry?.fullUrl).toBeTruthy();
    expect(practitionerEntry?.fullUrl).toBeTruthy();
    expect(encounterEntry?.fullUrl).toBeTruthy();
    expect(compositionEntry?.fullUrl).toBeTruthy();

    const patientRef = patientEntry!.fullUrl!;
    const encounterRef = encounterEntry!.fullUrl!;
    const practitionerRef = practitionerEntry!.fullUrl!;
    const composition = compositionEntry!.resource!;

    expect(composition.subject?.reference).toBe(patientRef);
    expect(composition.encounter?.reference).toBe(encounterRef);
    expect(composition.author?.[0]?.reference).toBe(practitionerRef);

    entries
      .filter((entry) => !['Patient', 'Practitioner', 'Encounter', 'Composition', 'Device'].includes(entry.resource?.resourceType ?? ''))
      .forEach((entry) => {
        const resource = entry.resource!;
        if (resource.subject?.reference) {
          expect(resource.subject.reference).toBe(patientRef);
        }

        const encounterReference = resource.encounter?.reference ?? resource.context?.reference;
        if (encounterReference) {
          expect(encounterReference).toBe(encounterRef);
        }
      });

    const deviceUse = entries.find((entry) => entry.resource?.resourceType === 'DeviceUseStatement')?.resource;
    expect(deviceUse?.device?.reference).toBe('urn:uuid:88888888888888888888888888888888');
    expect(byFullUrl.has(deviceUse?.device?.reference)).toBe(true);

    const documentReference = entries.find((entry) => entry.resource?.resourceType === 'DocumentReference')?.resource;
    expect(documentReference?.author?.[0]?.reference).toBe(practitionerRef);
  });
});
