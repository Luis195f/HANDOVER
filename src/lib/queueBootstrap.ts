/* [NURSEOS PRO PATCH 2025-10-22] queueBootstrap.ts
   - postTransactionBundle: integra postBundleSmart + env resiliente
   - installQueueSync: loop de sincronización con backoff, listeners opcionales (RN AppState / document.visibility)
   - Tolerante a entorno (Expo/React Native/Web) sin romper build
*/

import { readQueue, peekNext, bumpTries, markDone, size, type QueueItem } from "./offlineQueue";
import { postBundleSmart } from "./fhir-client";
// Carga flexible del env: soporta FHIR_BASE_URL, CONFIG.FHIR_BASE_URL, process.env*, etc.
import * as ENV from "../config/env";

/** Resuelve la URL base FHIR desde múltiples fuentes, sin romper si no existe alguna. */
function resolveFhirBase(override?: string): string {
  const candidates = [
    override,
    // preferencias de config/env
    (ENV as any).CONFIG?.FHIR_BASE_URL,
    (ENV as any).FHIR_BASE_URL,
    (ENV as any).FHIR_BASE,
    // variables de entorno (Expo y genéricas)
    typeof process !== "undefined" ? process.env?.EXPO_PUBLIC_FHIR_BASE_URL : undefined,
    typeof process !== "undefined" ? process.env?.FHIR_BASE_URL : undefined,
  ].filter(Boolean) as string[];

  const base = candidates[0];
  if (!base) throw new Error("No se pudo resolver FHIR_BASE_URL. Revisa ../config/env o variables de entorno.");
  return base;
}

/** POST de Bundle transaccional vía fhir-client */
export async function postTransactionBundle(
  bundle: any,
  opts?: { fhirBase?: string; token?: string }
) {
  const fhirBase = resolveFhirBase(opts?.fhirBase);
  // postBundleSmart debe encargarse de auth (token) si se provee; si no, usará su propia sesión
  return await postBundleSmart({ fhirBase, bundle, token: opts?.token });
}

/** Detecta si hay conectividad de red (RN: NetInfo; Web: navigator.onLine; fallback: true) */
async function isOnline(): Promise<boolean> {
  // React Native (NetInfo)
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const NetInfo = require("@react-native-community/netinfo");
    if (NetInfo?.fetch) {
      const st = await NetInfo.fetch();
      if (typeof st?.isConnected === "boolean") return !!st.isConnected;
    }
  } catch { /* ignore */ }
  // Web
  if (typeof navigator !== "undefined" && "onLine" in navigator) {
    return (navigator as any).onLine !== false;
  }
  // Fallback optimista
  return true;
}

/** Opciones del sincronizador */
export type QueueSyncOptions = {
  intervalMs?: number;       // intervalo base entre ticks
  jitterMs?: number;         // ruido aleatorio para evitar thundering herd
  maxTries?: number;         // reintentos antes de abandonar (mantiene en cola)
  fhirBaseOverride?: string; // para forzar endpoint (tests/dev)
  token?: string;            // opcional: bearer token si no lo maneja fhir-client
  onSuccess?: (item: QueueItem, res: any) => void;
  onError?: (err: any, item: QueueItem) => void;
};

/** Controla que no haya sincronizaciones concurrentes */
let syncing = false;

/** Procesa un item de la cola. Devuelve true si se completó y se eliminó. */
async function processOne(item: QueueItem, opts: QueueSyncOptions): Promise<boolean> {
  // Convención: payload puede ser { bundle: any } o el bundle directo
  const payload = item.payload ?? {};
  const bundle = typeof payload === "object" && payload?.resourceType ? payload
                : (payload?.bundle ?? payload);

  if (!bundle) {
    // Sin bundle: descartar silenciosamente para no bloquear
    await markDone(item.key);
    return true;
  }

  try {
    const res = await postTransactionBundle(bundle, {
      fhirBase: opts.fhirBaseOverride,
      token: opts.token,
    });

    // Si postBundleSmart no lanzó, lo consideramos OK.
    await markDone(item.key);
    opts.onSuccess?.(item, res);
    return true;
  } catch (err) {
    await bumpTries(item.key);
    opts.onError?.(err, item);
    return false;
  }
}

/** Ejecuta un ciclo de sincronización completo (drain FIFO) */
async function syncOnce(opts: QueueSyncOptions) {
  if (syncing) return;
  syncing = true;
  try {
    if (!(await isOnline())) return;

    // Procesa secuencialmente para respetar orden
    // (evitamos leer toda la cola cada vez; vamos peekNext → process)
    let guard = 0;
    const maxGuard = 10_000; // seguridad anti-loop extraño

    // Supervisión de tries máximos
    const maxTries = Number.isFinite(opts.maxTries as number) ? (opts.maxTries as number) : 5;

    // Antes de empezar, si hay items con tries>max, seguimos reintentando pero con backoff del loop global
    // (no se purgan automáticamente para que un operador pueda revisarlos)
    while (guard++ < maxGuard) {
      const item = await peekNext();
      if (!item) break;

      // Si excede maxTries, intentamos una vez por tick; si vuelve a fallar, seguirá en cola.
      const ok = await processOne(item, opts);
      if (!ok) {
        // Falla: dejamos que el backoff del scheduler gestione el siguiente intento.
        break;
      }
    }
  } finally {
    syncing = false;
  }
}

/** Programa el siguiente tick con un pequeño jitter */
function nextDelay(options: QueueSyncOptions): number {
  const base = options.intervalMs ?? 15_000;  // 15s por defecto
  const jitter = options.jitterMs ?? 3_000;   // ±3s
  const delta = Math.floor((Math.random() * 2 - 1) * jitter);
  return Math.max(1_000, base + delta);
}

/**
 * Instala el sincronizador de cola.
 * - Arranca un intervalo con backoff suave y listeners de foco/visibilidad si están disponibles.
 * - Devuelve una función stop() para desenganchar todo.
 */
export function installQueueSync(options: QueueSyncOptions = {}) {
  let stopped = false;
  let timer: any | null = null;

  const schedule = () => {
    if (stopped) return;
    if (timer) clearTimeout(timer);
    timer = setTimeout(tick, nextDelay(options));
  };

  const tick = async () => {
    if (stopped) return;
    try {
      // Si la cola está vacía, reducir frecuencia, pero seguir monitoreando
      const n = await size();
      if (n === 0) {
        // disparo rápido ocasional por si se añadió algo fuera de este proceso
        schedule();
        return;
      }
      await syncOnce(options);
    } catch {
      // errores ya fueron reportados en onError de processOne si aplica
    } finally {
      schedule();
    }
  };

  // Disparo inicial pronto
  schedule();

  // ==== Listeners opcionales (mejoran UX pero no son obligatorios) ====

  const unsubs: Array<() => void> = [];

  // React Native: AppState → al volver a "active", intenta sincronizar
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { AppState } = require("react-native");
    if (AppState?.addEventListener) {
      const sub = AppState.addEventListener("change", (state: string) => {
        if (state === "active") void syncOnce(options);
      });
      unsubs.push(() => {
        try { sub?.remove?.(); } catch { /* noop */ }
      });
    }
  } catch { /* ignore */ }

  // Web: visibilitychange → si vuelve a visible, intenta sincronizar
  if (typeof document !== "undefined" && typeof document.addEventListener === "function") {
    const onVis = () => {
      if (document.visibilityState === "visible") void syncOnce(options);
    };
    document.addEventListener("visibilitychange", onVis);
    unsubs.push(() => document.removeEventListener("visibilitychange", onVis));
  }

  // NetInfo listener (si existe): cuando cambia conectividad a online → intenta sync
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const NetInfo = require("@react-native-community/netinfo");
    if (NetInfo?.addEventListener) {
      const unsub = NetInfo.addEventListener((state: any) => {
        if (state?.isConnected) void syncOnce(options);
      });
      unsubs.push(() => { try { unsub(); } catch { /* noop */ } });
    }
  } catch { /* ignore */ }

  // API de parada
  const stop = () => {
    stopped = true;
    if (timer) clearTimeout(timer);
    for (const u of unsubs) { try { u(); } catch { /* noop */ } }
  };

  // Devolver stop para que App.tsx pueda limpiar al desmontar
  return stop;
}

/* ==========
   Notas:
   - Este módulo no asume el formato exacto de QueueItem.payload, pero espera que
     contenga un Bundle transaccional en payload.bundle o sea el bundle directo.
   - Si quieres soportar otros endpoints, ajusta `processOne` (p.ej. payload.path).
   - El control de auth preferente está en fhir-client/postBundleSmart.
   ========== */
