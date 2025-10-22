import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  test: {
    environment: 'node',
    include: [
      '**/__tests__/**/fhir-map.*.(spec|test).ts',
      '**/__tests__/**/sync.*.(spec|test).ts',
    ],
    exclude: [
      'src/**/__tests__/**/news2.test.ts',
      'src/**/__tests__/**/prefill.test.ts',
      'src/**/__tests__/**/media.test.ts',
      'src/**/__tests__/**/fetchPatientsFromFHIR.test.ts',
      'src/**/__tests__/**/queue.test.ts',
      'src/**/__tests__/**/patient-filters.test.ts',
      'src/**/__tests__/**/fhir-map.test.ts',
      'src/**/__tests__/**/drafts.test.ts',
      'src/security/**/__tests__/**',
      'src/validation/**/__tests__/**',
      'src/screens/**/__tests__/**',
    ],
    setupFiles: ['./vitest.setup.ts'],
  },
  resolve: {
    alias: {
      '@/src': path.resolve(__dirname, 'src'),
    },
  },
});
