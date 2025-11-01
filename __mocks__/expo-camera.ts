export const Camera = {
  requestCameraPermissionsAsync: jest.fn(async () => ({ granted: true, canAskAgain: true })),
};
