import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest';

import {
  clearValidationCache,
  isLocalLoincCode,
  isLocalSnomedCode,
  validateSnomed,
  validateTerminologyCode,
} from '../terminology-validation';
import { TERMINOLOGY_SYSTEMS } from '../codes';
import * as fhirClient from '../fhir-client';

const originalMode = process.env.HANDOVER_FHIR_VALIDATION_MODE;
const originalExpoMode = process.env.EXPO_PUBLIC_HANDOVER_FHIR_VALIDATION_MODE;

describe('terminology-validation', () => {
  beforeEach(() => {
    clearValidationCache();
    vi.restoreAllMocks();
    delete process.env.HANDOVER_FHIR_VALIDATION_MODE;
    delete process.env.EXPO_PUBLIC_HANDOVER_FHIR_VALIDATION_MODE;
  });

  afterAll(() => {
    process.env.HANDOVER_FHIR_VALIDATION_MODE = originalMode;
    process.env.EXPO_PUBLIC_HANDOVER_FHIR_VALIDATION_MODE = originalExpoMode;
  });

  it('detects SNOMED and LOINC codes from local catalogs', async () => {
    expect(isLocalSnomedCode('44054006')).toBe(true);
    expect(isLocalLoincCode('85354-9')).toBe(true);

    const fetchSpy = vi.spyOn(fhirClient, 'fetchFHIR');
    const result = await validateTerminologyCode({
      system: TERMINOLOGY_SYSTEMS.SNOMED,
      code: '44054006',
    });

    expect(result.valid).toBe(true);
    expect(result.source).toBe('local');
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('calls remote validation when code is unknown locally and mode is remote', async () => {
    process.env.HANDOVER_FHIR_VALIDATION_MODE = 'remote';
    const fetchSpy = vi.spyOn(fhirClient, 'fetchFHIR').mockResolvedValue({
      ok: true,
      response: {} as Response,
      data: { result: true },
    });

    const result = await validateSnomed('9999999');

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(fetchSpy.mock.calls[0][0]).toMatchObject({ path: expect.stringContaining('code=9999999') });
    expect(result.valid).toBe(true);
    expect(result.source).toBe('remote');
  });

  it('surfaces remote validation errors and caches the result', async () => {
    process.env.HANDOVER_FHIR_VALIDATION_MODE = 'remote';
    const fetchSpy = vi.spyOn(fhirClient, 'fetchFHIR').mockResolvedValue({
      ok: true,
      response: {} as Response,
      data: { result: false, message: 'invalid-code' },
    });

    const first = await validateTerminologyCode({
      system: TERMINOLOGY_SYSTEMS.SNOMED,
      code: '12345',
    });
    const second = await validateTerminologyCode({
      system: TERMINOLOGY_SYSTEMS.SNOMED,
      code: '12345',
    });

    expect(first.valid).toBe(false);
    expect(first.message).toContain('invalid-code');
    expect(second.source).toBe('cache');
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('fails fast when mode is off and code is unknown locally', async () => {
    const fetchSpy = vi.spyOn(fhirClient, 'fetchFHIR');
    const result = await validateTerminologyCode({
      system: TERMINOLOGY_SYSTEMS.LOINC,
      code: '9999-9',
    });

    expect(result.valid).toBe(false);
    expect(result.message).toContain('LOINC');
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
