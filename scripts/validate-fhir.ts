#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import process from 'node:process';

import { HandoverValidationError, validateHandoverBundle } from '../src/lib/fhir/validation';

async function validateFile(filePath: string): Promise<number> {
  try {
    const raw = await readFile(filePath, 'utf8');
    const payload = JSON.parse(raw);
    validateHandoverBundle(payload);
    console.log(`✅ ${filePath} is a valid handover Bundle`);
    return 0;
  } catch (error) {
    if (error instanceof SyntaxError) {
      console.error(`❌ ${filePath} is not valid JSON: ${error.message}`);
      return 1;
    }

    if (error instanceof HandoverValidationError) {
      console.error(`❌ ${filePath} failed validation: ${error.message}`);
      if (error.issues && error.issues.length > 0) {
        for (const issue of error.issues) {
          console.error(`   • ${issue.path.join('.') || '(root)'}: ${issue.message}`);
        }
      }
      return 1;
    }

    console.error(`❌ ${filePath} threw an unexpected error: ${(error as Error).message}`);
    return 1;
  }
}

async function main() {
  const [, , ...args] = process.argv;
  if (args.length === 0) {
    console.error('Usage: pnpm tsx scripts/validate-fhir.ts <bundle.json> [more.json ...]');
    process.exitCode = 1;
    return;
  }

  let exitCode = 0;
  for (const filePath of args) {
    const code = await validateFile(filePath);
    if (code !== 0) exitCode = code;
  }

  process.exitCode = exitCode;
}

void main();
