// src/lib/sync.ts
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';
import {
  buildHandoverBundle,
  mapObservationVitals,
  type BuildOptions,
  type HandoverInput,
  type HandoverValues,
} from './fhir-map';
import { postBundleSmart } from './fhir-client';
import { z } from 'zod';

export type QueueItem = {
  id: string;
  createdAt: string;
  // payload: encolamos el bundle ya construido + metadatos
  payload: {
    patientId: string;
    // opcionalmente, dejamos el HandoverValues crudo para depurar
    values?: HandoverValues;
    bundle: any;
    authorId?: string;
  };
};

export type SenderResult = Response | { ok: boolean; status: number };

export type SendFn = (tx: QueueItem) => Promise<SenderResult>;

export type FlushCompatOptions = {
  sender?: SendFn;
  /**
   * Si se indica, intenta limpiar el borrador de este patientId cuando
   * el envío del Bundle termine en 201 Created / 200 OK o 412 Already exists.
   */
  onSent?: (input: { patientId: string }) => Promise<void> | void;
  /**
   * Pausa entre elementos, por si el backend prefiere no recibir ráfagas.
   */
  delayMs?: number;
};

/**
 * Utilidades simples para SecureStore:
 * - en Android usa un fallback sin encriptar si hace falta (dev/test)
 * - en iOS usa por defecto el almacenamiento seguro
 */
async function safeSetItemAsync(key: string, value: string) {
  try {
    await SecureStore.setItemAsync(key, value, {
      keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY,
    });
  } catch (e) {
    if (Platform.OS === 'android') {
      // En Android en modo dev algunas builds tiran con fallback
      (globalThis as any).__insecureKV ??= new Map<string, string>();
      (globalThis as any).__insecureKV.set(key, value);
      return;
    }
    throw e;
  }
}

async function safeGetItemAsync(key: string) {
  try {
    const v = await SecureStore.getItemAsync(key);
    if (v != null) return v;
  } catch (e) {
    if (Platform.OS !== 'android') throw e;
  }
  if (Platform.OS === 'android') {
    const map: Map<string, string> | undefined = (globalThis as any).__insecureKV;
    return map?.get(key) ?? null;
  }
  return null;
}

const UUID_V4_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isUuidV4(id: string) {
  return UUID_V4_RE.test(id);
}

function sleep(ms?: number) {
  return new Promise((r) => setTimeout(r, ms ?? 0));
}

const QUEUE_KEY = '@handover/tx-queue';
const PATIENT_IDENTIFIER_SYSTEM = 'urn:handover-pro:ids';
const OBS_IDENTIFIER_SYSTEM = 'urn:handover-pro:obs';

async function loadQueue(): Promise<QueueItem[]> {
  const s = await safeGetItemAsync(QUEUE_KEY);
  if (!s) return [];
  try {
    const arr = JSON.parse(s);
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

async function saveQueue(items: QueueItem[]) {
  await safeSetItemAsync(QUEUE_KEY, JSON.stringify(items));
}

/**
 * Encola un bundle ya construido (útil para reintentos fuera del form)
 */
type EnqueueBundleInput = {
  id?: string;
  patientId: string;
  bundle: any;
  values?: HandoverValues;
  authorId?: string;
};

function isRawBundleInput(value: unknown): value is { resourceType?: string; entry?: any[] } {
  return !!value && typeof value === 'object' && (value as any).resourceType === 'Bundle';
}

function extractPatientIdFromBundle(bundle: { entry?: any[] }): string | undefined {
  const entries = Array.isArray(bundle?.entry) ? bundle.entry : [];
  for (const entry of entries) {
    const resource = entry?.resource;
    if (resource?.resourceType !== 'Patient') continue;

    const identifiers = Array.isArray(resource?.identifier) ? resource.identifier : [];
    for (const identifier of identifiers) {
      if (
        identifier &&
        typeof identifier === 'object' &&
        identifier.system === PATIENT_IDENTIFIER_SYSTEM &&
        typeof identifier.value === 'string'
      ) {
        return identifier.value;
      }
    }

    if (typeof resource?.id === 'string' && resource.id.length > 0) {
      return resource.id;
    }

    if (typeof entry?.fullUrl === 'string' && entry.fullUrl.startsWith('urn:uuid:patient-')) {
      return entry.fullUrl.replace('urn:uuid:patient-', '');
    }
  }
  return undefined;
}

export async function enqueueBundle(input: EnqueueBundleInput | { resourceType: string; entry?: any[] }) {
  const normalized: EnqueueBundleInput = isRawBundleInput(input)
    ? {
        patientId: extractPatientIdFromBundle(input) ?? 'unknown',
        bundle: input,
      }
    : input;

  const id = normalized.id && isUuidV4(normalized.id) ? normalized.id : crypto.randomUUID();
  const it: QueueItem = {
    id,
    createdAt: new Date().toISOString(),
    payload: {
      patientId: normalized.patientId ?? 'unknown',
      bundle: normalized.bundle,
      values: normalized.values,
      authorId: normalized.authorId,
    },
  };
  const q = await loadQueue();
  q.push(it);
  await saveQueue(q);
  return it;
}

/**
 * Retorna el tamaño actual de la cola offline.
 * Usamos el origen real de la cola (loadQueue) para no acoplar a detalles internos.
 */
export async function getQueueSize(): Promise<number> {
  const items = await loadQueue();
  return items.length ?? 0;
}

// Alias de compatibilidad: algunos sitios importan flushQueueNow.
export const flushQueueNow = flushQueue;

/**
 * Crea y encola un Bundle de handover a partir de los valores del formulario.
 * Si falla la construcción/validación, lanza ZodError.
 */
export async function enqueueTxFromValues(
  values: HandoverValues,
  opts?: BuildOptions & { authorId?: string }
) {
  const patientId = values.patientId ?? 'unknown';
  const bundle = buildHandoverBundle(values as unknown as HandoverInput, {
    now: opts?.now,
    normalizeGlucoseToMgdl: opts?.normalizeGlucoseToMgdl,
    glucoseDecimals: opts?.glucoseDecimals,
    emitPanel: opts?.emitPanel,
    emitHasMember: opts?.emitHasMember,
    emitBpPanel: opts?.emitBpPanel,
    profileUrls: opts?.profileUrls,
    // cualquier otra opción que tengas añadida al tipo BuildOptions
  });

  return enqueueBundle({
    patientId,
    bundle,
    values,
    authorId: opts?.authorId,
  });
}

/**
 * Envía la cola con un "sender" (por defecto usa postBundleSmart)
 * - 201/200: éxito → elimina el elemento
 * - 412: duplicado → considera éxito lógico y elimina el elemento
 * - Otros: deja el elemento para reintento y sigue con el siguiente
 */
export async function flushQueue(opts?: FlushCompatOptions) {
  const sender: SendFn =
    opts?.sender ??
    (async (tx) => {
      const { bundle } = tx.payload ?? {};
      return postBundleSmart(bundle);
    });

  let queue = await loadQueue();
  if (queue.length === 0) return { total: 0, sent: 0, skipped: 0 };

  let sent = 0;
  let skipped = 0;

  for (const tx of queue) {
    try {
      const res = await sender(tx);
      const status = 'status' in res ? res.status : (res as Response)?.status;

      if (res.ok || status === 201 || status === 200) {
        // éxito
        sent++;
        // limpia de la cola
        queue = (await loadQueue()).filter((it) => it.id !== tx.id);
        await saveQueue(queue);
        // callback opcional para limpiar borradores
        const patientId = tx.payload?.patientId ?? 'unknown';
        await opts?.onSent?.({ patientId });
      } else if (status === 412) {
        // duplicado, lo consideramos éxito para no bloquear
        skipped++;
        queue = (await loadQueue()).filter((it) => it.id !== tx.id);
        await saveQueue(queue);
        const patientId = tx.payload?.patientId ?? 'unknown';
        await opts?.onSent?.({ patientId });
      } else {
        // otro error → se mantiene en cola
      }
    } catch {
      // error de red o del sender → no eliminar, dejar para reintento
    }

    if (opts?.delayMs && opts.delayMs > 0) {
      await sleep(opts.delayMs);
    }
  }

  return { total: sent + skipped + queue.length, sent, skipped };
}

/**
 * Compatibilidad con tests: función "flush" que delega en flushQueue.
 */
export async function flush(
  sender?: SendFn | FlushCompatOptions,
  clearDraft?: ((patientId: string) => Promise<void> | void) | { baseDelayMs?: number },
  legacyOptions?: { baseDelayMs?: number },
) {
  if (typeof sender === 'object' && sender !== null && !('length' in sender)) {
    return flushQueue(sender as FlushCompatOptions);
  }

  const actualSender = typeof sender === 'function' ? sender : undefined;

  let onSent: FlushCompatOptions['onSent'] | undefined;
  let delayMs: number | undefined;

  if (typeof clearDraft === 'function') {
    onSent = async ({ patientId }) => {
      await clearDraft(patientId);
    };
  } else if (clearDraft && typeof clearDraft === 'object') {
    delayMs = clearDraft.baseDelayMs;
  }

  if (legacyOptions && typeof legacyOptions.baseDelayMs === 'number') {
    delayMs = legacyOptions.baseDelayMs;
  }

  return flushQueue({ sender: actualSender, onSent, delayMs });
}

/**
 * Construye un Bundle type=transaction con entradas binarias + conditional create
 * para Observations/Patient, según lo que hay encolado.
 * (Útil para suites de test que quieran inspeccionar la forma del bundle
 * que termina llegando al sender.)
 */
export function buildTransactionBundleForQueue(
  input: HandoverInput | HandoverValues,
  opts: BuildOptions = {},
) {
  const isWrapped = typeof input === 'object' && input !== null && 'values' in (input as HandoverInput);
  const values: HandoverValues = isWrapped ? (input as HandoverInput).values : (input as HandoverValues);

  const patientIdRaw = values.patientId;
  const patientId = patientIdRaw ?? 'unknown';
  if (!patientIdRaw) {
    return { resourceType: 'Bundle', type: 'transaction', entry: [] };
  }

  const nowSource = opts.now ?? new Date();
  const nowIso = typeof nowSource === 'string' ? nowSource : nowSource.toISOString();
  const patientFullUrl = `urn:uuid:patient-${patientId}`;
  const baseDate = nowIso.slice(0, 10);

  const observationOptions: BuildOptions = {
    now: nowSource,
    emitIndividuals: opts.emitIndividuals,
    normalizeGlucoseToMgDl: opts.normalizeGlucoseToMgDl,
    normalizeGlucoseToMgdl: opts.normalizeGlucoseToMgdl,
    glucoseDecimals: opts.glucoseDecimals,
  };

  const observations = mapObservationVitals(values, observationOptions);

  const entries: Array<{
    fullUrl: string;
    resource: any;
    request: { method: string; url: string; ifNoneExist?: string };
  }> = [];

  entries.push({
    fullUrl: patientFullUrl,
    resource: {
      resourceType: 'Patient',
      identifier: [{ system: PATIENT_IDENTIFIER_SYSTEM, value: patientId }],
    },
    request: {
      method: 'POST',
      url: 'Patient',
      ifNoneExist: `identifier=${encodeURIComponent(PATIENT_IDENTIFIER_SYSTEM)}|${encodeURIComponent(patientId)}`,
    },
  });

  observations.forEach((obs, index) => {
    const cloned = JSON.parse(JSON.stringify(obs ?? {}));
    cloned.subject = { reference: patientFullUrl };

    const loinc = Array.isArray(cloned?.code?.coding)
      ? cloned.code.coding.find((c: any) => c?.system === 'http://loinc.org')?.code
      : undefined;

    const effective = typeof cloned.effectiveDateTime === 'string' && cloned.effectiveDateTime.length
      ? cloned.effectiveDateTime
      : nowIso;
    const effectiveDate = effective.slice(0, 10) || baseDate;

    const identifierParts = [loinc, effectiveDate, patientId].filter(Boolean);
    if (identifierParts.length > 0) {
      const identifierValue = identifierParts.join('|');
      const existing = Array.isArray(cloned.identifier) ? cloned.identifier : [];
      cloned.identifier = [
        ...existing.filter((it: any) => it && typeof it === 'object'),
        { system: OBS_IDENTIFIER_SYSTEM, value: identifierValue },
      ];
    }

    const ifNoneParts: string[] = [];
    if (identifierParts.length > 0) {
      const identifierValue = identifierParts.join('|');
      ifNoneParts.push(
        `identifier=${encodeURIComponent(OBS_IDENTIFIER_SYSTEM)}|${encodeURIComponent(identifierValue)}`,
      );
    }

    ifNoneParts.push(`patient=${encodeURIComponent(patientFullUrl)}`);

    if (loinc) {
      ifNoneParts.push(`code=${encodeURIComponent('http://loinc.org')}|${encodeURIComponent(loinc)}`);
    }

    ifNoneParts.push(`effective=eq${effectiveDate}`);

    const fullUrl = `urn:uuid:obs-${loinc ?? 'custom'}-${patientId}-${effectiveDate}-${index}`;

    entries.push({
      fullUrl,
      resource: cloned,
      request: {
        method: 'POST',
        url: 'Observation',
        ifNoneExist: ifNoneParts.join('&'),
      },
    });
  });

  return {
    resourceType: 'Bundle',
    type: 'transaction',
    entry: entries,
  };
}

/**
 * Devuelve el estado actual de la cola (para debug / UI).
 */
export async function readQueueState() {
  const items = await loadQueue();
  return {
    size: items.length,
    items,
  };
}

/**
 * Borra por completo la cola (utilidad de depuración)
 */
export async function clearQueue() {
  await saveQueue([]);
}

/**
 * Encola desde un HandoverInput minimal, usado en pruebas de integración o
 * cuando ya tienes los valores sueltos (no desde el form).
 */
export async function enqueueTx(
  input: HandoverInput | HandoverValues,
  opts?: BuildOptions & { authorId?: string },
) {
  if (input && typeof input === 'object' && 'values' in (input as HandoverInput)) {
    return enqueueTxFromValues((input as HandoverInput).values, opts);
  }
  if (typeof input !== 'object' || input === null || !('patientId' in input) || !(input as any).patientId) {
    throw new Error('patientId required');
  }
  const values: HandoverValues = input as any;
  return enqueueTxFromValues(values, opts);
}

/**
 * Validación rápida (útil en tests) para asegurar que el input del handover
 * al menos tiene patientId o patient.id
 */
export function validateHandoverInput(input: unknown) {
  const S = z
    .object({
      patientId: z.string().optional(),
      patient: z.object({ id: z.string().optional() }).optional(),
    })
    .strict();
  return S.parse(input);
}

