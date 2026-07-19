# Puente analitico HANDOVER -> ICEA+

## Objetivo

HANDOVER construye y entrega un payload analitico trazable hacia ICEA+ **solo despues** de confirmar con exito la transaccion clinica FHIR. El calculo analitico sigue viviendo en ICEA+; HANDOVER no duplica el motor matematico.

Principios aplicados:
- clinica primero: un fallo de ICEA+ no revierte el guardado del handover;
- shadow mode estricto: outbox, snapshots, bridge y cualquier persistencia tecnica post-FHIR degradan de forma best-effort y no contaminan el exito clinico ya confirmado;
- backend unico: React Native solo consume el backend HANDOVER;
- scoring honesto: `immediate_provisional` no implica conclusiones definitivas ni habilita score individual visible;
- trazabilidad completa: request id, hash, contrato y estado quedan persistidos en HANDOVER.

## Flujo real

1. `POST /api/fhir/transaction` confirma primero la transaccion clinica contra FHIR.
2. Solo despues de ese exito, HANDOVER dispara side effects tecnicos best-effort: outbox ICEA+, persistencia local `HandoverBundleRecord`, snapshot tecnico y bridge.
3. Si falla cualquiera de esas costuras tecnicas post-FHIR, HANDOVER conserva el exito clinico y degrada de forma honesta la trazabilidad/analitica derivada.
4. Si `ENABLE_ICEA_BRIDGE=true`, HANDOVER crea o actualiza un `IceaBridgeRequest`.
5. Se construye el payload analitico v1 en `backend/api/icea_payload_mapper.py`.
6. La entrega a ICEA+ se intenta de forma desacoplada y best-effort desde `backend/api/icea_bridge_service.py`.
7. El scheduler del bridge tiene una sola fuente de verdad: el service programa entregas nuevas al crear el request y evita reprogramar una request ya `queued`; los retries admin reutilizan el mismo helper con `force=true`.
8. HANDOVER persiste el ultimo estado visible (`queued`, `sent`, `accepted`, `pending`, `scored`, `failed`, `stale`) y un resumen minimo del score si ICEA+ lo devuelve.
9. Los fallos retryables del submit del bridge se reintentan de forma acotada y con backoff; si se agotan, la request termina en `failed` con el ultimo error persistido.
10. Cualquier `accepted` o `pending` que no alcance resolucion dentro de la ventana configurada expira a `stale`, de modo que no queda un pending indefinido.

## Payload analitico v1

HANDOVER mantiene internamente el payload puente `contractVersion=handover-icea-bridge-v1`, construido desde el Bundle FHIR y persistido en `IceaBridgeRequest.payload_json`. Al enviar a ICEA+, el runtime no publica ese payload crudo: proyecta una solicitud de feature contract versionada `handover-icea-feature-v1`.

Sobre POST real a ICEA+:

```json
{
  "contract_version": "handover-icea-feature-v1",
  "source_repo": "Luis195f/HANDOVER",
  "model_id": "11111111-1111-4111-8111-111111111111",
  "grain": "window",
  "from_db": false,
  "rows": [
    {
      "contract_version": "handover-icea-feature-v1",
      "source_repo": "Luis195f/HANDOVER",
      "source_grain": "window",
      "row_id": "window:enc-bridge-001",
      "episode_id": "enc-bridge-001",
      "unit_id": "icu-a",
      "clinical_timestamp": "2026-03-08T15:00:00Z",
      "recorded_timestamp": "2026-03-08T15:03:00Z",
      "features": {
        "age_years": 37.0,
        "documented_medication_count": 1.0,
        "documented_procedure_count": 1.0,
        "structured_completeness_rate": 0.82,
        "missingness_rate": 0.18,
        "shift_closure_documented": 1.0
      },
      "missingness_flags": {
        "age_years": false,
        "documented_medication_count": false,
        "documented_procedure_count": false,
        "structured_completeness_rate": false,
        "missingness_rate": false,
        "shift_closure_documented": false,
        "glasgow": true
      },
      "warnings": [],
      "shadow_mode": true,
      "non_individual_use": true
    }
  ],
  "shadow_mode": true,
  "non_individual_use": true
}
```

Campos obligatorios del sobre:
- `contract_version`: version del contrato de features enviado a ICEA+; actualmente `handover-icea-feature-v1`.
- `source_repo`: repo emisor del contrato; actualmente `Luis195f/HANDOVER`.
- `model_id`: UUID configurado en `ICEA_BRIDGE_MODEL_ID`.
- `grain`: debe coincidir con `rows[0].source_grain`.
- `from_db`: siempre `false` en este bridge; HANDOVER envia una proyeccion desde el handover persistido, no una consulta directa a una base ICEA.
- `rows`: lista con exactamente una fila proyectada desde el payload HANDOVER; `rows: []` es invalido para este bridge.
- `shadow_mode`: obligatorio `true`.
- `non_individual_use`: obligatorio `true`.

Estructura obligatoria de cada `row`:
- `contract_version`: debe coincidir con el feature contract del sobre.
- `source_repo`: debe coincidir con el repo emisor del sobre.
- `source_grain`: `window` para handovers con ventana de turno, `episode` cuando no hay ventana de turno usable.
- `row_id`: identificador tecnico estable de la fila, formado como `<source_grain>:<episode|encounter|bundle|bridge_request>`.
- `episode_id`: episodio, encounter o bundle usado como ancla clinica de la fila.
- `unit_id`: unidad de cuidado resuelta por HANDOVER.
- `clinical_timestamp`: timestamp clinico de referencia para la fila.
- `recorded_timestamp`: timestamp de registro/proyeccion de la fila.
- `features`: diccionario numerico con las features disponibles.
- `missingness_flags`: diccionario paralelo que marca features ausentes.
- `warnings`: advertencias trazables, sin PHI libre.
- `shadow_mode`: obligatorio `true`.
- `non_individual_use`: obligatorio `true`.

La fila puede incluir campos aditivos compatibles, como `patient_key`, `unit_code`, `window_start`, `window_end`, `start_dt`, `end_dt`, `shift`, features numericas aplanadas y `lineage`. El envelope contextual `handover-icea-context-v1` viaja dentro de `row.lineage.contextual_signal`; no sustituye el contrato de features ni habilita uso individual.

Familias de datos de origen usadas para construir `features` y `lineage`:
- `identity`: bundle, request, paciente, episodio y composicion.
- `context`: grano (`handover`, `episode`, `shift`), ventana temporal, unidad, presencia/conteo de actores documentados y carga resumida del cambio de turno, sin IDs nominales de profesional.
- `caseMix`: edad, sexo, diagnosticos estructurados, risk flags y escalas basales si existen en el Bundle.
- `nursingExposure`: conteos de medicacion/procedimientos/dispositivos/outcomes, checklist, cambios documentados, `severityWeight` heuristico y `exposureShare`, con atribucion resumida por conteos y sin IDs nominales.
- `qualitySignals`: completitud estructurada, campos criticos presentes/faltantes, calidad del cierre y SBAR.
- `uncertaintySignals`: `missingnessRate`, clase de completitud, `insufficientEvidence`, `staleData` y warnings trazables.
- `provenance`: version de mapper, hash del Bundle y lineage minimo.
- `governance`: politica de display (`shadow_aggregated_no_individual_score`), redaccion nominal y supresion explicita de score individual/resumen causal visible.
- `identity.handoverId` y `identity.bundleId`: aliases estables del mismo identificador de handover para no romper consumidores clinicos u operativos.
- `contextualSignal`: envelope contextual aditivo y versionado para ICEA+.

## Envelope contextual v1

El bridge mantiene `contractVersion=handover-icea-bridge-v1` y agrega, de forma aditiva, `contextualSignal.contract_version=handover-icea-context-v1`.

Campos minimos emitidos:
- `profile_id`: perfil observado en `Observation/clinical-context` cuando el Bundle lo trae.
- `overlay_ids`: overlays observados en `Observation/clinical-context`.
- `case_mix_envelope.baseline_complexity`: derivado deterministico de edad, diagnosticos, risk flags y severidad observada.
- `case_mix_envelope.surveillance_intensity`: derivado deterministico de vitales anormales, pendientes criticos y gap de soporte.
- `case_mix_envelope.therapeutic_load`: derivado deterministico de medicacion, procedimientos, dispositivos, outcomes y examenes documentados.
- `case_mix_envelope.temporal_criticality`: derivado deterministico de pendientes criticos, vitales anormales y brechas del cierre.
- `case_mix_envelope.continuity_risk`: derivado deterministico de brechas de cierre, soporte incompleto y pendientes abiertos.
- `case_mix_envelope.dependency_load`: derivado deterministico de dispositivos, severidad observada y risk flags.
- `case_mix_envelope.coordination_complexity`: derivado deterministico de overlays observados, pendientes criticos y brechas de cierre.
- `case_mix_envelope.observed_fields`: solo señales vistas en el Bundle/contexto actual.
- `case_mix_envelope.derived_fields`: reglas deterministicas transparentes del repo.
- `case_mix_envelope.pending_hospital_source_fields`: campos explicitamente reservados para futuras fuentes hospitalarias.

Reglas interpretativas:
- `observed_fields` no inventa fuentes ausentes. Si no hay `Observation/clinical-context`, `profile_id` queda `null` y `overlay_ids` vacio.
- `derived_fields` no expresa causalidad ni efectividad clinica; solo estratificacion basal y trazable para ICEA+.
- `pending_hospital_source_fields` no se emite como dato real: marca dependencias futuras como ADT, ratios, MAR, consultorias y planes de transicion.

## Integracion upstream real

La entrega analitica actual del bridge se alinea con el repo ICEA+ verificado en C:\h\icea_mvp_v0_7:
- POST /api/v1/icea-plus/score/ para scoring inmediato o enriquecido;
- no se ha encontrado un endpoint real de status de score en ese upstream, por lo que HANDOVER no inventa polling remoto;
- si ICEA+ responde con aliases de contrato (`status`/`state`/`result`, `formulaVersion`/`formula_version`, `warnings`/`issues`), HANDOVER los normaliza sin renombrar el contrato publico del bridge;
- la fila enviada a ICEA+ mantiene las features numericas actuales y agrega el envelope contextual dentro de `rows[].lineage.contextual_signal` para trazabilidad y capas analiticas posteriores;
- `clinical_timestamp` prefiere `context.windowEnd`, `context.windowStart`, `context.timestamp` y timestamps clinicos del payload si existen; `recorded_timestamp` prefiere `context.recordedTimestamp` y `context.timestamp`;
- payloads legacy que no traen timestamps requeridos se proyectan con un fallback conservador y estable desde `IceaBridgeRequest.created_at`, luego `updated_at` solo si falta `created_at`, para preservar idempotencia entre reintentos con el mismo payload hash e Idempotency-Key;
- cuando HANDOVER usa ese fallback de timestamp, agrega warning `legacy_timestamp_fallback`;
- GET /api/icea/bridge/status/<handoverId>?refresh=true solo intenta refresco remoto si ICEA_BRIDGE_STATUS_PATH esta configurado explicitamente;
- cuando no existe ese path, HANDOVER responde `remoteStatusSupported=false`, `remoteRefreshAttempted=false` y `localStatusIsAuthoritative=true` con estado local visible.

## Respuestas no-scoring

HANDOVER trata estos estados remotos como resultados sin score individual procesable:
- `contract_mismatch`: ICEA+ no pudo procesar la fila porque el contrato o la configuracion esperada no coinciden. HANDOVER lo persiste como fallo del bridge/contrato y conserva warnings trazables.
- `low_feature_coverage`: ICEA+ rechazo o no puntuo por cobertura insuficiente del contrato de features. HANDOVER lo persiste como fallo del bridge/cobertura y conserva warnings trazables.
- `insufficient_evidence`: ICEA+ produjo un resultado analitico valido sin score concluyente por evidencia insuficiente. HANDOVER no lo clasifica como fallo tecnico; lo marca como `insufficientEvidence=true`.

Para los tres estados, HANDOVER suprime `scoreSummary` aunque la respuesta remota incluya campos numericos. En respuestas publicas del bridge y resumenes derivados, `scoreSummary` permanece `null`; `scoreSummaryRedacted=true` solo indica que existio material interno suprimido, no visibilidad clinica de un score individual.

`contract_mismatch` y `low_feature_coverage` no se convierten en `insufficientEvidence` salvo que ICEA+ lo indique de forma explicita mediante `insufficientEvidence`, flags o warnings de `insufficient_evidence`.

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

### Aliases y disciplina de scheduling

Contrato estable y aditivo hoy:
- `handoverId` es el alias publico de `bundleId` en respuestas del bridge; ambos se mantienen para compatibilidad.
- la normalizacion remota acepta `status`, `state` o `result` como fuente de estado; `formulaVersion` o `formula_version`; `warnings` o `issues`.
- los enqueues normales no reprograman una request ya `queued`; si el payload se refresca antes de entregar, el worker reutiliza el payload vigente persistido y evita abrir un side effect paralelo adicional.
- `POST /api/icea/bridge/retry/<bridgeId>` no crea un scheduler paralelo: usa el mismo helper del service con `force=true`.
- si una entrega vieja responde despues de que `payload_hash` o `idempotency_key` cambiaron, HANDOVER descarta esa respuesta para no sobrescribir la corrida vigente.

Ejemplo resumido de `bridgeRequest` expuesto a UI/operacion:

```json
{
  "bridgeRequestId": "req-bridge-001:immediate_provisional",
  "handoverId": "bundle-bridge-001",
  "bundleId": "bundle-bridge-001",
  "requestId": "req-bridge-001",
  "payloadHash": "abc123...",
  "attempts": 2,
  "remoteRefs": {"jobId": "job-bridge-001"}
}
```

Modelo principal: `backend/api/models.py::IceaBridgeRequest`

Campos visibles y auditables:
- linkage: `request_id`, `bundle_id`, `patient_id`, `unit_id`, `encounter_id`, `episode_id`;
- trazabilidad: `bridge_request_id`, `idempotency_key`, `payload_hash`, `payload_json`;
- estado: `status`, `attempts`, `last_error`, `last_http_status`, `sent_at`, `received_at`, `next_retry_at`;
- resultado minimo: `provisional`, `insufficient_evidence`, `contract_version`, `formula_version`, `score_summary_json`, `warnings_json`, `remote_refs_json`; cuando cambia el payload se resetean `formula_version`, `score_summary_json`, `remote_refs_json`, `sent_at`, `received_at`, `attempts`, `last_error` y `last_http_status` para iniciar una corrida limpia;
- trazabilidad explicable expuesta por API: `bridgeRequestId`, `requestId`, `payloadHash`, `attempts`, `remoteRefs`, `lastAttemptAt`, `nextRetryAt`, `retryScheduled` y `terminal`.

Politica operativa minima:
- timeout de red del bridge: `ICEA_BRIDGE_TIMEOUT_MS` (si no se define, cae en `ICEA_API_TIMEOUT_MS`);
- retry de submit: `ICEA_BRIDGE_RETRY_MAX` con backoff exponencial entre `ICEA_BRIDGE_RETRY_BASE_SECONDS` y `ICEA_BRIDGE_RETRY_MAX_DELAY_SECONDS`;
- estados HTTP retryables: `ICEA_BRIDGE_RETRYABLE_STATUS_CODES` o el set por defecto `408,409,425,429,500,502,503,504`;
- terminalidad por limbo remoto: `ICEA_BRIDGE_STALE_AFTER_SECONDS` marca `accepted/pending` como `stale` si no hubo resolucion observable.
- si un proceso cae antes del timer en memoria, el seam materializa de forma durable cualquier `sent/accepted/pending` vencido a `stale` antes de leer, filtrar o accionar requests del bridge; el timer queda solo como acelerador best-effort.

## Endpoints backend

- `GET /api/icea/bridge/status/<handoverId>`
  - roles: `nurse`, `supervisor`, `admin`
  - devuelve `bridgeRequest` + `summary` + metadata aditiva: `remoteStatusSupported`, `remoteRefreshAttempted`, `localStatusIsAuthoritative`
  - el `scoreSummary` queda redactado en la respuesta publica; la salida visible conserva estado, warnings, request ids, modo y versionado
- `GET /api/icea/bridge/status?bridgeRequestId=&requestId=&handoverId=&bundleId=&patientId=&unitId=&shift=&status=&scoringMode=`
  - roles: `supervisor`, `admin`
  - `handoverId` y `bundleId` filtran el mismo campo estable (`bundle_id`)
  - devuelve lista resumida para dashboards/operacion
- `GET /api/icea/bridge/summary/<handoverId>`
  - roles: `nurse`, `supervisor`, `admin`
  - devuelve resumen prudente para trazabilidad, sin score individual visible y sin obligar a una surface clinica paciente-a-paciente
- `POST /api/icea/bridge/retry/<bridgeId>`
  - rol: `admin`
  - reintenta el mismo payload o relanza `enriched_followup`

## Flags y configuracion

Backend:
- `ENABLE_ICEA_BRIDGE`
- `ENABLE_ICEA_IMMEDIATE_SCORING` (por defecto `false`; solo se activa explicitamente)
- `ENABLE_ICEA_ENRICHED_SCORING` (por defecto `false`; solo se activa explicitamente)
- `ENABLE_ICEA_PATIENT_RISK` (por defecto `false`)
- `ENABLE_ICEA_CAUSAL_SUMMARY` (por defecto `false`)
- `ICEA_BRIDGE_MODEL_ID` (UUID obligatorio para score real; si falta o es invalido HANDOVER deja error explicito y no intenta entrega ambigua)
- `ICEA_BRIDGE_TIMEOUT_MS` (timeout explicito del submit y refresh del bridge; por defecto hereda `ICEA_API_TIMEOUT_MS`)
- `ICEA_BRIDGE_RETRY_MAX`
- `ICEA_BRIDGE_RETRY_BASE_SECONDS`
- `ICEA_BRIDGE_RETRY_MAX_DELAY_SECONDS`
- `ICEA_BRIDGE_RETRYABLE_STATUS_CODES`
- `ICEA_BRIDGE_SCORE_PATH` (por defecto `'/api/v1/icea-plus/score/'`, alineado con el upstream real)
- `ICEA_BRIDGE_STATUS_PATH` (opcional; por defecto vacio porque el upstream ICEA+ actual no expone un endpoint real de status para score)
- `ICEA_BRIDGE_STALE_AFTER_SECONDS`

Frontend:
- `EXPO_PUBLIC_ENABLE_ICEA_BRIDGE`
- `EXPO_PUBLIC_ENABLE_ICEA_IMMEDIATE_SCORING` (por defecto `false`)
- `EXPO_PUBLIC_ENABLE_ICEA_ENRICHED_SCORING`
- `EXPO_PUBLIC_ENABLE_ICEA_PATIENT_RISK` (por defecto `false`)
- `ENABLE_ICEA_CAUSAL_SUMMARY` permanece backend-only, por defecto `false` y fuera del control plane operativo de piloto; la UI operativa no expone un toggle cliente equivalente

En shadow mode prudente, activar `EXPO_PUBLIC_ENABLE_ICEA_PATIENT_RISK` no debe volver visible ninguna salida ICEA paciente-a-paciente en la UI clinica operativa; la visibilidad humana queda reservada a superficies agregadas/admin cuando existan.

## Limites clinicos y analiticos

- HANDOVER no ejecuta el motor matematico de ICEA+.
- `severityWeight` y `exposureShare` son precursores transparentes construidos solo con datos realmente presentes.
- Si faltan campos, HANDOVER degrada explicitamente via `missingnessRate`, `payloadCompletenessClass`, `insufficientEvidence` y warnings.
- `contextualSignal` sirve para ajuste minimo por case-mix y continuidad; no valida comparaciones brutas entre unidades sin analitica posterior.
- el contrato v1 ya no entrega IDs nominales de profesional al payload analitico del bridge;
- Ningun campo del envelope contextual debe interpretarse como causalidad, benchmarking causal o explicabilidad clinica fuerte.
- El dashboard debe tratar `provisional=true` y `insufficientEvidence=true` como resultados no concluyentes y no mostrar score individual visible.

## Shadow mode vinculante

Permanece en shadow mode:
- outbox tecnico ICEA+, snapshots de pipeline, `IceaBridgeRequest`, `/api/icea/bridge/*` y superficies agregadas/admin derivadas;
- cualquier payload, warning o estado del bridge existe para trazabilidad tecnica y lectura agregada autorizada, no para decidir exito clinico del handover;
- la costura backend `patient-risk` solo puede entenderse como seam gobernado y suprimido en la UI clinica operativa mientras siga el shadow mode prudente.

No debe usarse jamas como evaluacion individual:
- score numerico individual visible;
- ranking, benchmarking nominal o uso punitivo sobre profesionales;
- resumen causal cerrado o atribucion causal del resultado enfermero;
- sustitucion del juicio clinico, del cierre operativo del handover o del criterio asistencial habitual.

## Riesgos residuales

- La riqueza del payload depende de la calidad del Bundle FHIR realmente documentado por la unidad.
- El modo `enriched_followup` requiere disponibilidad de datos posteriores; HANDOVER no los inventa.
- La vista admin actual expone resumen del bridge, no un dashboard analitico completo.
- Sigue existiendo una advertencia heredada no relacionada en `backend/api/views.py` por `datetime.utcnow()` usada en auditoria existente.

## Built during OpenAI Build Week 2026

### PRE-EXISTING

Antes de esta rama ya existian y no se presentan como trabajo Build Week:

- HANDOVER Core y el runtime clinico Core + UPP + SOP + MPAC + ICEA+;
- operacion offline-first, cola y sincronizacion;
- construccion, validacion y envio FHIR transaction;
- MPAC;
- outbox ICEA con HMAC, anti-replay opcional, idempotencia y retries;
- bridge ICEA con autenticacion de servicio, timeout, retries y trazabilidad;
- productor y validador `handover-icea-feature-v1`.

### BUILT DURING BUILD WEEK

Esta rama añade exclusivamente **HANDOVER → ICEA Integration Readiness & Shadow Bridge Verification**,
una capacidad reproducible para verificar readiness, contrato y governance y detectar incompatibilidades
de forma segura. No garantiza que dos sistemas previamente incompatibles sean compatibles.

- carga el fixture FHIR fijo `tests/fixtures/fhir/uci-adulto-contextual-bundle.json`;
- falla cerrado si el fixture deja de usar identidades explicitamente sinteticas;
- construye el payload real mediante el mapper HANDOVER y la proyeccion existente del bridge;
- envia una request real mediante `IceaBridgeRemoteService`, reutilizando el auth service, TLS, timeout e `Idempotency-Key` existentes;
- valida la aceptacion del contrato y la respuesta shadow del receptor;
- emite un resultado JSON `PASS`, `FAIL` o `NOT_VERIFIED` con razones y checks;
- confirma que la respuesta no publica score individual numerico, ranking, score laboral, writeback clinico ni accion clinica automatica;
- no persiste el Bundle sintetico ni crea un segundo outbox, scheduler o servicio.

Codex con GPT-5.6 ayudo a inspeccionar los contratos existentes, contrastar el productor HANDOVER con el receptor ICEA, elegir el cambio minimo, implementar el command/verificador, crear tests focalizados y revisar seguridad, redaccion e idempotencia. No se integro GPT-5.6 en runtime, no se envio informacion clinica a un LLM y no se creo una nueva frontera de confianza.

`CODEX_FEEDBACK_SESSION_ID=PENDING`

### Ejecucion reproducible para jueces

Prerequisitos:

1. Arrancar una instancia ICEA local o de prueba que exponga `/api/v1/icea-plus/score/`.
2. Usar un `ICEA_BRIDGE_MODEL_ID` de esa instancia cuyo feature contract esperado sea `handover-icea-feature-v1` y `source_repo=Luis195f/HANDOVER`.
3. Reutilizar credenciales de servicio locales/de prueba ya provisionadas. El verificador no crea, imprime ni almacena secretos.

Ejemplo PowerShell para una instancia local:

```powershell
$env:HANDOVER_DEPLOYMENT_MODE = "development"
$env:ENABLE_ICEA_BRIDGE = "true"
$env:ENABLE_ICEA_IMMEDIATE_SCORING = "true"
$env:ICEA_API_BASE_URL = "http://127.0.0.1:8001"
$env:ICEA_API_BEARER_TOKEN = "<existing-test-token>"
$env:ICEA_BRIDGE_MODEL_ID = "<existing-icea-model-uuid>"
$env:ICEA_BRIDGE_SCORE_PATH = "/api/v1/icea-plus/score/"
python manage.py verify_icea_shadow_bridge
```

Tambien se puede usar el flujo `client_credentials` existente mediante `ICEA_API_TOKEN_URL`, `ICEA_API_CLIENT_ID` e `ICEA_API_CLIENT_SECRET` en lugar de `ICEA_API_BEARER_TOKEN`.

Para un endpoint HTTPS de prueba no local se exige confirmacion explicita:

```powershell
python manage.py verify_icea_shadow_bridge --allow-remote-test-endpoint
```

Interpretacion:

- `PASS`: hubo respuesta real de ICEA y pasaron contrato, governance shadow y redaccion individual.
- `FAIL`: HANDOVER o ICEA devolvieron un mismatch contractual o material individual/prohibido.
- `NOT_VERIFIED`: configuracion incompleta, endpoint no confirmado, error de red, auth, timeout o un resultado
  analitico valido `insufficient_evidence` sin scoring concluyente; nunca se infiere `PASS`.

### Verified local cross-repository run

Se ejecuto una prueba real HANDOVER → ICEA contra una instancia ICEA local:

- readiness y smoke de ICEA finalizaron en `PASS`;
- HANDOVER alcanzo realmente ICEA con autenticacion JWT y RBAC de rol `service` funcionales;
- el transporte obtuvo HTTP `200`, con `reached_icea=true` y `auth_mode=bearer`;
- ICEA devolvio `contract_mismatch` porque el modelo demo disponible tiene un feature-space distinto del
  payload `handover-icea-feature-v1` producido por HANDOVER y no existe actualmente un modelo seeded compatible;
- el resultado demuestra que el verificador detecta la incompatibilidad y falla cerrado;
- no demuestra compatibilidad end-to-end del scoring;
- no se modifico ICEA, su contrato ni su kernel para fabricar un `PASS`;
- la deduplicacion del receptor permanece `NOT_VERIFIED`.

La idempotencia de retry dentro de HANDOVER se verifica reconstruyendo el mismo body desde el mismo request transitorio y reutilizando la misma `Idempotency-Key`. El endpoint de score ICEA actual no expone receipt ni garantia de deduplicacion por esa cabecera; por ello `receiver_replay` se declara honestamente `NOT_VERIFIED` y el command no duplica el POST para aparentar una garantia inexistente.
