import 'dotenv/config';

export default ({ config }) => ({
  ...config,

  name: 'handover-pro',
  slug: 'handover-pro',
  owner: 'enfermero1',

  scheme: 'handover-pro',
  version: '1.0.0',
  orientation: 'portrait',
  userInterfaceStyle: 'light',

  icon: './assets/icon.png',

  splash: {
    image: './assets/splash-icon.png',
    resizeMode: 'contain',
    backgroundColor: '#ffffff',
  },

  // ────────────────────────────────────────────────
  // 📦 Plugins compatibles (SDK 54)
  // ────────────────────────────────────────────────
  plugins: [
    'expo-system-ui',
    'expo-sqlite',
    'expo-secure-store',
    'expo-notifications',
    [
      'expo-audio',
      {
        microphonePermission: 'Permitir a Handover usar el micrófono.',
      },
    ],
    'expo-asset',
    [
      'expo-build-properties',
      {
        android: {
          kotlinVersion: '2.0.21',
        },
      },
    ],
  ],

  // ────────────────────────────────────────────────
  // 🤖 ANDROID CONFIG
  // ────────────────────────────────────────────────
  android: {
    ...(config.android ?? {}),
    package: 'com.handover.app',

    adaptiveIcon: {
      foregroundImage: './assets/adaptive-icon.png',
      backgroundColor: '#ffffff',
    },

    permissions: [
      'android.permission.CAMERA',
      'android.permission.RECORD_AUDIO',
      'android.permission.POST_NOTIFICATIONS',
      'android.permission.MODIFY_AUDIO_SETTINGS',
    ],

    versionCode: 1,
    edgeToEdgeEnabled: true,

    // Deep links (Auth + Dev Client)
    intentFilters: [
      // Auth callback (prod): handover-pro://redirect
      {
        action: 'VIEW',
        category: ['BROWSABLE', 'DEFAULT'],
        data: [{ scheme: 'handover-pro', host: 'redirect' }],
      },

      // Logout (prod): handover-pro://logout
      {
        action: 'VIEW',
        category: ['BROWSABLE', 'DEFAULT'],
        data: [{ scheme: 'handover-pro', host: 'logout', pathPrefix: '/' }],
      },

      // Auth callback (dev build): exp+handover-pro://redirect
      {
        action: 'VIEW',
        category: ['BROWSABLE', 'DEFAULT'],
        data: [{ scheme: 'exp+handover-pro', host: 'redirect', pathPrefix: '/' }],
      },

      // Expo Dev Client launcher: exp+handover-pro://expo-development-client/?url=...
      {
        action: 'VIEW',
        category: ['BROWSABLE', 'DEFAULT'],
        data: [
          {
            scheme: 'exp+handover-pro',
            host: 'expo-development-client',
            pathPrefix: '/',
          },
        ],
      },
    ],
  },

  // ────────────────────────────────────────────────
  // 🍏 iOS CONFIG
  // ────────────────────────────────────────────────
  ios: {
    ...(config.ios ?? {}),
    bundleIdentifier: 'com.handover.app',
    supportsTablet: true,
    infoPlist: {
      NSCameraUsageDescription: 'Se requiere la cámara para escanear códigos QR en Handover.',
      NSMicrophoneUsageDescription: 'Grabación de notas de audio del turno.',
      NSUserTrackingUsageDescription: 'Se usa para mejorar la experiencia del turno.',
    },
    buildNumber: '1.0.0',
  },

  // ────────────────────────────────────────────────
  // ⚙️ EXTRA (runtime config)
  // ────────────────────────────────────────────────
  extra: {
    ...(config.extra ?? {}),
    eas: {
      projectId: '4341b7e0-da12-42a3-8452-745c68996e36',
    },

    // Ajusta estos si los manejas por env:
    FHIR_BASE_URL: process.env.EXPO_PUBLIC_FHIR_BASE_URL ?? 'https://fhir.example.com',
    STT_ENDPOINT: process.env.EXPO_PUBLIC_STT_ENDPOINT ?? 'http://192.168.0.16:8091/stt',
    ENCRYPTION_NAMESPACE: process.env.EXPO_PUBLIC_STORAGE_NAMESPACE ?? 'handover-pro',
    ALLOW_ALL_UNITS: process.env.EXPO_PUBLIC_ALLOW_ALL_UNITS ?? '1',

    FEATURES: {
      handover: {
        showSBAR: '1',
        showVitals: '1',
        showOxygen: '1',
        showMeds: '1',
        showAttachments: '1',
        enableAlerts: '1',
      },
    },

    EXPO_PUBLIC_AUTH0_DOMAIN: process.env.EXPO_PUBLIC_AUTH0_DOMAIN,
    EXPO_PUBLIC_AUTH0_CLIENT_ID: process.env.EXPO_PUBLIC_AUTH0_CLIENT_ID,
    EXPO_PUBLIC_AUTH0_REDIRECT_URI: process.env.EXPO_PUBLIC_AUTH0_REDIRECT_URI,
    EXPO_PUBLIC_AUTH0_LOGOUT_URI: process.env.EXPO_PUBLIC_AUTH0_LOGOUT_URI,
  },

  // ────────────────────────────────────────────────
  // 🔄 UPDATES
  // ────────────────────────────────────────────────
  updates: {
    fallbackToCacheTimeout: 0,
    checkAutomatically: 'ON_LOAD',
  },
});






