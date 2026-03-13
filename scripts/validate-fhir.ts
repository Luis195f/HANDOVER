#!/usr/bin/env node
import { readFile, readdir } from 'node:fs/promises';
import { resolve, extname, join } from 'node:path';
import process, { stdin as input } from 'node:process';

import {
  getValidationErrorsFromBundle,
  validateBundle,
  type ValidationResult,
} from '../src/lib/fhir-validation';

// Nota: este script se ejecuta en CI vía "pnpm validate:fhir" para validar bundles locales.

async function readFromStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  return new Promise((resolveStdin, reject) => {
    input.resume();
    input.on('data', (chunk) => {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    });
    input.on('error', (error) => reject(error));
    input.on('end', () => {
      resolveStdin(Buffer.concat(chunks).toString('utf8'));
    });
  });
}

async function readJson(source: string): Promise<unknown> {
  if (source === '-' || source === '/dev/stdin') {
    const raw = await readFromStdin();
    const trimmed = raw.trim();
    if (!trimmed) throw new Error('stdin was empty (no JSON provided)');
    return JSON.parse(trimmed);
  }

  const filePath = resolve(source);
  const raw = await readFile(filePath, 'utf8');
  return JSON.parse(raw);
}

function printSuccess(
  label: string,
  summary: {
    entries: number;
    observations: number;
    medications: number;
    deviceUses: number;
    documents: number;
    compositions: number;
  },
) {
  const stats = [
    `${summary.entries} entries`,
    `${summary.observations} observations`,
    `${summary.medications} medication statements`,
    `${summary.deviceUses} device use statements`,
    `${summary.documents} document references`,
    `${summary.compositions} compositions`,
  ].join(', ');
  console.log(`✔ ${label}: ${stats}`);
}

function isValidationResult(error: unknown): error is ValidationResult {
  return (
    !!error &&
    typeof error === 'object' &&
    typeof (error as ValidationResult).isValid === 'boolean' &&
    Array.isArray((error as ValidationResult).errors)
  );
}

function printFailure(label: string, error: unknown) {
  console.error(`✖ ${label}`);
  if (isValidationResult(error)) {
    for (const issue of error.errors) {
      console.error(`  • [${issue.path}] ${issue.message}`);
    }
  } else if (error instanceof Error) {
    console.error(`  • ${error.message}`);
  } else {
    console.error('  • Unknown error');
  }
}

function validateBundleWithEmbeddedErrors(bundle: unknown): ValidationResult {
  const result = validateBundle(bundle);
  const bundledErrors = getValidationErrorsFromBundle(bundle) ?? [];
  if (result.isValid && bundledErrors.length === 0) {
    return result;
  }

  return {
    isValid: false,
    errors: [...result.errors, ...bundledErrors],
  };
}

async function findFixtureBundles(): Promise<string[]> {
  const candidates = [
    resolve('tests/fixtures/fhir'),
    resolve('test/fixtures/fhir'),
    resolve('scripts/fixtures/fhir'),
    resolve('fixtures/fhir'),
  ];

  const found: string[] = [];

  for (const dir of candidates) {
    try {
      const entries = await readdir(dir, { withFileTypes: true });

      for (const ent of entries) {
        if (ent.isFile() && extname(ent.name).toLowerCase() === '.json') {
          found.push(join(dir, ent.name));
        }
      }

      for (const ent of entries) {
        if (ent.isDirectory()) {
          const subdir = join(dir, ent.name);
          const subentries = await readdir(subdir, { withFileTypes: true });
          for (const s of subentries) {
            if (s.isFile() && extname(s.name).toLowerCase() === '.json') {
              found.push(join(subdir, s.name));
            }
          }
        }
      }
    } catch {
      // ignore missing directories
    }
  }

  return Array.from(new Set(found)).sort((a, b) => a.localeCompare(b));
}

async function validateSource(source: string) {
  const label = source === '-' ? 'stdin' : resolve(source);
  const data = await readJson(source);
  const result = validateBundleWithEmbeddedErrors(data);

  if (!result.isValid) {
    throw result;
  }

  const bundle = data as { entry?: Array<{ resource?: { resourceType?: string } }> };
  const counts = (bundle.entry ?? []).reduce(
    (acc, entry) => {
      const rt = entry?.resource?.resourceType;
      if (rt === 'Observation') acc.observations += 1;
      if (rt === 'MedicationStatement') acc.medications += 1;
      if (rt === 'DeviceUseStatement' || rt === 'Procedure') acc.deviceUses += 1;
      if (rt === 'DocumentReference') acc.documents += 1;
      if (rt === 'Composition') acc.compositions += 1;
      acc.entries += 1;
      return acc;
    },
    { entries: 0, observations: 0, medications: 0, deviceUses: 0, documents: 0, compositions: 0 },
  );

  printSuccess(label, counts);
}

async function main() {
  const [, , ...argv] = process.argv;
  const args = [...argv];
  const isCi = String(process.env.CI ?? '').toLowerCase() === 'true';

  if (args.length > 0) {
    let hasErrors = false;
    for (const source of args) {
      try {
        await validateSource(source);
      } catch (error) {
        hasErrors = true;
        printFailure(source === '-' ? 'stdin' : resolve(source), error);
      }
    }
    if (hasErrors) process.exitCode = 1;
    return;
  }

  const fixtures = await findFixtureBundles();
  if (fixtures.length > 0) {
    let hasErrors = false;
    for (const fixture of fixtures) {
      try {
        await validateSource(fixture);
      } catch (error) {
        hasErrors = true;
        printFailure(resolve(fixture), error);
      }
    }
    if (hasErrors) process.exitCode = 1;
    return;
  }

  if (!process.stdin.isTTY) {
    const raw = await readFromStdin();
    const trimmed = raw.trim();
    if (trimmed) {
      try {
        const data = JSON.parse(trimmed);
        const result = validateBundleWithEmbeddedErrors(data);
        if (!result.isValid) {
          throw result;
        }

        const bundle = data as { entry?: Array<{ resource?: { resourceType?: string } }> };
        const counts = (bundle.entry ?? []).reduce(
          (acc, entry) => {
            const rt = entry?.resource?.resourceType;
            if (rt === 'Observation') acc.observations += 1;
            if (rt === 'MedicationStatement') acc.medications += 1;
            if (rt === 'DeviceUseStatement' || rt === 'Procedure') acc.deviceUses += 1;
            if (rt === 'DocumentReference') acc.documents += 1;
            if (rt === 'Composition') acc.compositions += 1;
            acc.entries += 1;
            return acc;
          },
          { entries: 0, observations: 0, medications: 0, deviceUses: 0, documents: 0, compositions: 0 },
        );
        printSuccess('stdin', counts);
        return;
      } catch (error) {
        printFailure('stdin', error);
        process.exitCode = 1;
        return;
      }
    }
  }

  if (isCi) {
    console.error('FHIR validation in CI requires evidence to validate.');
    console.error('No inputs found: no CLI args, no fixtures under tests/fixtures/fhir, and empty stdin.');
    console.error('Add at least one fixture JSON bundle or pass a bundle path to pnpm validate:fhir.');
    process.exitCode = 1;
    return;
  }

  console.error('Usage: pnpm validate:fhir <bundle.json> [more.json | -]');
  console.error('Tip: pass a bundle path or pipe JSON via stdin, e.g. `cat bundle.json | pnpm -w validate:fhir -`');
  console.error('Tip: or add fixtures under tests/fixtures/fhir/*.json for CI.');
  process.exitCode = 1;
}

main().catch((error) => {
  console.error('Unexpected error while validating FHIR bundle');
  printFailure('runtime', error);
  process.exit(1);
});
