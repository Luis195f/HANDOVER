const SENSITIVE_META_KEYS =
  /(patient|name|nhc|note|summary|text|diagnosis|hx|history|mrn|id|identifier)/i;

const MAX_META_STRING_LENGTH = 32;
const MAX_META_ARRAY_ITEMS = 5;

export type WarnCode =
  | 'AUTH_CLAIMS_MISSING_ROLES'
  | 'AUTH_SESSION_SHAPE_UNEXPECTED'
  | 'OFFLINE_QUEUE_ITEM_RETRYING'
  | 'NET_REQUEST_RETRYING'
  | 'APP_QUEUE_SYNC_UNAVAILABLE';

// --- enablement gates (dev / CI / test / log level) ---
const devFlag = typeof __DEV__ !== 'undefined' && !!__DEV__;

const isCiOrTest =
  typeof process !== 'undefined' &&
  !!process.env &&
  (process.env.CI === 'true' ||
    process.env.NODE_ENV === 'test' ||
    process.env.VITEST === 'true');

function shouldLogWarn(): boolean {
  const level = process.env.EXPO_PUBLIC_LOG_LEVEL;
  if (typeof level === 'string') {
    const normalized = level.trim().toLowerCase();
    return normalized === 'warn' || normalized === 'debug';
  }
  // Mantén tu condición actual; solo OR con isCiOrTest:
  return devFlag || isCiOrTest;
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

  // Allowlist mínimo para no romper tests/diagnóstico no-PHI.
  const ALLOW_META_KEYS = /^(queueId|queue_id)$/i;

  const safe: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(meta)) {
    if (SENSITIVE_META_KEYS.test(key) && !ALLOW_META_KEYS.test(key)) continue;

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

    safe[key] = '[REDACTED_OBJECT]';
  }

  return Object.keys(safe).length > 0 ? safe : undefined;
}

export function warn(code: WarnCode, message: string, meta?: Record<string, unknown>): void {
  if (!shouldLogWarn()) return;

  // Evita duplicar el código si ya viene incluido en el message
  const renderedMessage = message.includes(code) ? message : `[${code}] ${message}`;

  const safeMeta = redactMeta(meta);
  if (safeMeta) {
    console.warn(renderedMessage, safeMeta);
    return;
  }
  console.warn(renderedMessage);
}

export function mark(_name: string, _attrs: Record<string, unknown> = {}): void {
  // Hook de observabilidad simple; en prod, envíalo a tu APM/OTel
  return;
}
