// __mocks__/expo-barcode-scanner.ts
export const BarCodeScanner = {
  requestPermissionsAsync: async () => ({ status: 'granted' }),
};
export default { BarCodeScanner };
