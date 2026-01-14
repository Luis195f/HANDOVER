import { describe, expect, it } from 'vitest';

import {
  buildIssuesText,
  formatIssueLine,
  parseErrorIssuesJson,
  resolveErrorCopy,
} from '@/src/screens/SyncCenter.helpers';

describe('SyncCenter helpers', () => {
  it('parses issues JSON defensively', () => {
    expect(parseErrorIssuesJson(undefined)).toEqual([]);
    expect(parseErrorIssuesJson('not-json')).toEqual([]);
    expect(parseErrorIssuesJson('{"issue":[]}')).toEqual([]);
    const parsed = parseErrorIssuesJson('[{"diagnostics":"oops","expression":["Bundle.entry[0]"]}]');
    expect(parsed).toHaveLength(1);
    expect(parsed[0]?.diagnostics).toBe('oops');
  });

  it('formats issue lines with expression and diagnostics', () => {
    const line = formatIssueLine({ diagnostics: 'bad', expression: ['Bundle.entry'] });
    expect(line).toBe('Bundle.entry: bad');
    expect(formatIssueLine({ code: 'invalid' })).toBe('invalid');
  });

  it('builds bullet list for alerts', () => {
    const issuesText = buildIssuesText([
      { diagnostics: 'bad', expression: ['Bundle.entry'] },
      { diagnostics: 'duplicated' },
    ]);
    expect(issuesText).toContain('• Bundle.entry: bad');
    expect(issuesText).toContain('• duplicated');
  });

  it('resolves error copy depending on status', () => {
    expect(resolveErrorCopy(422)).toMatchObject({
      title: 'Datos inválidos',
      subtitle: 'Datos inválidos',
    });
    expect(resolveErrorCopy(500).title).toBe('Error de sincronización');
  });
});
