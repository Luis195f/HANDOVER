// src/lib/otel.ts

// OJO: NO incluir "id" genérico en el regex porque redactería keys como "queueId"
// y rompe tests/observabilidad no sensible.
const SENSITIVE_META_KEYS =
  /(patient|name|nhc|note|summary|text|diagnosis|hx|history|mrn|identifier)/i;

const MAX_META_STRING_LENGTH = 32;
const MAX_META_ARRAY_ITEMS = 5;

// Mantén tipos conocidos para autocomplete, pero permite códigos adicionales (p. ej. HNDR_SIGN_110)
export type WarnCode =
  | "AUTH_CLAIMS_MISSING_ROLES"
  | "AUTH_SESSION_SHAPE_UNEXPECTED"
  | "OFFLINE_QUEUE_ITEM_RETRYING"
  | "NET_REQUEST_RETRYING"
  | "APP_QUEUE_SYNC_UNAVAILABLE"
  | (string & {});

function getEnv(name: string): string | undefined {
  // En RN puede no existir process/env; en tests/CI sí.
  try {
    const p: any = typeof process !== "undefined" ? process : undefined;
    const env = p && p.env ? p.env : undefined;
    const v = env && typeof env[name] === "string" ? env[name] : undefined;
    return v;
  } catch {
    return undefined;
  }
}

function shouldLogWarn(): boolean {
  const devFlag = typeof __DEV__ !== "undefined" && !!__DEV__;

  const level = getEnv("EXPO_PUBLIC_LOG_LEVEL");
  const enabledByLevel =
    typeof level === "string" &&
    (() => {
      const normalized = level.trim().toLowerCase();
      return normalized === "warn" || normalized === "debug";
    })();

  // En Vitest/Jest/CI (Node) queremos SIEMPRE permitir warnings
  // para que los tests puedan asertar `console.warn(...)`.
  // Pero NO queremos encenderlos en React Native (dispositivo/build).
  const isReactNative =
    typeof navigator !== "undefined" && (navigator as any)?.product === "ReactNative";

  const isNode =
    !isReactNative &&
    typeof process !== "undefined" &&
    !!(process as any).versions &&
    typeof (process as any).versions.node === "string";

  if (isNode) return true;

  // Fallback extra por si algún entorno no-Node sí expone envs de test/CI.
  const isCiOrTest =
    getEnv("CI") === "true" ||
    getEnv("NODE_ENV") === "test" ||
    getEnv("VITEST") === "true" ||
    typeof getEnv("JEST_WORKER_ID") === "string";

  return devFlag || enabledByLevel || isCiOrTest;
}

function isPrimitive(value: unknown): value is string | number | boolean | null | undefined {
  return (
    value == null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  );
}

function sanitizePrimitive(value: string | number | boolean | null | undefined) {
  if (typeof value === "string") return value.slice(0, MAX_META_STRING_LENGTH);
  return value;
}

function redactMeta(meta?: Record<string, unknown>): Record<string, unknown> | undefined {
  if (!meta) return undefined;

  const safe: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(meta)) {
    if (SENSITIVE_META_KEYS.test(key)) continue;

    if (isPrimitive(value)) {
      safe[key] = sanitizePrimitive(value);
      continue;
    }

    if (Array.isArray(value)) {
      const sanitized = value
        .filter((item) => isPrimitive(item))
        .slice(0, MAX_META_ARRAY_ITEMS)
        .map((item) => sanitizePrimitive(item as any));

      if (sanitized.length > 0) safe[key] = sanitized;
      continue;
    }

    safe[key] = "[REDACTED_OBJECT]";
  }

  return Object.keys(safe).length > 0 ? safe : undefined;
}

export function warn(code: WarnCode, message: string, meta?: Record<string, unknown>): void {
  if (!shouldLogWarn()) return;

  const safeMeta = redactMeta(meta);
  const codedMessage = message.includes(code) ? message : `[${code}] ${message}`;

  if (safeMeta) {
    console.warn(codedMessage, safeMeta);
    return;
  }

  console.warn(codedMessage);
}

export function mark(_name: string, _attrs: Record<string, unknown> = {}) {
  // Hook de observabilidad simple; en prod, envíalo a tu APM/OTel
  return;
}
