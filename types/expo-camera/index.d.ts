declare module 'expo-camera' {
  export const Camera: {
    requestCameraPermissionsAsync(): Promise<{ granted: boolean; canAskAgain?: boolean }>;
  };
}
