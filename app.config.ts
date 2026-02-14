require('dotenv/config');

module.exports = ({ config }) => ({
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
    'expo-router',
    'expo-web-browser',
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

    // Deep links (Auth + Dev Client) — soporta host y path
    intentFilters: [
      // PROD handover-pro://redirect  (host)
      {
        action: 'VIEW',
        category: ['BROWSABLE', 'DEFAULT'],
        data: [{ scheme: 'handover-pro', host: 'redirect' }],
      },
      // PROD handover-pro:///redirect (path)
      {
        action: 'VIEW',
        category: ['BROWSABLE', 'DEFAULT'],
        data: [{ scheme: 'handover-pro', pathPrefix: '/redirect' }],
      },

      // PROD logout host
      {
        action: 'VIEW',
        category: ['BROWSABLE', 'DEFAULT'],
        data: [{ scheme: 'handover-pro', host: 'logout' }],
      },
      // PROD logout path
      {
        action: 'VIEW',
        category: ['BROWSABLE', 'DEFAULT'],
        data: [{ scheme: 'handover-pro', pathPrefix: '/logout' }],
      },

      // DEV exp+handover-pro://redirect (host)
      {
        action: 'VIEW',
        category: ['BROWSABLE', 'DEFAULT'],
        data: [{ scheme: 'exp+handover-pro', host: 'redirect' }],
      },
      // DEV exp+handover-pro:///redirect (path)
      {
        action: 'VIEW',
        category: ['BROWSABLE', 'DEFAULT'],
        data: [{ scheme: 'exp+handover-pro', pathPrefix: '/redirect' }],
      },

      // DEV exp+handover-pro logout host
      {
        action: 'VIEW',
        category: ['BROWSABLE', 'DEFAULT'],
        data: [{ scheme: 'exp+handover-pro', host: 'logout' }],
      },
      // DEV exp+handover-pro logout path
      {
        action: 'VIEW',
        category: ['BROWSABLE', 'DEFAULT'],
        data: [{ scheme: 'exp+handover-pro', pathPrefix: '/logout' }],
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

    FHIR_BASE_URL: process.env.EXPO_PUBLIC_FHIR_BASE_URL ?? 'https://fhir.example.com',
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






