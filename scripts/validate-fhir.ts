#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { stdin as input } from 'node:process';
import { resolve } from 'node:path';
import process from 'node:process';

import { ZodError } from 'zod';

import { validateBundle, type FhirBundleTransaction } from '../src/lib/fhir-map';

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

function printSuccess(label: string, summary: {
  entries: number;
  observations: number;
  medications: number;
  deviceUses: number;
  documents: number;
  compositions: number;
}) {
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

async function main() {
  const [, , ...args] = process.argv;

  if (args.length === 0) {
    console.error('Usage: pnpm validate:fhir <bundle.json> [more.json | -]');
    process.exitCode = 1;
    return;
  }

  let hasErrors = false;

  for (const source of args) {
    const label = source === '-' ? 'stdin' : resolve(source);
    try {
      const data = await readJson(source);
      const bundle = data as FhirBundleTransaction;
      const result = validateBundle(bundle);
      if (!result.ok) {
        throw new ZodError(result.errors.map((message) => ({ code: 'custom', path: [], message })));
      }
      printSuccess(label, {
        entries: Array.isArray(bundle.entry) ? bundle.entry.length : 0,
        observations: 0,
        medications: 0,
        deviceUses: 0,
        documents: 0,
        compositions: 0,
      });
    } catch (error) {
      hasErrors = true;
      printFailure(label, error);
    }
  }

  if (hasErrors) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error('Unexpected error while validating FHIR bundle');
  printFailure('runtime', error);
  process.exit(1);
});
