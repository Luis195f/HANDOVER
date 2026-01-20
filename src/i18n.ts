export const strings = {
  es: {
    offlineMsg:
      'No se pudo conectar. Revisa tu conexión a internet. Si estás sin red, el envío quedará en cola y se reintentará automáticamente.',
    sessionExpiredTitle: 'Sesión expirada',
    sessionExpiredMessage: 'Tu sesión caducó. Inicia sesión nuevamente para continuar.',
    loginCta: 'Iniciar sesión',
    cameraPermissionDeniedTitle: 'Permiso de cámara denegado',
    cameraPermissionDeniedMessage: 'Habilita el permiso de cámara en Ajustes para escanear códigos QR.',
    cancelLabel: 'Cancelar',
    openSettingsLabel: 'Abrir Ajustes',
  },
  en: {
    offlineMsg:
      'Could not connect. Check your internet connection. If you are offline, the submission will be queued and retried automatically.',
    sessionExpiredTitle: 'Session expired',
    sessionExpiredMessage: 'Your session expired. Please sign in again to continue.',
    loginCta: 'Sign in',
    cameraPermissionDeniedTitle: 'Camera permission denied',
    cameraPermissionDeniedMessage: 'Enable camera permission in Settings to scan QR codes.',
    cancelLabel: 'Cancel',
    openSettingsLabel: 'Open Settings',
  },
};

export type SupportedLang = keyof typeof strings;
export type TranslationKey = keyof typeof strings.es;

// TODO: In the future, replace this PoC with a proper i18n library and a global language setting.
export const currentLang: SupportedLang =
  typeof Intl !== 'undefined' && Intl.DateTimeFormat().resolvedOptions().locale.startsWith('en')
    ? 'en'
    : 'es';

export const t = (key: TranslationKey, lang: SupportedLang = currentLang): string =>
  strings[lang]?.[key] ?? strings.es[key] ?? key;
