/** @type {import('jest').Config} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  setupFilesAfterEnv: ['<rootDir>/jest-tests/setup.ts'],
  roots: ['<rootDir>/jest-tests'],
  testMatch: ['**/?(*.)+(spec|test).[tj]s?(x)'],

  transform: {
    '^.+\\.(ts|tsx)$': ['ts-jest', { tsconfig: 'tsconfig.json' }],
  },

  moduleNameMapper: {
    '^@/src/(.*)$': '<rootDir>/src/$1',
    '^expo-file-system$': '<rootDir>/jest-tests/__mocks__/expo-file-system.js',
    '^expo-crypto$': '<rootDir>/jest-tests/__mocks__/expo-crypto.js',
  },
};
