import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

const FILES_TO_SCAN = [
  '.env.example',
  'config/staging.env',
  'app.config.ts',
  'Dockerfile',
  'docker-compose.yml',
  'README.md',
  'docs/security-and-auth.md',
  'docs/offline-sync-and-queue.md',
  'docs/fhir-and-interoperability.md',
] as const;

const BANNED_PUBLIC_MARKERS = [
  'EXPO_PUBLIC_ALLOW_ALL_UNITS',
  'EXPO_PUBLIC_BYPASS_SCOPE',
  'EXPO_PUBLIC_OFFLINE_ENCRYPTION_DISABLED',
  'EXPO_PUBLIC_NANDA_CATALOG_JSON',
  'EXPO_PUBLIC_NIC_CATALOG_JSON',
  'EXPO_PUBLIC_NOC_CATALOG_JSON',
  'EXPO_PUBLIC_CLIENT_SIGNING_ENABLED',
] as const;

describe('client env trust boundary', () => {
  for (const relativePath of FILES_TO_SCAN) {
    it(`keeps ${relativePath} free of banned public markers`, () => {
      const filePath = path.resolve(process.cwd(), relativePath);
      const contents = readFileSync(filePath, 'utf8');

      for (const marker of BANNED_PUBLIC_MARKERS) {
        expect(contents).not.toContain(marker);
      }
    });
  }
});

