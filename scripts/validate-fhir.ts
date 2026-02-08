#!/usr/bin/env node
import { readFile, readdir } from 'node:fs/promises';
import { stdin as input } from 'node:process';
import { resolve, extname, join } from 'node:path';
import process from 'node:process';

import { ZodError } from 'zod';

import { getValidationErrorsFromBundle, validateBundle } from '../src/lib/fhir-validation';

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
    return JSON.parse(raw);
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

function printFailure(label: string, error: unknown) {
  console.error(`✖ ${label}`);
  if (error instanceof ZodError) {
    for (const issue of error.issues) {
      const path = issue.path.join('.') || '<root>';
      console.error(`  • [${path}] ${issue.message}`);
    }
  } else if (error instanceof Error) {
    console.error(`  • ${error.message}`);
  } else {
    console.error('  • Unknown error');
  }
}

/**
 * Busca fixtures FHIR en rutas típicas del repo.
 * No falla si no existen; simplemente devuelve [].
 */
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
      // también soporta 1 nivel de subcarpetas (común en fixtures)
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
      // dir no existe: ignore
    }
  }

  // Dedup + orden estable
  return Array.from(new Set(found)).sort((a, b) => a.localeCompare(b));
}

async function validateSource(source: string) {
  const label = source === '-' ? 'stdin' : resolve(source);

  const data = await readJson(source);
  const result = validateBundle(data);

  if (!result.isValid) {
    const issues = [...result.errors, ...(getValidationErrorsFromBundle(data) ?? [])];
    throw new ZodError(
      issues.map((issue) => ({
        code: 'custom',
        path: [issue.path],
        message: issue.message,
      })),
    );
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

  printSuccess(label, { ...counts });
}

async function main() {
  const [, , ...args] = process.argv;

  // ✅ Modo “smart”: si no pasan args y hay stdin con datos, valida stdin.
  if (args.length === 0 && !process.stdin.isTTY) {
    try {
      await validateSource('-');
      return;
    } catch (error) {
      printFailure('stdin', error);
      process.exitCode = 1;
      return;
    }
  }

  // ✅ Modo CI-friendly: si no pasan args, busca fixtures típicos y los valida.
  if (args.length === 0) {
    const fixtures = await findFixtureBundles();
    if (fixtures.length === 0) {
      console.error('Usage: pnpm validate:fhir <bundle.json> [more.json | -]');
      console.error('Tip: pass a bundle path or pipe JSON via stdin, e.g. `cat bundle.json | pnpm -w validate:fhir -`');
      process.exitCode = 1;
      return;
    }
    // Usa fixtures como argumentos implícitos
    args.push(...fixtures);
  }

  let hasErrors = false;

  for (const source of args) {
    try {
      await validateSource(source);
    } catch (error) {
      hasErrors = true;
      const label = source === '-' ? 'stdin' : resolve(source);
      printFailure(label, error);
    }
  }

  if (hasErrors) process.exitCode = 1;
}

main().catch((error) => {
  console.error('Unexpected error while validating FHIR bundle');
  printFailure('runtime', error);
  process.exit(1);
});
