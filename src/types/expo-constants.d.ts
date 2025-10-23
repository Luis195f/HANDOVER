declare module 'expo-constants' {
  const Constants: {
    expoConfig?: { extra?: Record<string, unknown> };
    manifest?: { extra?: Record<string, unknown> };
  };
  export default Constants;
}
