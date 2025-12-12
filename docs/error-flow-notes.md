# Error handling notes (Bloque A)

## Flujo típico
- `HandoverForm` dispara `onSubmit` → construye bundle y llama `enqueueBundle` para cola offline.【F:src/screens/HandoverForm.tsx†L1054-L1155】
- El motor de sync (`processQueueOnce`/`runSyncCycle`) toma items `pending`, los marca `inFlight` y envía via `queueSendHandler` (por defecto `buildDefaultQueueSender`).【F:src/lib/sync.ts†L463-L535】【F:src/lib/sync.ts†L387-L445】
- `buildDefaultQueueSender` valida y hace `postBundle`, que usa `fetchFHIR` → `safeFetch` para la request real.【F:src/lib/sync.ts†L387-L444】【F:src/lib/fhir-client.ts†L290-L339】【F:src/lib/net.ts†L171-L259】

## Dónde se muestran alertas genéricas
- `HandoverForm` usa `Alert.alert('Error', message ?? 'No se pudo guardar')` en catch de `onSubmit` y en `handleInvalidSubmit` (fallback mensaje genérico).【F:src/screens/HandoverForm.tsx†L960-L968】【F:src/screens/HandoverForm.tsx†L1201-L1206】
- Otros alerts de error no genéricos: SBAR inválida, acceso a unidad, etc. (no cambian runtime).【F:src/screens/HandoverForm.tsx†L840-L847】【F:src/screens/HandoverForm.tsx†L1050-L1085】
- `SyncCenter` alerta con mensajes fijos cuando falta config o falla flush (`Alert.alert('Sync', ...)`).【F:src/screens/SyncCenter.tsx†L73-L88】

## Lanzamiento/propagación de errores
- `safeFetch` lanza `HTTPError` con `status` y `response`, o `TimeoutError`/`NetworkError` para timeouts/abort o fallos de fetch; el último mensaje es genérico y marca `isTransient`.【F:src/lib/net.ts†L171-L259】
- `fetchFHIR` intercepta `HTTPError` 401/403, llama `logout` y vuelve a lanzar `Error('unauthorized')` (pierde `status`). Otros `HTTPError` devuelven `{ ok:false, response, data, outcome }`. Excepciones no-HTTP se re-lanzan.【F:src/lib/fhir-client.ts†L314-L339】
- `postBundle` transforma errores en respuestas `{ ok:false, status, issues }`; captura excepciones y las traduce a status 401 o 400 según mensaje `unauthorized`.【F:src/lib/fhir-client.ts†L347-L445】
- `buildDefaultQueueSender` captura OperationOutcome fatal para marcar no recuperable; re-mapea errores a `{ ok:false, status?, message?, recoverable? }`. HTTPError se usa sólo para extraer `status`; resto se convierte en mensaje de `Error`.【F:src/lib/sync.ts†L387-L443】
- `processQueueOnce` guarda `errorMessage` en cola pero no muestra UI; recuperables se reintentan, fatales marcan `error`.【F:src/lib/sync.ts†L463-L535】

## Qué info lleva el error en cada punto
- En `HandoverForm` catch: sólo `Error.message` (puede ser `'unauthorized'`, `HTTP ${statusText}` o mensaje genérico). Status se pierde si se convirtió en `Error('unauthorized')` o `NetworkError` sin status.【F:src/screens/HandoverForm.tsx†L1201-L1206】【F:src/lib/fhir-client.ts†L314-L339】【F:src/lib/net.ts†L253-L255】
- En `buildDefaultQueueSender`: dispone de `status` y `message` de `postBundle` o `HTTPError`; distingue 401/403 para pausar sync, `fatal` OperationOutcome para no recuperar. Otros errores de red se marcan `recoverable` con mensaje genérico (sin status si faltaba).【F:src/lib/sync.ts†L387-L443】
- `processQueueOnce` sólo conserva `result.message` o `HTTP ${status}` en `errorMessage`; UI no la muestra salvo vía snapshot `lastError`.【F:src/lib/sync.ts†L463-L535】
- `SyncCenter` muestra sólo el `Error.message` capturado al reintentar (sin status).【F:src/screens/SyncCenter.tsx†L73-L88】

## Tipos de error actuales
- **Respuesta HTTP**: `HTTPError` con `status`/`statusText`; 401/403 se transforman a `Error('unauthorized')` antes de llegar a UI.【F:src/lib/fhir-client.ts†L314-L339】
- **Timeout/abort**: `TimeoutError` (transient) o `NetworkError('Request aborted')` si abort signal; pueden quedar como mensaje genérico al burbujear.【F:src/lib/net.ts†L171-L259】
- **Fallo de red fetch**: atrapado como `NetworkError('Network error', { isTransient:true })` al agotar reintentos.【F:src/lib/net.ts†L253-L255】
- **FHIR OperationOutcome**: `postBundle` propaga `issues`/`status` y `buildDefaultQueueSender` puede marcar como fatal; `HandoverForm` no consume esas issues directamente.【F:src/lib/fhir-client.ts†L347-L445】【F:src/lib/sync.ts†L387-L443】

## Estados/status que se pierden
- Status 401/403 se convierten en `Error('unauthorized')` antes de HandoverForm, perdiendo código específico en alertas.【F:src/lib/fhir-client.ts†L314-L339】
- Otros status (4xx/5xx) pasan como `HTTPError` hasta `postBundle`/`queueSendHandler`, pero UI final sólo muestra mensaje genérico, no el código.【F:src/lib/sync.ts†L387-L443】【F:src/screens/HandoverForm.tsx†L1201-L1206】
- `NetworkError`/`TimeoutError` pierden status (status undefined) al burbujear; UI no diferencia timeout vs sin conexión.【F:src/lib/net.ts†L244-L255】

## Mini-diagrama
```
HandoverForm submit
  -> enqueueBundle (offline queue)
    -> sync.processQueueOnce (pending item)
      -> queueSendHandler (default)
        -> postBundle
          -> fetchFHIR
            -> safeFetch (retry/timeout/HTTPError)
```

## Punto óptimo para mapear errores (propuesta)
- Centralizar en `buildDefaultQueueSender`/`postBundle` antes de devolver `QueueSendResult`, porque ahí se tiene: status HTTP, OperationOutcome, y se decide si es recuperable. Mapeando a códigos y mensajes UX aquí permitiría que `processQueueOnce` y la UI usen causas unificadas sin tocar `safeFetch` ni `HandoverForm`.
