// jest-tests/__mocks__/expo-file-system.js

module.exports = {
  documentDirectory: 'file:///mock-documents/',
  cacheDirectory: 'file:///mock-cache/',

  readAsStringAsync: jest.fn(async () => ''),
  writeAsStringAsync: jest.fn(async () => undefined),
  deleteAsync: jest.fn(async () => undefined),
  getInfoAsync: jest.fn(async () => ({
    exists: true,
    isDirectory: false,
    uri: 'file:///mock-file',
    size: 0,
    modificationTime: Date.now(),
  })),

  makeDirectoryAsync: jest.fn(async () => undefined),
};
