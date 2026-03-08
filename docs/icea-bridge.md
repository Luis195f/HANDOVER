# Puente analitico HANDOVER -> ICEA+

## Objetivo

HANDOVER construye y entrega un payload analitico trazable hacia ICEA+ **despues** de persistir con exito la transaccion clinica. El calculo analitico sigue viviendo en ICEA+; HANDOVER no duplica el motor matematico.

Principios aplicados:
- clinica primero: un fallo de ICEA+ no revierte el guardado del handover;
- backend unico: React Native solo consume el backend HANDOVER;
- scoring honesto: `immediate_provisional` no implica conclusiones definitivas;
- trazabilidad completa: request id, hash, contrato y estado quedan persistidos en HANDOVER.

## Flujo real

1. `POST /api/fhir/transaction` persiste el Bundle FHIR y el `HandoverBundleRecord`.
2. HANDOVER actualiza el snapshot tecnico del pipeline ICEA ya existente.
3. Si `ENABLE_ICEA_BRIDGE=true`, HANDOVER crea o actualiza un `IceaBridgeRequest`.
4. Se construye el payload analitico v1 en `backend/api/icea_payload_mapper.py`.
5. La entrega a ICEA+ se intenta de forma desacoplada y best-effort desde `backend/api/icea_bridge_service.py`.
6. HANDOVER persiste el ultimo estado visible (`queued`, `sent`, `accepted`, `pending`, `scored`, `failed`, `stale`) y un resumen minimo del score si ICEA+ lo devuelve.

## Payload analitico v1

Contrato actual (`contractVersion=handover-icea-bridge-v1`):

```json
{
  "contractVersion": "handover-icea-bridge-v1",
  "source": "HANDOVER",
  "scoringMode": "immediate_provisional",
  "provisional": true,
  "identity": {
    "handoverId": "bundle-bridge-001",
    "bundleId": "bundle-bridge-001",
    "requestId": "req-bridge-001",
    "patientId": "pat-bridge-001",
    "episodeId": "enc-bridge-001",
    "encounterId": "enc-bridge-001",
    "compositionId": "comp-bridge-001"
  },
  "context": {
    "grain": "shift",
    "timestamp": "2026-03-08T07:10:00Z",
    "windowStart": "2026-03-08T07:00:00Z",
    "windowEnd": "2026-03-08T15:00:00Z",
    "unitId": "icu-a",
    "teamId": null,
    "nurseId": "nurse-1",
    "shift": "Manana"
  },
  "caseMix": {},
  "nursingExposure": {},
  "qualitySignals": {},
  "uncertaintySignals": {},
  "provenance": {}
}
```

Familias de campos implementadas:
- `identity`: bundle, request, paciente, episodio y composicion.
- `context`: grano (`handover`, `episode`, `shift`), ventana temporal, unidad, actor principal y carga resumida del cambio de turno.
- `caseMix`: edad, sexo, diagnosticos estructurados, risk flags y escalas basales si existen en el Bundle.
- `nursingExposure`: conteos de medicacion/procedimientos/dispositivos/outcomes, checklist, cambios documentados, `severityWeight` heuristico y `exposureShare` cuando hay firmas/atribucion.
- `qualitySignals`: completitud estructurada, campos criticos presentes/faltantes, calidad del cierre y SBAR.
- `uncertaintySignals`: `missingnessRate`, clase de completitud, `insufficientEvidence`, `staleData` y warnings trazables.
- `provenance`: version de mapper, hash del Bundle y lineage minimo.

## Integracion upstream real

La entrega analitica actual del bridge se alinea con el repo ICEA+ verificado en C:\\h\\icea_mvp_v0_7:
- POST /api/v1/icea-plus/score/ para scoring inmediato o enriquecido;
- no se ha encontrado un endpoint real de status de score en ese upstream, por lo que HANDOVER no inventa polling remoto;
- GET /api/icea/bridge/status/<handoverId>?refresh=true solo intenta refresco remoto si ICEA_BRIDGE_STATUS_PATH esta configurado explicitamente;
- cuando no existe ese path, HANDOVER responde `remoteStatusSupported=false`, `remoteRefreshAttempted=false` y `localStatusIsAuthoritative=true` con estado local visible.

## Scoring inmediato vs enriquecido

### `immediate_provisional`
Se usa al cierre del turno o snapshot equivalente con el dato disponible en ese momento.

HANDOVER puede enviar:
- completitud del handover;
- checklist y señales de proceso;
- diagnosticos/intervenciones/outcomes ya documentados;
- vitals/escalas presentes;
- warnings de missingness o evidencia insuficiente.

HANDOVER **no** afirma:
- efectividad clinica definitiva;
- causalidad final de la contribucion enfermera;
- score enriquecido si todavia no existen outcomes/ventanas posteriores.

### `enriched_followup`
Se usa para reintentos o recalculo posterior cuando ya existen datos downstream suficientes. El modo queda persistido en `IceaBridgeRequest.scoring_mode` y puede relanzarse desde backend con permisos `admin`.

## Persistencia local minima

Modelo principal: `backend/api/models.py::IceaBridgeRequest`

Campos visibles y auditables:
- linkage: `request_id`, `bundle_id`, `patient_id`, `unit_id`, `encounter_id`, `episode_id`;
- trazabilidad: `bridge_request_id`, `idempotency_key`, `payload_hash`, `payload_json`;
- estado: `status`, `attempts`, `last_error`, `last_http_status`, `sent_at`, `received_at`;
- resultado minimo: `provisional`, `insufficient_evidence`, `contract_version`, `formula_version`, `score_summary_json`, `warnings_json`, `remote_refs_json`.

## Endpoints backend

- `GET /api/icea/bridge/status/<handoverId>`
  - roles: `nurse`, `supervisor`, `admin`
  - devuelve `bridgeRequest` + `summary` + metadata aditiva: `remoteStatusSupported`, `remoteRefreshAttempted`, `localStatusIsAuthoritative`
- `GET /api/icea/bridge/status?patientId=&unitId=&shift=&status=&scoringMode=`
  - roles: `supervisor`, `admin`
  - devuelve lista resumida para dashboards/operacion
- `GET /api/icea/bridge/summary/<handoverId>`
  - roles: `nurse`, `supervisor`, `admin`
  - devuelve resumen prudente para UI
- `POST /api/icea/bridge/retry/<bridgeId>`
  - rol: `admin`
  - reintenta el mismo payload o relanza `enriched_followup`

## Flags y configuracion

Backend:
- `ENABLE_ICEA_BRIDGE`
- `ENABLE_ICEA_IMMEDIATE_SCORING`
- `ENABLE_ICEA_ENRICHED_SCORING` (por defecto `false`; solo se activa explicitamente)
- `ICEA_BRIDGE_MODEL_ID` (UUID obligatorio para score real; si falta o es invalido HANDOVER deja error explicito y no intenta entrega ambigua)
- `ICEA_BRIDGE_SCORE_PATH` (por defecto `'/api/v1/icea-plus/score/'`, alineado con el upstream real)
- `ICEA_BRIDGE_STATUS_PATH` (opcional; por defecto vacio porque el upstream ICEA+ actual no expone un endpoint real de status para score)
- `ICEA_BRIDGE_STALE_AFTER_SECONDS`

Frontend:
- `EXPO_PUBLIC_ENABLE_ICEA_BRIDGE`
- `EXPO_PUBLIC_ENABLE_ICEA_IMMEDIATE_SCORING`
- `EXPO_PUBLIC_ENABLE_ICEA_ENRICHED_SCORING`

## Limites clinicos y analiticos

- HANDOVER no ejecuta el motor matematico de ICEA+.
- `severityWeight` y `exposureShare` son precursores transparentes construidos solo con datos realmente presentes.
- Si faltan campos, HANDOVER degrada explicitamente via `missingnessRate`, `payloadCompletenessClass`, `insufficientEvidence` y warnings.
- El dashboard debe tratar `provisional=true` y `insufficientEvidence=true` como resultados no concluyentes.

## Riesgos residuales

- La riqueza del payload depende de la calidad del Bundle FHIR realmente documentado por la unidad.
- El modo `enriched_followup` requiere disponibilidad de datos posteriores; HANDOVER no los inventa.
- La vista admin actual expone resumen del bridge, no un dashboard analitico completo.
- Sigue existiendo una advertencia heredada no relacionada en `backend/api/views.py` por `datetime.utcnow()` usada en auditoria existente.




