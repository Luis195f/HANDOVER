import { defineConfig } from 'vitest/config';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    include: [
      '**/__tests__/**/fhir-map.*.(spec|test).ts',
      '**/__tests__/**/sync.*.(spec|test).ts',
      'tests/patientlist-*.test.ts',
      'tests/qr-scan.test.ts',
    ],
    exclude: [
      'src/screens/**',
      'src/validation/**',
      'src/security/**',
      'src/**/__tests__/**/fhir-map.test.ts',
      'src/**/__tests__/**/news2.test.ts',
      'src/**/__tests__/**/prefill.test.ts',
      'src/**/__tests__/**/media.test.ts',
      'src/**/__tests__/**/fetchPatientsFromFHIR.test.ts',
      'src/**/__tests__/**/queue.test.ts',
      'src/**/__tests__/**/patient-filters.test.ts',
      'src/**/__tests__/**/drafts.test.ts',
    ],
    setupFiles: ['./vitest.setup.ts'],
  },
  resolve: {
    alias: {
      '@/src': path.resolve(__dirname, 'src'),
      'react-native': fileURLToPath(new URL('./tests/__mocks__/react-native.ts', import.meta.url)),
    },
  },
  optimizeDeps: { exclude: ['react-native'] },
  ssr: { external: ['react-native'] },
});
