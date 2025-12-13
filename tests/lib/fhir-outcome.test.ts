import { describe, expect, test } from 'vitest';
import { formatIssuesForUser, getIssueText } from '@/src/lib/fhir-outcome';

describe('fhir-outcome helpers', () => {
  test('getIssueText prioritizes diagnostics then details then code', () => {
    expect(getIssueText({ diagnostics: 'diag', details: { text: 'detail' }, code: 'code' })).toBe('diag');
    expect(getIssueText({ details: { text: 'detail' }, code: 'code' })).toBe('detail');
    expect(getIssueText({ code: 'code' })).toBe('code');
    expect(getIssueText({})).toBe('Error de validación');
  });

  test('formatIssuesForUser dedupes, prefixes expression and caps the list', () => {
    const issues = [
      { diagnostics: 'One', expression: ['Patient.name'] },
      { diagnostics: 'One', expression: ['Patient.name'] },
      { details: { text: 'Two' }, expression: ['Observation.value'] },
      { diagnostics: 'Three' },
      { diagnostics: 'Four' },
    ];

    const formatted = formatIssuesForUser(issues, { max: 3 });
    expect(formatted.title).toBe('Error de validación');
    expect(formatted.message).toContain('Patient.name: One');
    expect(formatted.message).toContain('Observation.value: Two');
    expect(formatted.message).toContain('…y 2 más');
  });

  test('formatIssuesForUser returns default message when empty', () => {
    const formatted = formatIssuesForUser();
    expect(formatted.message).toContain('rechazó el Bundle');
  });
});
