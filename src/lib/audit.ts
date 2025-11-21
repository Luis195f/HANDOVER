import { v4 as uuidv4 } from 'uuid';

export type AuditEventType = 'patient_open' | 'patient_edit';

export interface AuditEvent {
  id: string; // UUID
  type: AuditEventType;
  at: string; // ISO 8601
  patientId?: string; // ID pseudonimizado, nunca nombre
  userId: string; // ID del usuario autenticado
  unitId?: string; // unidad de enfermería
  shiftCode?: string; // ej. 'NIGHT', 'MORNING', 'AFTERNOON'
  meta?: Record<string, unknown>; // solo flags técnicos, nunca texto libre
}

export interface AuditStorage {
  load(): Promise<AuditEvent[]>;
  save(events: AuditEvent[]): Promise<void>;
}

export interface MakeAuditEventInput {
  type: AuditEventType;
  patientId?: string;
  userId: string;
  unitId?: string;
  shiftCode?: string;
  meta?: Record<string, unknown>;
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
    patientId: input.patientId,
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
    const key = event.patientId ?? '__unknown__';
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

async function getAsyncStorage(): Promise<{ getItem: (key: string) => Promise<string | null>; setItem: (key: string, value: string) => Promise<void> } | null> {
  try {
    const mod = await import('@react-native-async-storage/async-storage');
    const storage = (mod as unknown as { default?: { getItem: (key: string) => Promise<string | null>; setItem: (key: string, value: string) => Promise<void> } }).default ?? (mod as unknown as { getItem?: (key: string) => Promise<string | null>; setItem?: (key: string, value: string) => Promise<void> });
    if (storage?.getItem && storage?.setItem) return storage;
    return null;
  } catch {
    return null;
  }
}

export function createAsyncStorageAuditStorage(key = 'handover:audit:v1'): AuditStorage {
  let memoizedStorage: Awaited<ReturnType<typeof getAsyncStorage>> | null = null;
  let memoryCopy: AuditEvent[] | null = null;

  const getStorage = async () => {
    if (memoizedStorage) return memoizedStorage;
    memoizedStorage = await getAsyncStorage();
    return memoizedStorage;
  };

  return {
    async load(): Promise<AuditEvent[]> {
      const storage = await getStorage();
      if (!storage) {
        return memoryCopy ? [...memoryCopy] : [];
      }
      try {
        const raw = await storage.getItem(key);
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
      await storage.setItem(key, serialized);
      memoryCopy = null;
    },
  };
}

export async function appendAuditEvent(storage: AuditStorage, event: AuditEvent): Promise<void> {
  const events = await storage.load();
  events.push(event);
  await storage.save(events);
}
