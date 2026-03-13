import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import {
  validateBundle,
  validateBundleWithAjv,
  validateResourceWithAjv,
  type ValidationResult,
} from './index';

function loadFixture(name: string): Record<string, unknown> {
  return JSON.parse(
    readFileSync(new URL(`../../../tests/fixtures/fhir-bundles/${name}`, import.meta.url), 'utf8'),
  ) as Record<string, unknown>;
}

describe('FHIR validation contract', () => {
  it('returns a uniform success result for a valid bundle fixture', () => {
    const result: ValidationResult = validateBundle(loadFixture('valid-bundle.json'));

    expect(result).toEqual({ isValid: true, errors: [] });
  });

  it('returns structured bundle errors for an invalid bundle fixture with Zod', () => {
    const result = validateBundle(loadFixture('invalid-bundle.json'));

    expect(result.isValid).toBe(false);
    expect(result.errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: 'resourceType' }),
      ]),
    );
  });

  it('returns structured bundle errors for an invalid bundle fixture with AJV', () => {
    const result = validateBundleWithAjv(loadFixture('invalid-bundle.json'));

    expect(result.isValid).toBe(false);
    expect(result.errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: 'resourceType' }),
      ]),
    );
  });

  it('returns structured resource errors for AJV resource validation', () => {
    const result = validateResourceWithAjv(
      {
        resourceType: 'Observation',
        code: {},
      },
      'Observation',
    );

    expect(result.isValid).toBe(false);
    expect(result.errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: 'status' }),
      ]),
    );
  });
});
