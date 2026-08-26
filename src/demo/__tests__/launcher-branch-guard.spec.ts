import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const launcher = readFileSync(
  new URL('../../../demo/Start-HandoverDemo.ps1', import.meta.url),
  'utf8',
);

describe('Start-HandoverDemo branch guard', () => {
  it('allows the current psychiatry branch exactly once and preserves the closed allowlist', () => {
    const branch = 'fix/p0-psychiatry-exception-handover';
    expect(launcher.match(new RegExp(branch.replaceAll('/', '\\/'), 'g'))).toHaveLength(1);
    expect(launcher).toContain('$branch -notin $script:AllowedBranches');
    expect(launcher).toContain('throw "Wrong branch.');
    expect(launcher).not.toMatch(/AllowedBranches[\s\S]{0,300}['"]\*['"]/);
  });
});
