import { defineConfig } from 'vitest/config';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    setupFiles: ['./vitest.setup.ts'],
    include: [
      '__tests__/**/*.spec.ts',
      '__tests__/**/*.spec.tsx',
      'tests/**/*.spec.ts',
      'tests/**/*.spec.tsx',
      'tests/patientlist-*.test.ts',
      'tests/qr-scan.test.ts',
      'tests/security/**/*.spec.ts',
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
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      reportsDirectory: './coverage/unit',
      include: [
        'src/lib/auth.ts',
        'src/lib/net.ts',
        'src/screens/HandoverForm.tsx',
        'src/validation/schemas.ts',
        'src/components/Chip.tsx',
      ],
      thresholds: {
        lines: 80,
        statements: 80,
        functions: 80,
        branches: 70,
      },
    },
  },
  resolve: {
    alias: [
      { find: '@/src', replacement: path.resolve(__dirname, 'src') },
      { find: '@/', replacement: `${path.resolve(__dirname, 'src')}/` },
      { find: '@', replacement: path.resolve(__dirname, 'src') },
      {
        find: 'react-native',
        replacement: fileURLToPath(new URL('./tests/__mocks__/react-native.ts', import.meta.url)),
      },
      {
        find: '@testing-library/jest-native/extend-expect',
        replacement: fileURLToPath(new URL('./tests/jest-native.ts', import.meta.url)),
      },
    ],
  },
  optimizeDeps: { exclude: ['react-native'] },
  ssr: { external: ['react-native'] },
});
