// Identificadores deterministas + firma estable del Bundle.
import { sha256 } from 'js-sha256';

function sortObj<T>(obj: T): T {
  if (obj === null || typeof obj !== 'object') return obj;
  if (Array.isArray(obj)) return obj.map((item) => sortObj(item)) as T;
  const record = obj as Record<string, unknown>;
  const sorted = Object.keys(record).sort().reduce((acc, key) => {
    acc[key] = sortObj(record[key]);
    return acc;
  }, {} as Record<string, unknown>);
  return sorted as T;
}

// Serializa con claves ordenadas para hash estable
export function stableStringify(obj: unknown): string {
  return JSON.stringify(sortObj(obj));
}

export function sha256Hex(s: string): string {
  return sha256(s);
}

// ID determinista por recurso (ej.: Observation por (code, subject, effectiveDateTime, value))
type Coding = { system?: string; code?: string };
type ResourceLike = {
  resourceType?: string;
  subject?: { reference?: string };
  code?: { coding?: Coding[] };
  effectiveDateTime?: unknown;
  effectivePeriod?: unknown;
  issued?: unknown;
  valueQuantity?: unknown;
  valueCodeableConcept?: unknown;
  valueString?: unknown;
  status?: unknown;
};

export function deterministicIdentifier(resource: ResourceLike): string {
  // Extrae campos clave típicos si existen; cae al recurso ordenado
  const candidates = {
    resourceType: resource?.resourceType,
    subject: resource?.subject?.reference,
    code: resource?.code?.coding?.map((c) => `${c.system}|${c.code}`)?.join(','),
    effective: resource?.effectiveDateTime ?? resource?.effectivePeriod ?? resource?.issued,
    value: resource?.valueQuantity ?? resource?.valueCodeableConcept ?? resource?.valueString,
    status: resource?.status,
  };
  const base = stableStringify(candidates ?? resource);
  return sha256Hex(base); // hex de 64 chars
}

// Idempotency-Key para TODO el Bundle (completo y ordenado)
export function bundleIdempotencyKey(bundle: any): string {
  return sha256Hex(stableStringify(bundle));
}
