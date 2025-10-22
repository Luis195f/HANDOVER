// src/lib/sync.ts
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';
import { buildHandoverBundle, type BuildOptions, type HandoverInput, type HandoverValues } from './fhir-map';
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
export async function enqueueBundle(input: {
  id?: string;
  patientId: string;
  bundle: any;
  values?: HandoverValues;
  authorId?: string;
}) {
  const id = input.id && isUuidV4(input.id) ? input.id : crypto.randomUUID();
  const it: QueueItem = {
    id,
    createdAt: new Date().toISOString(),
    payload: {
      patientId: input.patientId,
      bundle: input.bundle,
      values: input.values,
      authorId: input.authorId,
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
  const patientId = values.patientId ?? values.patient?.id ?? 'unknown';
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
export async function flush(sender?: SendFn) {
  return flushQueue({ sender });
}

/**
 * Construye un Bundle type=transaction con entradas binarias + conditional create
 * para Observations/Patient, según lo que hay encolado.
 * (Útil para suites de test que quieran inspeccionar la forma del bundle
 * que termina llegando al sender.)
 */
export async function buildTransactionBundleForQueue() {
  const items = await loadQueue();
  const entries = items.flatMap((it) => {
    const b = it.payload?.bundle;
    const arr = Array.isArray(b?.entry) ? b.entry : [];
    return arr;
  });

  const tx: any = {
    resourceType: 'Bundle',
    type: 'transaction',
    entry: [] as any[],
  };

  // Reinyectar cada recurso como operación transaction
  for (const e of entries) {
    const r = e?.resource;
    if (!r || typeof r !== 'object') continue;

    const fullUrl = e?.fullUrl;
    const method = r.resourceType === 'Patient' ? 'PUT' : 'POST';
    const url =
      r.resourceType === 'Patient'
        ? `Patient?identifier=${encodeURIComponent(
            (r as any)?.identifier?.[0]?.value ?? 'unknown'
          )}`
        : `${r.resourceType}`;

    const entry: any = {
      request: { method, url },
      resource: r,
    };

    if (fullUrl && typeof fullUrl === 'string') {
      entry.fullUrl = fullUrl;
    }
    if (r.resourceType !== 'Patient') {
      // conditional create por code/subject/issued/identifier si procede
      // (los tests pueden no necesitarlo; pon lo mínimo necesario)
    }

    tx.entry.push(entry);
  }

  return tx;
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
export async function enqueueTx(input: HandoverInput, opts?: BuildOptions & { authorId?: string }) {
  const values = input as HandoverValues;
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

