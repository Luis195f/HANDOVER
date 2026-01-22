# Offline y cola de sincronización

## safeFetch y reintentos
- `src/lib/net.ts` implementa `safeFetch`: fuerza HTTPS en producción, aplica timeouts y reintentos con backoff ante errores 502/503/504, y agrega cabeceras de idempotencia para evitar duplicados.

## Cola y sincronización
- `src/lib/queue.ts` genera bundles con UUID y los persiste en SQLite junto con metadatos de reintento.
- `src/lib/sync.ts` detecta conectividad, reintenta envíos con backoff exponencial (`getNextDelayMs`) y elimina items exitosos; reutiliza el cliente FHIR para manejar `OperationOutcome`.
- El almacenamiento puede cifrarse; `EXPO_PUBLIC_OFFLINE_ENCRYPTION_DISABLED` permite desactivar el cifrado en desarrollo.
  - Cada item conserva `firstEnqueuedAt`, `lastAttemptAt` y `attemptCount`/`attempts` para calcular ventanas de reintento.
  - Se respeta un máximo de reintentos (`EXPO_PUBLIC_OFFLINE_REPLAY_MAX_ATTEMPTS`, default 3). Al superar el límite, el item queda con `syncStatus="error"`.

## Cifrado de la cola offline
- Los bundles FHIR almacenados en la cola SQLite se guardan cifrados por defecto usando cifrado simétrico con AEAD (AES-256-GCM vía `@noble/ciphers` + `expo-crypto`).
- Solo se cifra el payload clínico (bundle FHIR); los metadatos de la cola (estado, timestamps, código de respuesta) permanecen en claro para facilitar el debugging y el control de flujo.
- Formato de almacenamiento de los nuevos sobres (`EncryptedEnvelopeV1`, gestionado por `src/lib/crypto.ts`):

  ```json
  {
    "v": 1,
    "algo": "AES-256-GCM",
    "iv": "<base64>",
    "tag": "<base64>",
    "ct": "<base64>"
  }
  ```

- Compatibilidad hacia atrás:
  - JSON plano heredado (colas antiguas sin cifrado) se sigue leyendo sin cambios.
  - Sobres `enc:v1` previos de la cola offline se descifran con `security/crypto`.
  - Los nuevos sobres AES-GCM (`EncryptedEnvelopeV1`) se manejan en `src/lib/crypto.ts`.
  - En todos los casos, `queue.ts` y `sync.ts` trabajan con JSON en claro tras leer el item.
- Consideraciones de seguridad:
  - El cifrado offline refuerza la protección de datos en reposo (alineado con buenas prácticas RGPD/HIPAA, sin suponer cumplimiento legal automático).
  - La clave derivada de `EXPO_PUBLIC_OFFLINE_ENCRYPTION_KEY` es el secreto real y debe gestionarse como un secreto sensible.

## WebCrypto y polyfills
- El cliente usa `expo-crypto` para hashing y generación de bytes aleatorios; no se añade un polyfill global de `crypto` en tiempo de ejecución.
- La firma ECDSA del bundle FHIR (si `EXPO_PUBLIC_CLIENT_SIGNING_ENABLED=true`) depende de `globalThis.crypto.subtle` cuando está disponible.
- Si WebCrypto no existe (por ejemplo, web/entornos restringidos), la firma cliente se omite y la cola continúa enviando sin firma, dejando registro en logs estructurados.

## Interfaz de usuario
- `src/screens/SyncCenter.tsx` permite inspeccionar, reintentar o vaciar la cola manualmente. Los elementos con `syncStatus="error"` muestran un badge “Error”, diferencian `422 Error de validación FHIR` del resto de fallos, y ofrecen un botón “Ver error” que abre un alert con el mensaje y, si existe, un detalle de issues (`expression` + `diagnostics`) devuelto por el servidor.

## Variables relacionadas
- `EXPO_PUBLIC_OFFLINE_REPLAY_MAX_ATTEMPTS`: número máximo de reintentos.
- `EXPO_PUBLIC_QUEUE_BACKOFF_BASE`: base del backoff exponencial.
- `EXPO_PUBLIC_OFFLINE_ENCRYPTION_KEY`: semilla para derivar la clave simétrica (256 bits) del cifrado offline. Debe tener al menos 32 caracteres y gestionarse como secreto (vault/CI/CD), no en texto plano.
- `EXPO_PUBLIC_OFFLINE_ENCRYPTION_DISABLED`: feature flag para desactivar el cifrado offline (solo debugging local). Valores `true/1/TRUE` lo desactivan; cualquier otro valor lo mantiene activo por defecto.

## Validación rápida antes de encolar
- `EXPO_PUBLIC_FAST_VALIDATE_BEFORE_QUEUE` (por defecto `false`) activa una validación remota previa (`Bundle/$validate`) siempre que haya conectividad. Si el servidor responde con un `OperationOutcome` severidad `error` o `fatal`, la app muestra un alert con `formatIssuesForUser(...)` y no encola el bundle; sin conectividad, la cola sigue funcionando en modo offline-first. Se recomienda habilitarlo en staging/producción para atrapar errores estructurales antes de saturar la cola.

## Estado de sincronización
- La sync expone `SyncSnapshot` (`status`, `pendingCount`, `lastRunAt`, `lastError`, `nextRetryAt`).
- Estados posibles:
  - `idle`: sin trabajos pendientes o esperando nuevas órdenes.
  - `running`: procesando la cola.
  - `backoff`: esperando el próximo reintento (por ejemplo tras 5xx o sin red).
  - `paused`: bloqueado por autenticación (401/403) hasta re-login o `resumeSync()`.
