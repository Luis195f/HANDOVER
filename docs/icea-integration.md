# Integracion ICEA+ service-to-service

## Resumen del flujo real

Tras un `POST /api/fhir/transaction` exitoso, HANDOVER:

1. confirma primero la transaccion clinica contra FHIR;
2. genera un payload tecnico minimo para ICEA+;
3. persiste un evento en `IceaOutboundEvent`;
4. intenta la entrega S2S de forma best-effort y desacoplada.

Si ICEA+ falla, la transaccion clinica **no se revierte**. El outbox queda auditable y recuperable mediante reintentos o `flush_icea_outbox`.

## Capa dedicada ICEA

El contrato S2S queda encapsulado en:

- `backend/api/icea_client.py`: firma HMAC, JSON canonico, headers, validacion de configuracion, parseo de respuesta, errores tipados y politica de retryable status codes.
- `backend/api/icea.py`: construccion del payload tecnico desde el Bundle FHIR, persistencia del outbox y orquestacion de entrega/reintentos.

## Variables de entorno

```env
ICEA_WEBHOOK_ENABLED=true
ICEA_WEBHOOK_URL=https://icea.example/api/v1/pipeline/ingest/
ICEA_WEBHOOK_SECRET=<shared-secret>
ICEA_WEBHOOK_TIMEOUT_MS=2500
ICEA_WEBHOOK_RETRY_MAX=5
ICEA_WEBHOOK_ANTI_REPLAY=false
ICEA_WEBHOOK_REPLAY_WINDOW_SECONDS=300
ICEA_WEBHOOK_RETRYABLE_STATUS_CODES=408,409,425,429,500,502,503,504
```

## Validaciones de configuracion

Cuando `ICEA_WEBHOOK_ENABLED=true`, HANDOVER exige:

- `ICEA_WEBHOOK_URL` presente.
- `ICEA_WEBHOOK_SECRET` presente y con longitud minima razonable.
- HTTPS obligatorio fuera de `DEBUG` y tests.

Si la configuracion es invalida, el guardado clinico sigue adelante, pero el outbox queda en `retry` o `failed` con `last_error` explicito para recovery posterior.

## Payload enviado a ICEA+

Payload minimo:

```json
{
  "bundleId": "bundle-tx-001",
  "patientId": "pat-001",
  "unitId": "icu-a",
  "timestamp": "2026-03-07T12:00:00Z",
  "requestId": "tx-icea-001",
  "source": "HANDOVER"
}
```

Campos opcionales cuando existen en el Bundle:

```json
{
  "encounterId": "enc-001",
  "compositionId": "comp-001",
  "bundleIdentifier": "bundle-tx-001"
}
```

## Serializacion y firma

HANDOVER serializa el body con JSON canonico:

- `sort_keys=True`
- `separators=(",", ":")`
- UTF-8

Headers S2S:

```http
Content-Type: application/json
Idempotency-Key: <requestId>
X-ICEA-Signature: sha256=<hexdigest>
```

Si `ICEA_WEBHOOK_ANTI_REPLAY=true`, se anaden tambien:

```http
X-ICEA-Timestamp: <epochSeconds>
X-ICEA-Nonce: <uuid>
```

En ese modo la firma se calcula sobre:

```text
timestamp + "." + nonce + "." + raw_body
```

## Outbox local y estados

Modelo: `backend/api/models.py::IceaOutboundEvent`

Campos relevantes:

- `request_id`: identificador local unico de la operacion.
- `idempotency_key`: valor enviado en header; hoy coincide con `request_id`.
- `status`: `queued`, `retry`, `delivered`, `failed`.
- `attempts`: numero de intentos HTTP reales.
- `last_error`: ultimo error sanitizado.
- `last_http_status`: ultimo status HTTP recibido.
- `created_at`: creacion del evento.
- `last_attempt_at`: ultimo intento de entrega.
- `next_retry_at`: siguiente intento planificado.
- `delivered_at`: confirmacion de entrega 2xx.

Semantica:

- `queued`: pendiente inicial o listo para envio.
- `retry`: fallo recuperable o bloqueo temporal de configuracion.
- `delivered`: ICEA+ respondio 2xx.
- `failed`: fallo terminal; requiere `flush_icea_outbox --force` o reproceso explicito.

## Politica de reintentos

- Backoff exponencial local: 30s, 60s, 120s... hasta 30 min maximo.
- Status retryables por defecto: `408, 409, 425, 429, 500, 502, 503, 504`.
- Errores de transporte `httpx` tambien se consideran retryables.
- Los errores no retryables dejan el evento en `failed`.

Comando operativo:

```bash
python manage.py flush_icea_outbox --limit 100
python manage.py flush_icea_outbox --force --limit 100
```

`--force` incluye eventos en `failed`.

## Idempotencia y deduplicacion

Reglas actuales:

- La deduplicacion local del outbox se hace por `request_id` unico.
- El mismo valor se reutiliza como `Idempotency-Key` hacia ICEA+.
- Si llega el mismo `request_id` otra vez, HANDOVER no crea un segundo evento outbox ni vuelve a disparar la entrega ICEA.
- ICEA+ debe deduplicar por `Idempotency-Key` en receptor.

## Errores tipados en la capa cliente

`backend/api/icea_client.py` usa errores tipados:

- `IceaClientConfigurationError`
- `IceaTransportError`
- `IceaHTTPStatusError`

Eso permite distinguir:

- error de configuracion local,
- error de red/transporte,
- rechazo HTTP de ICEA+.

## Observabilidad y auditoria segura

HANDOVER no registra:

- PHI del Bundle clinico,
- payload crudo a ICEA+,
- secretos compartidos,
- tokens.

Los logs usan `safe_icea_event_summary(...)` y exponen solo:

- `request_id`
- `idempotency_key`
- hashes truncados de `bundle_id`, `patient_id`, `unit_id`
- `status`, `attempts`, `last_http_status`, `next_retry_at`
- detalle sanitizado del error

## Recovery path

1. revisar eventos `retry` o `failed` en `IceaOutboundEvent`;
2. corregir configuracion o disponibilidad del receptor;
3. ejecutar `flush_icea_outbox`;
4. usar `--force` si el evento ya quedo en `failed`.

## Garantia de no bloqueo clinico

`POST /api/fhir/transaction` mantiene esta regla:

- solo si FHIR responde con exito se persiste el Bundle y se encola ICEA;
- cualquier problema de ICEA se maneja fuera del guardado clinico;
- el error ICEA nunca bloquea ni revierte la transaccion clinica ya aceptada.

## Orquestación y estado del pipeline

HANDOVER expone ahora una capa propia de coordinación bajo `/api/icea/*` para que la app móvil y los dashboards consulten y operen el pipeline sin llamar directo a ICEA+.

### Rutas nuevas

- `GET /api/icea/status?requestId=<id>|bundleId=<id>|patientId=<id>[&unitId=<id>][&refresh=true]`
  - Devuelve el snapshot persistido en HANDOVER y, si ICEA+ está configurado, intenta refrescar el estado remoto sin romper la UX si el upstream falla.
- `GET /api/icea/events?unitId=<id>[&stage=<stage>][&limit=<n>]`
  - Devuelve los últimos eventos persistidos por unidad para auditoría operativa.
- `GET /api/icea/dashboard-summary[?unitId=<id>][&eventsLimit=<n>]`
  - Devuelve el contrato backend-driven del dashboard admin/supervisor desde datos persistidos en HANDOVER.
- `POST /api/icea/actions/normalize`
- `POST /api/icea/actions/build-windows`
- `POST /api/icea/actions/build-dataset`
- `POST /api/icea/actions/refresh-dashboard-summary`
- `POST /api/icea/actions/causal-report`

### Permisos

- Consultas agregadas y estado: `admin` o `supervisor`.
- Acciones manuales: solo `admin`.
- La app móvil consume siempre HANDOVER; no hay llamadas directas a ICEA+ desde React Native.

### Contrato del dashboard admin/supervisor

- El dashboard es **backend-driven por defecto**: frontend consume `GET /api/icea/dashboard-summary` y no cae a fixtures en modo live.
- `demoMode` solo puede activarse de forma explícita (sesión/flag demo) y la UI debe etiquetar esos datos como demo.
- El payload expone `units`, `alerts`, `outbox`, `pipeline` y `recentEvents`, además de `empty`, `stale`, `degraded`, `degradationReasons`, `generatedAt` y `latestActivityAt`.
- `units[]` resume actividad operativa, outbox, bridge, timing de handover y alertas abiertas por unidad.
- Si HANDOVER conserva el último dato útil pero falla el refresh remoto, la UI debe mostrarse como stale/degraded/error de forma honesta; no se permite fallback silencioso a mocks.
- Si no hay actividad persistida, el backend responde `empty=true` con colecciones vacías en lugar de inventar datos.

### Qué es automático y qué es manual

Automático:
- tras un `POST /api/fhir/transaction` exitoso, HANDOVER persiste el `HandoverBundleRecord` clínico;
- crea/actualiza un `IceaPipelineSnapshot` con etapa `handover=accepted`;
- reutiliza el outbox existente para `ingest` y persiste cada transición (`queued`, `retry`, `delivered`, `failed`) como snapshot y evento.

Manual/controlado:
- `normalize`
- `build-windows`
- `build-dataset`
- `refresh-dashboard-summary`
- `causal-report`

No se dispara entrenamiento automático por cada handover.

### Persistencia mínima nueva

- `IceaPipelineSnapshot`: último estado visible por `request_id` con `bundle_id`, `patient_id`, `unit_id`, `visible_status`, `last_stage`, `stage_statuses`, referencias remotas mínimas y caché mínima de `dashboardSummary`/`causalReport`.
- `IceaPipelineEvent`: historial auditable por unidad/etapa/acción con `status`, `detail`, `http_status` y payload técnico reducido.

HANDOVER no persiste secretos, tokens ni payloads clínicos crudos de ICEA+ en esta capa.

### Servicio backend HANDOVER -> ICEA+

`backend/api/icea_pipeline.py` encapsula:
- autenticación S2S por Bearer estático o client credentials;
- timeouts y validación básica de configuración HTTPS fuera de dev/tests;
- llamadas a `status`, `normalize`, `build-windows`, `build-dataset`, `dashboard-summary` y `causal-report`;
- parseo robusto de errores remotos y persistencia del último estado visible.

## Puente analitico HANDOVER -> ICEA+

Ademas del outbox tecnico de `ingest`, HANDOVER expone ahora un puente analitico dedicado para scoring ICEA+:

- Mapper explicito: `backend/api/icea_payload_mapper.py`
- Orquestacion S2S y persistencia visible: `backend/api/icea_bridge_service.py`
- Estado auditable: `backend/api/models.py::IceaBridgeRequest`
- Endpoints propios: `/api/icea/bridge/*`

Diferencias frente al outbox tecnico existente:
- `IceaOutboundEvent` sigue cubriendo la entrega tecnica minima hacia ICEA+;
- `IceaBridgeRequest` cubre scoring mode, hash del payload analitico, warnings, resultado minimo y estado visible para UI/dashboard;
- ambos flujos son desacoplados y no bloquean el guardado clinico.

Semantica clinica aplicada:
- `immediate_provisional`: scoring al cierre del turno con dato disponible, sin fingir conclusiones definitivas;
- `enriched_followup`: recalculo posterior cuando existan mas datos downstream y se mantiene desactivado por defecto (`ENABLE_ICEA_ENRICHED_SCORING=false`) hasta habilitacion explicita.

Persistencia minima del bridge:
- `status`: `queued`, `sent`, `accepted`, `pending`, `scored`, `failed`, `stale`;
- `payload_hash` e `idempotency_key` para trazabilidad e idempotencia;
- `contract_version` y `formula_version` si ICEA+ la devuelve;
- `score_summary_json`, `warnings_json`, `insufficient_evidence`, `provisional`;
- `last_error`, timestamps y referencias remotas reducidas;
- errores de configuracion explicitos (`missing_icea_bridge_model_id`, `invalid_icea_bridge_model_id`) sin romper la persistencia clinica.

Consumo frontend/dashboard:
- el cliente movil sigue hablando solo con HANDOVER;
- `AdminDashboardScreen` puede mostrar el listado mas reciente del bridge cuando `EXPO_PUBLIC_ENABLE_ICEA_BRIDGE=true`;
- para vistas clinicas prudentes, usar `GET /api/icea/bridge/status/<handoverId>` o `GET /api/icea/bridge/summary/<handoverId>`;
- el bridge analitico usa `POST /api/v1/icea-plus/score/` del upstream real verificado y deja `ICEA_BRIDGE_STATUS_PATH` vacio por defecto, porque ese upstream no expone hoy un endpoint real de status para score;
- en ese escenario, HANDOVER expone `remoteStatusSupported=false`, `remoteRefreshAttempted=false` y `localStatusIsAuthoritative=true`, manteniendo el estado local como fuente visible.

Ver detalle clinico/analitico: [docs/icea-bridge.md](./icea-bridge.md).


Decision record:
- en el estado actual del repo es mas limpio reutilizar la persistencia/proxy del bridge en HANDOVER para el retorno bedside; no se introduce writeback FHIR RiskAssessment nuevo porque hoy no existe una cadena real de consumo ni reconciliacion downstream para ese recurso en HANDOVER.



### Cierre del loop clinico bedside
- HANDOVER expone `GET /api/icea/patient-risk?patientId=<id>[&unitId=<id>]` y `GET /api/icea/patient-risk?unitId=<id>` para devolver el ultimo apoyo analitico prudente por paciente sin exigir `handoverId` en la app.
- El contrato bedside distingue `pending`, `provisional`, `complete`, `insufficient_evidence` y `failed`, ademas de `stale=true`, provenance, warnings y `lastUpdatedAt`.
- `ENABLE_ICEA_PATIENT_RISK` controla la exposicion del resumen analitico en backend/frontend y `ENABLE_ICEA_CAUSAL_SUMMARY` habilita solo el resumen causal resumido cuando exista.
