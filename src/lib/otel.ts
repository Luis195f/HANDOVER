// src/lib/otel.ts

// OJO: NO incluir "id" genérico en el regex porque redactería keys como "queueId"
// y rompe tests/observabilidad no sensible.
const SENSITIVE_META_KEYS =
  /(patient|name|nhc|note|summary|text|diagnosis|hx|history|mrn|identifier)/i;

const MAX_META_STRING_LENGTH = 32;
const MAX_META_ARRAY_ITEMS = 5;

export type WarnCode =
  | "AUTH_CLAIMS_MISSING_ROLES"
  | "AUTH_SESSION_SHAPE_UNEXPECTED"
  | "OFFLINE_QUEUE_ITEM_RETRYING"
  | "NET_REQUEST_RETRYING"
  | "APP_QUEUE_SYNC_UNAVAILABLE";

function getEnv(name: string): string | undefined {
  // En RN puede no existir process/env; en tests/CI sí.
  try {
    if (typeof process !== "undefined" && process.env && typeof process.env[name] === "string") {
      return process.env[name];
    }
  } catch {
    // ignore
  }
  return undefined;
}

function shouldLogWarn(): boolean {
  const devFlag = typeof __DEV__ !== "undefined" && !!__DEV__;

  const isCiOrTest =
    typeof process !== "undefined" &&
    !!process.env &&
    (process.env.CI === "true" || process.env.NODE_ENV === "test");

  const level = getEnv("EXPO_PUBLIC_LOG_LEVEL");
  const enabledByLevel =
    typeof level === "string" &&
    (() => {
      const normalized = level.trim().toLowerCase();
      return normalized === "warn" || normalized === "debug";
    })();

  // Mantén tu condición actual (LOG_LEVEL) pero OR con CI/test
  return devFlag || isCiOrTest || enabledByLevel;
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
        .map((item) => sanitizePrimitive(item as string | number | boolean | null | undefined));

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
