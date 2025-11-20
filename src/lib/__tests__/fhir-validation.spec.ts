import { describe, expect, it } from 'vitest';

import {
  validateBundle,
  validateResourceWithZod,
  type ValidationResult,
} from '../fhir-validation';

describe('validateResource', () => {
  const baseObservation = {
    resourceType: 'Observation' as const,
    status: 'final',
    code: {
      coding: [
        {
          system: 'http://loinc.org',
          code: '1234-5',
          display: 'Mock code',
        },
      ],
    },
    subject: { reference: 'Patient/123' },
    effectiveDateTime: '2023-10-01T10:00:00Z',
    valueQuantity: { value: 42, unit: 'mmHg' },
  };

  const baseDeviceUseStatement = {
    resourceType: 'DeviceUseStatement' as const,
    status: 'active',
    subject: { reference: 'Patient/123' },
    device: { reference: 'Device/456', display: 'Infusion Pump' },
    timingPeriod: {
      start: '2023-09-10T00:00:00Z',
      end: '2023-09-11T00:00:00Z',
    },
  };

  const baseComposition = {
    resourceType: 'Composition' as const,
    status: 'final',
    type: {
      text: 'Visit summary',
      coding: [
        {
          system: 'http://loinc.org',
          code: '34713-8',
          display: 'Summary',
        },
      ],
    },
    subject: { reference: 'Patient/123' },
    date: '2023-10-01T00:00:00Z',
    author: [{ reference: 'Practitioner/789' }],
    title: 'Mock Visit',
  };

  it('returns isValid=true for a valid Observation resource', () => {
    const result: ValidationResult = validateResourceWithZod(baseObservation);

    expect(result).toEqual({ isValid: true, errors: [] });
  });

  it('surfaces readable errors for an Observation missing required values', () => {
    const invalid = { ...baseObservation, valueQuantity: undefined };

    const result = validateResourceWithZod(invalid);

    expect(result.isValid).toBe(false);
    expect(result.errors[0]).toMatchObject({
      path: 'valueQuantity',
      message: expect.stringContaining('requires a value'),
    });
  });

  it('provides detailed path/message for DeviceUseStatement schema issues', () => {
    const invalid = {
      ...baseDeviceUseStatement,
      device: { display: 'Missing reference' },
    };

    const result = validateResourceWithZod(invalid);

    expect(result.isValid).toBe(false);
    expect(result.errors[0]).toMatchObject({
      path: 'device.reference',
      message: expect.stringContaining('Required'),
    });
  });

  it('provides detailed path/message for Composition schema issues', () => {
    const invalid = { ...baseComposition };
    delete (invalid as { subject?: unknown }).subject;

    const result = validateResourceWithZod(invalid);

    expect(result.isValid).toBe(false);
    expect(result.errors[0]).toMatchObject({
      path: 'subject',
      message: expect.stringContaining('Required'),
    });
  });

  it('prioritizes bundled _validationErrors when present', () => {
    const withErrors = {
      ...baseDeviceUseStatement,
      _validationErrors: [
        { path: 'device.reference', message: 'Conflicting reference detected' },
      ],
    } as const;

    const result = validateResourceWithZod(withErrors);

    expect(result.isValid).toBe(false);
    expect(result.errors).toEqual([
      { path: 'device.reference', message: 'Conflicting reference detected' },
    ]);
  });
});

describe('validateBundle', () => {
  const validObservation = {
    resourceType: 'Observation' as const,
    status: 'final',
    code: {
      coding: [
        {
          system: 'http://loinc.org',
          code: '1234-5',
          display: 'Mock code',
        },
      ],
    },
    subject: { reference: 'Patient/123' },
    effectiveDateTime: '2023-10-01T10:00:00Z',
    valueQuantity: { value: 42, unit: 'mmHg' },
  };

  const validDeviceUseStatement = {
    resourceType: 'DeviceUseStatement' as const,
    status: 'active',
    subject: { reference: 'Patient/123' },
    device: { reference: 'Device/456' },
    timingPeriod: {
      start: '2023-09-10T00:00:00Z',
      end: '2023-09-11T00:00:00Z',
    },
  };

  const validComposition = {
    resourceType: 'Composition' as const,
    status: 'final',
    type: {
      coding: [
        {
          system: 'http://loinc.org',
          code: '34713-8',
          display: 'Summary',
        },
      ],
      text: 'Visit summary',
    },
    subject: { reference: 'Patient/123' },
    date: '2023-10-01T00:00:00Z',
    author: [{ reference: 'Practitioner/789' }],
    title: 'Mock Visit',
  };

  it('passes validation for a bundle containing only valid resources', () => {
    const bundle = {
      resourceType: 'Bundle' as const,
      type: 'transaction' as const,
      entry: [
        { fullUrl: 'urn:uuid:1', resource: validObservation },
        { fullUrl: 'urn:uuid:2', resource: validDeviceUseStatement },
        { fullUrl: 'urn:uuid:3', resource: validComposition },
      ],
    };

    const result = validateBundle(bundle);

    expect(result).toEqual({ isValid: true, errors: [] });
  });

  it('reports entry-scoped errors when nested resources are invalid', () => {
    const invalidObservation = { ...validObservation };
    delete (invalidObservation as { valueQuantity?: unknown }).valueQuantity;

    const invalidComposition = { ...validComposition };
    delete (invalidComposition as { author?: unknown }).author;

    const bundle = {
      resourceType: 'Bundle' as const,
      type: 'transaction' as const,
      entry: [
        { fullUrl: 'urn:uuid:1', resource: invalidObservation },
        { fullUrl: 'urn:uuid:2', resource: validDeviceUseStatement },
        { fullUrl: 'urn:uuid:3', resource: invalidComposition },
      ],
    };

    const result = validateBundle(bundle);

    expect(result.isValid).toBe(false);
    expect(result.errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: 'entry[0].valueQuantity',
          message: expect.stringContaining('requires a value'),
        }),
        expect.objectContaining({
          path: 'entry[2].author',
          message: expect.stringContaining('Required'),
        }),
      ])
    );
  });
});
