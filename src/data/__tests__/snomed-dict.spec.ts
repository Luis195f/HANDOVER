import { describe, expect, it } from 'vitest';
import { normalizeLegacySnomedCoding, resolveSnomedCoding, snomedTerms, SNOMED_SYSTEM } from '../snomed-dict';

describe('snomed-dict', () => {
  it('resolves a SNOMED display to coding', () => {
    const term = snomedTerms[0];
    const resolved = resolveSnomedCoding(term.display);
    expect(resolved?.system).toBe(SNOMED_SYSTEM);
    expect(resolved?.code).toBe(term.code);
    expect(typeof resolved?.display).toBe('string');
  });

  it('normalizes legacy coding objects', () => {
    const normalized = normalizeLegacySnomedCoding({
      system: SNOMED_SYSTEM,
      code: '123',
      display: 'Fiebre',
    });
    expect(normalized).toEqual({ system: SNOMED_SYSTEM, code: '123', display: 'Fiebre' });
  });
});
