// vitest.config.ts
import { defineConfig } from 'vitest/config';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function fromRoot(rel: string) {
  return fileURLToPath(new URL(rel, import.meta.url));
}

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
      'tests/**/*.test.ts',
      'tests/**/*.test.tsx',
      'tests/patientlist-*.test.ts',
      'tests/qr-scan.test.ts',
      'tests/security/**/*.spec.ts',
    ],

    exclude: [
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
        'src/lib/queue.ts',
        'src/lib/sync.ts',
        'src/screens/HandoverForm.tsx',
        'src/screens/QRScan.tsx',
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

    // 👇 Workaround: indicar qué deps queremos que Vitest trate explícitamente
    server: {
      deps: {
        inline: [
          'react-native',
          '@testing-library/react-native',
          '@expo/vector-icons',
          'react-native-svg',
          'expo-av',
          'expo-modules-core',
          'expo-file-system',
        ],
      },
    },

    // 👇 Permitir JSX en .js (por si algún otro paquete raro lo necesita)
    deps: {
      optimizer: {
        esbuildOptions: {
          loader: {
            '.js': 'jsx',
          },
        },
      },
    },
  },

  resolve: {
    alias: [
      // Atajos a src
      { find: '@/src', replacement: path.resolve(__dirname, 'src') },
      { find: '@/', replacement: `${path.resolve(__dirname, 'src')}/` },
      { find: '@', replacement: path.resolve(__dirname, 'src') },

      // Stub de react-native para tests en Node
      {
        find: 'react-native',
        replacement: fromRoot('./tests/__mocks__/react-native.ts'),
      },

      // Stub explícito de @testing-library/react-native
      {
        find: '@testing-library/react-native',
        replacement: fromRoot(
          './tests/__mocks__/@testing-library-react-native.ts',
        ),
      },

      // jest-native -> nuestro adaptador local
      {
        find: '@testing-library/jest-native/extend-expect',
        replacement: fromRoot('./tests/jest-native.ts'),
      },

      // Stub para expo-modules-core (NativeModulesProxy, EventEmitter, Platform, createPermissionHook, etc.)
      {
        find: 'expo-modules-core',
        replacement: fromRoot('./__mocks__/expo-modules-core.ts'),
      },

      // Stub para el deep import inexistente de React Navigation
      {
        find: '@react-navigation/native/lib/module/useBackButton',
        replacement: fromRoot('./__mocks__/useBackButton.ts'),
      },

      // Mock de expo-web-browser para evitar AppState.currentState
      {
        find: 'expo-web-browser',
        replacement: fromRoot('./__mocks__/expo-web-browser.ts'),
      },

      // 🔴 expo-constants SIEMPRE va al mock
      {
        find: 'expo-constants',
        replacement: fromRoot('./__mocks__/expo-constants.ts'),
      },

      // Stub de @expo/vector-icons
      {
        find: '@expo/vector-icons',
        replacement: fromRoot('./tests/__mocks__/@expo-vector-icons.ts'),
      },

      // Stub de react-native-svg
      {
        find: 'react-native-svg',
        replacement: fromRoot('./tests/__mocks__/react-native-svg.ts'),
      },

      // ⭐ NUEVO: stub de expo-av -> evita entrar a build/Video.js con JSX
      {
        find: 'expo-av',
        replacement: fromRoot('./tests/__mocks__/expo-av.ts'),
      },
      {
        find: '@noble/ciphers/aes.js',
        replacement: fromRoot('./tests/__mocks__/@noble-ciphers-aes.ts'),
      },
      {
  find: '@react-native-async-storage/async-storage',
  replacement: fromRoot('./__mocks__/react-native-async-storage.ts'),
},

    ],
  },

  optimizeDeps: {
    // Que Vite NO intente pre-bundlear las libs nativas reales
    exclude: [
      'react-native',
      '@testing-library/react-native',
      '@expo/vector-icons',
      'react-native-svg',
      'expo-av',
      'expo-modules-core',
      'expo-file-system',
    ],
  },

  ssr: {
    external: [
      'react-native',
      '@testing-library/react-native',
      'react-native-svg',
      '@expo/vector-icons',
      'expo-av',
      'expo-modules-core',
      'expo-file-system',
    ],
  },
});
