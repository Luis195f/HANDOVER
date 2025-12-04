# Offline y cola de sincronización

## safeFetch y reintentos
- `src/lib/net.ts` implementa `safeFetch`: fuerza HTTPS en producción, aplica timeouts y reintentos con backoff ante errores 502/503/504, y agrega cabeceras de idempotencia para evitar duplicados.

## Cola y sincronización
- `src/lib/queue.ts` genera bundles con UUID y los persiste en SQLite junto con metadatos de reintento.
- `src/lib/sync.ts` detecta conectividad, reintenta envíos y elimina items exitosos; reutiliza el cliente FHIR para manejar `OperationOutcome`.
- El almacenamiento puede cifrarse; `EXPO_PUBLIC_OFFLINE_ENCRYPTION_DISABLED` permite desactivar el cifrado en desarrollo.

## Interfaz de usuario
- `src/screens/SyncCenter.tsx` permite inspeccionar, reintentar o vaciar la cola manualmente.

## Variables relacionadas
- `EXPO_PUBLIC_OFFLINE_REPLAY_MAX_ATTEMPTS`: número máximo de reintentos.
- `EXPO_PUBLIC_QUEUE_BACKOFF_BASE`: base del backoff exponencial.
- `EXPO_PUBLIC_OFFLINE_ENCRYPTION_DISABLED`: desactiva cifrado en desarrollo.

## Estado de sincronización
- La sync expone `SyncSnapshot` (`status`, `pendingCount`, `lastRunAt`, `lastError`, `nextRetryAt`).
- Estados posibles:
  - `idle`: sin trabajos pendientes o esperando nuevas órdenes.
  - `running`: procesando la cola.
  - `backoff`: esperando el próximo reintento (por ejemplo tras 5xx o sin red).
  - `paused`: bloqueado por autenticación (401/403) hasta re-login o `resumeSync()`.
