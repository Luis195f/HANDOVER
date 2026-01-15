export const getCameraPermissionsAsync = jest.fn(async () => ({
  status: 'granted',
  granted: true,
  canAskAgain: true,
}));

export const requestCameraPermissionsAsync = jest.fn(async () => ({
  status: 'granted',
  granted: true,
  canAskAgain: true,
}));

export const Camera = {
  getCameraPermissionsAsync,
  requestCameraPermissionsAsync,
};

export default Camera;
