# Integracion ICEA+ service-to-service (estado real)

> Estado revisado el 2026-03-09. HANDOVER integra ICEA+ de forma desacoplada y no bloqueante. La evidencia disponible es suficiente para un piloto tecnico serio, pero no para afirmar un cierre regulatorio total ni una reconciliacion clinica downstream completa.

## 1) Principio operativo

Tras un `POST /api/fhir/transaction` exitoso, HANDOVER:

1. confirma primero la transaccion clinica contra FHIR;
2. persiste el Bundle local para ETL;
3. crea/actualiza snapshot de pipeline;
4. encola un webhook tecnico ICEA+;
5. si el bridge esta habilitado, construye y envia el payload analitico.

Si ICEA+ falla, el guardado clinico no se revierte.

Evidencia:

- `backend/api/views.py`
- `backend/api/icea_transaction.py`
- `backend/api/icea.py`
- `backend/api/icea_bridge_service.py`
- `backend/api/tests/test_icea_webhook.py`
- `backend/api/tests/test_icea_bridge.py`
- `backend/api/tests/test_handover_etl_read.py`

## 2) Dos superficies S2S distintas

| Superficie | Implementacion | Auth real | Persistencia local |
|---|---|---|---|
| Ingest tecnico | `backend/api/icea.py`, `backend/api/icea_client.py` | HMAC compartido + `Idempotency-Key`; anti-replay opcional | `IceaOutboundEvent` |
| Pipeline y bridge | `backend/api/icea_pipeline.py`, `backend/api/icea_bridge_service.py` | Bearer estatico o `client_credentials` | `IceaPipelineSnapshot`, `IceaPipelineEvent`, `IceaBridgeRequest` |

Esto importa para el paquete documental:

- el webhook tecnico no usa OAuth;
- las consultas/acciones/puntaje si pueden usar Bearer o `client_credentials`;
- la app movil no llama directo a ICEA+.

## 3) Outbox tecnico HANDOVER -> ICEA+

### Implementado

- payload minimo con `bundleId`, `patientId`, `unitId`, `timestamp`, `requestId`, `source`;
- firma HMAC sobre JSON canonico;
- `Idempotency-Key` igual al `request_id`;
- estados `queued`, `retry`, `delivered`, `failed`;
- backoff exponencial local;
- comando `flush_icea_outbox`.

### Tests

- `backend/api/tests/test_icea_webhook.py`

### Limites explicitos

- `ICEA_WEBHOOK_ANTI_REPLAY` existe pero no esta activado por defecto;
- la deduplicacion final del receptor ICEA+ sigue siendo una dependencia externa;
- el payload clinico crudo no se loguea, pero el evento sigue conteniendo identificadores operativos internamente.

## 4) Coordinacion del pipeline bajo HANDOVER

Rutas reales:

- `GET /api/icea/status`
- `GET /api/icea/events`
- `GET /api/icea/dashboard-summary`
- `POST /api/icea/actions/normalize`
- `POST /api/icea/actions/build-windows`
- `POST /api/icea/actions/build-dataset`
- `POST /api/icea/actions/refresh-dashboard-summary`
- `POST /api/icea/actions/causal-report`

Permisos reales:

- consultas agregadas: `supervisor` o `admin`;
- acciones manuales: solo `admin`.

Evidencia:

- `backend/api/views_icea.py`
- `backend/api/tests/test_icea_pipeline_api.py`
- `backend/api/tests/test_role_acl.py`

## 5) Bridge analitico y soporte prudente

### Implementado

- mapper explicito del Bundle a payload analitico:
  - `backend/api/icea_payload_mapper.py`
- persistencia visible por request:
  - `backend/api/models.py::IceaBridgeRequest`
- modos:
  - `immediate_provisional`
  - `enriched_followup`
- errores de configuracion visibles:
  - `missing_icea_bridge_model_id`
  - `invalid_icea_bridge_model_id`
- endpoints propios:
  - `GET /api/icea/bridge/status/<handoverId>`
  - `GET /api/icea/bridge/summary/<handoverId>`
  - `POST /api/icea/bridge/retry/<bridgeId>`

### Que deja claro el codigo

- HANDOVER no ejecuta el motor matematico de ICEA+;
- el score puede ser provisional;
- si no existe `ICEA_BRIDGE_STATUS_PATH`, el estado local visible pasa a ser la fuente autoritativa;
- el bridge no bloquea el cierre clinico.

### Tests

- `backend/api/tests/test_icea_bridge.py`

## 6) Logging y proteccion de PHI

Evidencia concreta:

- `backend/api/icea.py::safe_icea_event_summary`
- `backend/api/tests/test_icea_webhook.py`
- `backend/api/tests/test_handover_etl_read.py`

Lo que hoy queda respaldado:

- no se vuelcan secretos compartidos en logs del outbox;
- no se vuelca el payload clinico crudo;
- los identificadores sensibles visibles en log se hash-an o se omiten en las superficies cubiertas.

Lo que no debe afirmarse:

- que todo el backend completo ya tiene evidencia exhaustiva de redaccion de PHI.

## 7) Uso bedside y limites clinicos

`GET /api/icea/patient-risk`:

- solo funciona con `ENABLE_ICEA_BRIDGE=true` y `ENABLE_ICEA_PATIENT_RISK=true`;
- restringe enfermeria por `unitId`;
- devuelve mensajes prudentes de "no sustituye juicio clinico";
- puede exponer `provisional`, `complete`, `insufficient_evidence`, `failed`, `stale`.

Evidencia:

- `backend/api/icea_clinical_feedback.py`
- `backend/api/views_icea_bridge.py`
- `backend/api/tests/test_icea_bridge.py`

Limite clinico actual:

- no existe writeback FHIR nuevo ni reconciliacion downstream cerrada del resultado ICEA;
- el retorno bedside sigue siendo soporte operativo local de HANDOVER.

## 8) Criterios piloto Go/No-Go especificos de ICEA+

### Go

- `ICEA_WEBHOOK_*` validado para el entorno;
- `ICEA_API_*` y `ICEA_BRIDGE_MODEL_ID` validos si se habilita bridge;
- roles/scopes verificados en `/api/icea/*` y ETL;
- mensajes prudentes visibles en superficies clinicas activas;
- outbox/bridge sin estados fallidos persistentes no aceptados.

### No-Go

- app movil intentando acceso directo a ICEA+;
- bridge activado con `ICEA_BRIDGE_MODEL_ID` vacio o invalido;
- `patient-risk` habilitado sin control de unidad;
- documentacion que trate el score como diagnostico autonomo o resultado clinico definitivo.

## 9) Riesgos residuales aceptados

| Riesgo | Delimitacion actual |
|---|---|
| Estado remoto no consultable para score | cuando no hay `ICEA_BRIDGE_STATUS_PATH`, el estado local es autoritativo |
| Bridge provisional interpretado como definitivo | el soporte prudente depende tambien del entrenamiento operativo del piloto |
| Anti-replay no forzado | queda a configuracion del entorno webhook |
| Dependencia del upstream ICEA+ | disponibilidad, semantica final y deduplicacion remota no viven en este repo |

Este documento refleja la integracion real y sus limites. No debe reescribirse como si ICEA+ estuviera clinicamente cerrado de punta a punta dentro de HANDOVER.
