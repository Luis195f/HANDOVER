declare module 'expo-av' {
  export const Audio: {
    requestPermissionsAsync(): Promise<{ granted: boolean; canAskAgain?: boolean }>;
  };
}
