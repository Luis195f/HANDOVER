// @ts-nocheck
// Identificadores deterministas + firma estable del Bundle.
import CryptoJS from 'crypto-js';

function sortObj<T>(obj: T): T {
  if (obj === null || typeof obj !== 'object') return obj;
  if (Array.isArray(obj)) return obj.map(sortObj) as any;
  return Object.keys(obj as any).sort().reduce((acc: any, k) => {
    acc[k] = sortObj((obj as any)[k]);
    return acc;
  }, {});
}

// Serializa con claves ordenadas para hash estable
export function stableStringify(obj: unknown): string {
  return JSON.stringify(sortObj(obj));
}

export function sha256Hex(s: string): string {
  return CryptoJS.SHA256(s).toString(CryptoJS.enc.Hex);
}

// ID determinista por recurso (ej.: Observation por (code, subject, effectiveDateTime, value))
export function deterministicIdentifier(resource: any): string {
  // Extrae campos clave típicos si existen; cae al recurso ordenado
  const candidates = {
    resourceType: resource?.resourceType,
    subject: resource?.subject?.reference,
    code: resource?.code?.coding?.map((c: any) => `${c.system}|${c.code}`)?.join(','),
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
