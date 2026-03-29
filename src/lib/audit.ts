import { v4 as uuidv4 } from 'uuid';
import { apiPost } from '@/src/lib/api';
import {
  encryptedGetItem,
  encryptedRemoveItem,
  encryptedSetItem,
  getAsyncStorageAdapter,
  type AsyncStorageAdapter,
} from './encryptedStorage';
import { hashHex } from './crypto';

const AUDIT_PATIENT_KEY_PREFIX = 'ptk_';
const AUDIT_PATIENT_KEY_LENGTH = 24;
const AUDIT_PATIENT_KEY_PATTERN = new RegExp(`^${AUDIT_PATIENT_KEY_PREFIX}[a-f0-9]{${AUDIT_PATIENT_KEY_LENGTH}}$`);

export type AuditEventType = 'patient_open' | 'patient_edit' | 'handover_signed';

export interface AuditEvent {
  id: string; // UUID
  type: AuditEventType;
  at: string; // ISO 8601
  patientKey?: string; // token de correlacion estable, nunca nombre ni ID tecnico crudo
  userId: string; // ID del usuario autenticado
  unitId?: string; // unidad de enfermería
  shiftCode?: string; // ej. 'NIGHT', 'MORNING', 'AFTERNOON'
  meta?: Record<string, unknown>; // solo flags técnicos, nunca texto libre
}

export interface AuditStorage {
  load(): Promise<AuditEvent[]>;
  save(events: AuditEvent[]): Promise<void>;
  clear?: () => Promise<void>;
}

export interface MakeAuditEventInput {
  type: AuditEventType;
  patientId?: string; // entrada tecnica interna; se transforma a patientKey antes de persistir/enviar
  userId: string;
  unitId?: string;
  shiftCode?: string;
  meta?: Record<string, unknown>;
}

function normalizeAuditPatientId(patientId: string): string {
  const trimmed = patientId.trim();
  if (!trimmed) return '';
  if (AUDIT_PATIENT_KEY_PATTERN.test(trimmed)) return trimmed;
  if (trimmed.startsWith('Patient/')) {
    const normalized = trimmed.slice('Patient/'.length).trim();
    return normalized || trimmed;
  }
  return trimmed;
}

export function buildAuditPatientKey(patientId?: string): string | undefined {
  if (!patientId) return undefined;
  const normalized = normalizeAuditPatientId(patientId);
  if (!normalized) return undefined;
  if (AUDIT_PATIENT_KEY_PATTERN.test(normalized)) return normalized;
  return `${AUDIT_PATIENT_KEY_PREFIX}${hashHex(`handover.audit.patient.v1:${normalized}`, AUDIT_PATIENT_KEY_LENGTH)}`;
}

function assertSafeMeta(meta: Record<string, unknown> | undefined) {
  if (!meta) return;
  Object.values(meta).forEach((value) => {
    if (typeof value === 'string' && value.length > 100) {
      throw new Error('META_STRING_TOO_LONG');
    }
  });
}

export function makeAuditEvent(input: MakeAuditEventInput, now: () => Date = () => new Date()): AuditEvent {
  assertSafeMeta(input.meta);
  return {
    id: uuidv4(),
    type: input.type,
    at: now().toISOString(),
    patientKey: buildAuditPatientKey(input.patientId),
    userId: input.userId,
    unitId: input.unitId,
    shiftCode: input.shiftCode,
    meta: input.meta,
  };
}

export function groupByShift(events: AuditEvent[]): Record<string, AuditEvent[]> {
  return events.reduce<Record<string, AuditEvent[]>>((acc, event) => {
    const key = event.shiftCode?.trim() || 'UNKNOWN';
    if (!acc[key]) acc[key] = [];
    acc[key].push(event);
    return acc;
  }, {});
}

export interface PruneOptions {
  maxAgeDays: number;
  maxPerPatient?: number;
}

function parseDate(input: string): number | null {
  const timestamp = Date.parse(input);
  return Number.isFinite(timestamp) ? timestamp : null;
}

export function pruneOldEvents(events: AuditEvent[], options: PruneOptions): AuditEvent[] {
  const cutoffMs = Date.now() - options.maxAgeDays * 24 * 60 * 60 * 1000;
  const recent = events.filter((event) => {
    const at = parseDate(event.at);
    if (at == null) return false;
    return at >= cutoffMs;
  });

  if (!options.maxPerPatient || options.maxPerPatient <= 0) {
    return recent;
  }

  const perPatient = new Map<string, AuditEvent[]>();
  recent.forEach((event) => {
    const key = event.patientKey ?? '__unknown__';
    const current = perPatient.get(key) ?? [];
    current.push(event);
    perPatient.set(key, current);
  });

  const pruned: AuditEvent[] = [];
  perPatient.forEach((list) => {
    const sorted = list.sort((a, b) => {
      const timeA = parseDate(a.at) ?? 0;
      const timeB = parseDate(b.at) ?? 0;
      return timeB - timeA;
    });
    const limited = sorted.slice(0, options.maxPerPatient);
    pruned.push(...limited);
  });

  return pruned.sort((a, b) => {
    const timeA = parseDate(a.at) ?? 0;
    const timeB = parseDate(b.at) ?? 0;
    return timeA - timeB;
  });
}

export function createAsyncStorageAuditStorage(key = 'handover:audit:v1'): AuditStorage {
  let memoizedStorage: Awaited<ReturnType<typeof getAsyncStorageAdapter>> | null = null;
  let memoryCopy: AuditEvent[] | null = null;

  const getStorage = async () => {
    if (memoizedStorage) return memoizedStorage;
    memoizedStorage = await getAsyncStorageAdapter();
    return memoizedStorage;
  };

  return {
    async load(): Promise<AuditEvent[]> {
      const storage = await getStorage();
      if (!storage) {
        return memoryCopy ? [...memoryCopy] : [];
      }
      try {
        const raw = await encryptedGetItem(key, storage);
        if (!raw) return [];
        const parsed = JSON.parse(raw) as AuditEvent[];
        return Array.isArray(parsed) ? parsed : [];
      } catch {
        return [];
      }
    },
    async save(events: AuditEvent[]): Promise<void> {
      const storage = await getStorage();
      const serialized = JSON.stringify(events);
      if (!storage) {
        memoryCopy = [...events];
        return;
      }
      await encryptedSetItem(key, serialized, storage);
      memoryCopy = null;
    },
    async clear(): Promise<void> {
      const storage = await getStorage();
      if (!storage) {
        memoryCopy = [];
        return;
      }
      await encryptedRemoveItem(key, storage);
      memoryCopy = [];
    },
  };
}

export async function appendAuditEvent(storage: AuditStorage, event: AuditEvent): Promise<void> {
  const events = await storage.load();
  events.push(event);
  await storage.save(events);
}

export async function sendAuditEvent(event: AuditEvent): Promise<void> {
  try {
    await apiPost('/api/audit/', { body: JSON.stringify(event) });
  } catch (e: any) {
    const status = e?.status ?? e?.response?.status;

    // Auditoría nunca debe bloquear UX
    if (status === 401 || status === 403) return;

    // best-effort: no bloqueamos la app por fallos de red/offline/500/etc.
    return;
  }
}

export async function clearAuditStorage(key = 'handover:audit:v1'): Promise<void> {
  const storage = await getAsyncStorageAdapter();
  if (!storage) return;
  await encryptedRemoveItem(key, storage);
}

