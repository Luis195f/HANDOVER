export const getRecordingPermissionsAsync = jest.fn(async () => ({
  status: 'granted',
  granted: true,
  canAskAgain: true,
}));

export const requestRecordingPermissionsAsync = jest.fn(async () => ({
  status: 'granted',
  granted: true,
  canAskAgain: true,
}));

// Compat por si algún test espera Audio.requestPermissionsAsync
export const Audio = {
  getPermissionsAsync: getRecordingPermissionsAsync,
  requestPermissionsAsync: requestRecordingPermissionsAsync,
};

export default {
  getRecordingPermissionsAsync,
  requestRecordingPermissionsAsync,
  Audio,
};
