// vitest.config.ts
import { defineConfig } from "vitest/config";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function fromRoot(rel: string) {
  return fileURLToPath(new URL(rel, import.meta.url));
}

export default defineConfig({
  test: {
    environment: "node",
    globals: true,
    setupFiles: ["./vitest.setup.ts"],

    include: [
      "src/**/*.{spec,test}.{ts,tsx}",
      "src/**/__tests__/**/*.{spec,test}.{ts,tsx}",
      "tests/**/*.{spec,test}.{ts,tsx}",
    ],

    exclude: [
      "**/node_modules/**",
      "**/.pnpm/**",
      "src/validation/**",
      "src/security/**",
      "src/**/__tests__/**/fhir-map.test.ts",
      "src/**/__tests__/**/news2.test.ts",
      "src/**/__tests__/**/prefill.test.ts",
      "src/**/__tests__/**/media.test.ts",
      "src/**/__tests__/**/fetchPatientsFromFHIR.test.ts",
      "src/**/__tests__/**/queue.test.ts",
      "src/**/__tests__/**/patient-filters.test.ts",
      "src/**/__tests__/**/drafts.test.ts",
    ],

    coverage: {
      provider: "v8",
      reporter: ["text", "lcov"],
      reportsDirectory: "./coverage/unit",
      include: [
        "src/lib/auth.ts",
        "src/lib/net.ts",
        "src/lib/queue.ts",
        "src/lib/sync.ts",
        "src/screens/HandoverForm.tsx",
        "src/screens/QRScan.tsx",
        "src/validation/schemas.ts",
        "src/components/Chip.tsx",
      ],
      thresholds: {
        lines: 80,
        statements: 80,
        functions: 80,
        branches: 70,
      },
    },

    /**
     * IMPORTANTE:
     * - NO inlines react-native-svg (eso dispara el parse de Flow/TS interno).
     * - Sólo inline lo que realmente necesites transformar para tests.
     */
    deps: {
      inline: [
        "react-native",
        "@testing-library/react-native",
        "@expo/vector-icons",
        "expo-av",
        "expo-modules-core",
        "expo-file-system",
      ],
      optimizer: {
        esbuildOptions: {
          loader: {
            ".js": "jsx",
          },
        },
      },
    },
  },

  resolve: {
    alias: [
      // Atajos a src
      { find: "@/src", replacement: path.resolve(__dirname, "src") },
      { find: "@/", replacement: `${path.resolve(__dirname, "src")}/` },
      { find: "@", replacement: path.resolve(__dirname, "src") },

      // Stub de react-native para tests en Node
      { find: "react-native", replacement: fromRoot("./tests/__mocks__/react-native.ts") },

      // Stub explícito de @testing-library/react-native
      {
        find: "@testing-library/react-native",
        replacement: fromRoot("./tests/__mocks__/@testing-library-react-native.ts"),
      },

      // jest-native -> nuestro adaptador local
      {
        find: "@testing-library/jest-native/extend-expect",
        replacement: fromRoot("./tests/jest-native.ts"),
      },

      // Stub para expo-modules-core
      {
        find: "expo-modules-core",
        replacement: fromRoot("./__mocks__/expo-modules-core.ts"),
      },

      // Stub para deep import inexistente de React Navigation
      {
        find: "@react-navigation/native/lib/module/useBackButton",
        replacement: fromRoot("./__mocks__/useBackButton.ts"),
      },

      // Mock de expo-web-browser
      {
        find: "expo-web-browser",
        replacement: fromRoot("./__mocks__/expo-web-browser.ts"),
      },

      // expo-constants SIEMPRE al mock
      {
        find: "expo-constants",
        replacement: fromRoot("./__mocks__/expo-constants.ts"),
      },

      // Stub de @expo/vector-icons
      {
        find: "@expo/vector-icons",
        replacement: fromRoot("./tests/__mocks__/@expo-vector-icons.ts"),
      },

      /**
       * CLAVE:
       * Mockea react-native-svg y cualquier deep import (react-native-svg/...).
       * Esto evita que Vitest llegue a node_modules/react-native-svg/src/...
       */
      {
        find: /^react-native-svg(\/.*)?$/,
        replacement: fromRoot("./tests/__mocks__/react-native-svg.ts"),
      },

      // Stub de expo-av
      {
        find: "expo-av",
        replacement: fromRoot("./tests/__mocks__/expo-av.ts"),
      },

      {
        find: "@noble/ciphers/aes.js",
        replacement: fromRoot("./tests/__mocks__/@noble-ciphers-aes.ts"),
      },

      {
        find: "@react-native-async-storage/async-storage",
        replacement: fromRoot("./__mocks__/react-native-async-storage.ts"),
      },

      // Stub expo-sqlite
      {
        find: "expo-sqlite",
        replacement: fromRoot("./tests/__mocks__/expo-sqlite.ts"),
      },
      {
        find: "expo-sqlite/next",
        replacement: fromRoot("./tests/__mocks__/expo-sqlite.ts"),
      },
      {
        find: "expo-sqlite/legacy",
        replacement: fromRoot("./tests/__mocks__/expo-sqlite.ts"),
      },
    ],
  },

  optimizeDeps: {
    // Que Vite NO intente pre-bundlear libs nativas reales
    exclude: [
      "react-native",
      "@testing-library/react-native",
      "@expo/vector-icons",
      "react-native-svg",
      "expo-av",
      "expo-modules-core",
      "expo-file-system",
      "expo-sqlite",
      "expo-sqlite/next",
      "expo-sqlite/legacy",
    ],
  },

  ssr: {
    // Mantén external como lo tenías (tu alias resolverá al mock igualmente).
    external: [
      "react-native",
      "@testing-library/react-native",
      "react-native-svg",
      "@expo/vector-icons",
      "expo-av",
      "expo-modules-core",
      "expo-file-system",
      "expo-sqlite",
      "expo-sqlite/next",
      "expo-sqlite/legacy",
    ],
  },
});
