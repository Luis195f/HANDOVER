import { spawnSync } from 'node:child_process';
import path from 'node:path';

import config from '../vitest.pilot.config';

const requiredSuites = [
  'src/lib/__tests__/queue.test.ts',
  'src/validation/__tests__/BradenScale.schema.test.ts',
  'src/validation/__tests__/HandoverForm.schema.test.ts',
  'src/validation/__tests__/Medication.schema.test.ts',
  'src/validation/__tests__/PainAssessment.schema.test.ts',
  'tests/fhir-client.spec.ts',
  'tests/queue/offline-single-source-of-truth.spec.ts',
  'tests/queue/sqlite-product-path.spec.ts',
  'tests/queue/canonical-http-transaction.spec.ts',
  'tests/validation/handover.schemas.spec.ts',
];

const declaredPaths = config.test?.include;
if (!Array.isArray(declaredPaths) || declaredPaths.some((entry) => typeof entry !== 'string')) {
  throw new Error('Pilot suite declaration is not an explicit path list');
}

const normalize = (entry: string) => path.resolve(entry).replaceAll('\\', '/').toLowerCase();
const declared = new Set(declaredPaths.map(normalize));
const required = requiredSuites.map(normalize);
const missingRequired = required.filter((entry) => !declared.has(entry));
if (missingRequired.length > 0) {
  throw new Error(`Required pilot suites are not declared: ${missingRequired.join(', ')}`);
}
if (declared.size !== declaredPaths.length) {
  throw new Error('Pilot suite declaration contains duplicates');
}

const result = spawnSync(
  process.execPath,
  [path.resolve('node_modules/vitest/vitest.mjs'), 'list', '--config', 'vitest.pilot.config.ts', '--json', '--no-color'],
  { cwd: path.resolve('.'), encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 },
);
if (result.error || result.status !== 0) {
  throw new Error(`Vitest collection failed (${result.status}): ${result.error?.message ?? result.stderr}`);
}

const parsed: unknown = JSON.parse(result.stdout);
const isFileRecord = (entry: unknown): entry is { file: string } =>
  typeof entry === 'object' && entry !== null && 'file' in entry && typeof entry.file === 'string';
if (!Array.isArray(parsed) || parsed.some((entry) => !isFileRecord(entry))) {
  throw new Error('Vitest did not return file records');
}
const collected = new Set(parsed.map((entry: { file: string }) => normalize(entry.file)));
const uncollected = [...declared].filter((entry) => !collected.has(entry));
const undeclared = [...collected].filter((entry) => !declared.has(entry));
if (uncollected.length > 0 || undeclared.length > 0) {
  throw new Error(`Pilot collection mismatch: uncollected=${uncollected.join(', ')}; undeclared=${undeclared.join(', ')}`);
}
console.log(`Pilot collection: ${declared.size} declared / ${collected.size} collected, all required suites present`);
