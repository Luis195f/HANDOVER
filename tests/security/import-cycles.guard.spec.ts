import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('security import cycle guards', () => {
  it('api.ts does not import auth.tsx directly', () => {
    const apiSource = readFileSync(resolve(process.cwd(), 'src/lib/api.ts'), 'utf8');
    expect(apiSource).not.toMatch(/from\s+["']@\/src\/security\/auth["']/);
  });

  it('auth.tsx does not import capabilities.ts statically', () => {
    const authSource = readFileSync(resolve(process.cwd(), 'src/security/auth.tsx'), 'utf8');
    expect(authSource).not.toMatch(/from\s+["']@\/src\/security\/capabilities["']/);
    expect(authSource).toMatch(/import\(['"]@\/src\/security\/capabilities['"]\)/);
  });
});
