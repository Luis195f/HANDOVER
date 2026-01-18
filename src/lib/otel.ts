// src/lib/otel.ts

// Importante: redacción por KEY (no por substring) para NO borrar claves benignas tipo "queueId".
const SENSITIVE_META_KEYS =
  /^(patient|name|nhc|note|summary|text|diagnosis|hx|history|mrn|id|identifier)$/i;

const MAX_META_STRING_LENGTH = 32;
const MAX_META_ARRAY_ITEMS = 5;

export type WarnCode =
  | 'AUTH_CLAIMS_MISSING_ROLES'
  | 'AUTH_SESSION_SHAPE_UNEXPECTED'
  | 'OFFLINE_QUEUE_ITEM_RETRYING'
  | 'NET_REQUEST_RETRYING'
  | 'APP_QUEUE_SYNC_UNAVAILABLE';

function getEnv(): Record<string, any> | undefined {
  if (typeof process === 'undefined') return undefined;
  const p: any = process;
  if (!p?.env || typeof p.env !== 'object') return undefined;
  return p.env as Record<string, any>;
}

function shouldLogWarn(): boolean {
  const devFlag = typeof __DEV__ !== 'undefined' && !!__DEV__;

  const env = getEnv();

  const isCiOrTest =
    !!env && (env.CI === 'true' || env.CI === '1' || env.NODE_ENV === 'test');

  // Tu condición por EXPO_PUBLIC_LOG_LEVEL (warn/debug habilitan warnings)
  const level = env?.EXPO_PUBLIC_LOG_LEVEL;
  const levelAllowsWarn =
    typeof level === 'string' &&
    (() => {
      const normalized = level.trim().toLowerCase();
      return normalized === 'warn' || normalized === 'debug';
    })();

  // Gate final: dev OR CI/test OR log level que habilite warn/debug
  return devFlag || isCiOrTest || levelAllowsWarn;
}

function isPrimitive(
  value: unknown
): value is string | number | boolean | null | undefined {
  return (
    value == null ||
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean'
  );
}

function sanitizePrimitive(value: string | number | boolean | null | undefined) {
  if (typeof value === 'string') {
    return value.slice(0, MAX_META_STRING_LENGTH);
  }
  return value;
}

function redactMeta(meta?: Record<string, unknown>): Record<string, unknown> | undefined {
  if (!meta) return undefined;

  const safe: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(meta)) {
    // drop keys sensibles (por nombre exacto)
    if (SENSITIVE_META_KEYS.test(key)) continue;

    if (isPrimitive(value)) {
      safe[key] = sanitizePrimitive(value);
      continue;
    }

    if (Array.isArray(value)) {
      const sanitized = value
        .filter((item) => isPrimitive(item))
        .slice(0, MAX_META_ARRAY_ITEMS)
        .map((item) =>
          sanitizePrimitive(item as string | number | boolean | null | undefined)
        );

      if (sanitized.length > 0) safe[key] = sanitized;
      continue;
    }

    // No permitimos objetos arbitrarios (evita PHI accidental)
    safe[key] = '[REDACTED_OBJECT]';
  }

  return Object.keys(safe).length > 0 ? safe : undefined;
}

export function warn(code: WarnCode, message: string, meta?: Record<string, unknown>): void {
  if (!shouldLogWarn()) return;

  const safeMeta = redactMeta(meta);

  // Mantén el mensaje EXACTO que te interesa; el código queda disponible por si quieres usarlo luego.
  // (No lo imprimimos aparte para evitar duplicar ruido.)
  if (safeMeta) {
    console.warn(message, safeMeta);
    return;
  }
  console.warn(message);
}

export function mark(_name: string, _attrs: Record<string, unknown> = {}) {
  // Hook de observabilidad simple; en prod, envíalo a tu APM/OTel
  return;
}
