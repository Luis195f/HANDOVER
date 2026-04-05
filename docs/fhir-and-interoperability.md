# Interoperabilidad FHIR (estado piloto-grade)

> Estado del documento
> - Estado: `pilot`.
> - Última revisión: 2026-03-26.
> - Fuente de verdad / evidencia base: `src/lib/fhir-map.ts`, `src/lib/fhir-map/nnn.ts`, `backend/api/views.py`, `tests/fhir-map.spec.ts`, `backend/api/tests/test_handover_etl_read.py`.
> - Riesgos o lagunas abiertas: el repo soporta mapeo FHIR real para NNN y transacción clínica vía Django/DRF, pero no declara perfiles regulatorios externos cerrados ni licencia NNN embebida en el repositorio.

## 1) Arquitectura real

- La app envia bundles a `POST /api/fhir/transaction`.
- Django/DRF concentra validación, enforcement de firma según entorno, auditoría y side effects ICEA.
- La lectura ETL del Bundle clinico persistido ocurre via `GET /api/handover/{bundle_id}`.
- La app no necesita hablar directo con ICEA+ para interoperabilidad operativa.

## 2) Recursos usados

- `Composition`
- `Patient`
- `Observation`
- `Condition`
- `Procedure`
- `MedicationStatement`
- `MedicationAdministration`
- `DocumentReference`

Implementacion principal:

- `src/lib/fhir-map.ts`
- `src/lib/fhir-map/nnn.ts`
- `src/lib/fhir-terminology.ts`
- `backend/api/views.py`

Tests principales:

- `src/lib/__tests__/fhir-map.nnn.spec.ts`
- `src/lib/__tests__/fhir-map.medications.spec.ts`
- `tests/fhir-map.spec.ts`
- `tests/fhir-representative-bundle.spec.ts`
- `backend/api/tests/test_handover_etl_read.py`

## 3) Mapping minimo viable NNN

| Concepto | Recurso FHIR | Campo | Sistema actual | Estado |
|---|---|---|---|---|
| NANDA | `Condition` | `Condition.code.coding` | `urn:handover:terminology:NANDA-I` | Implementado con URI local |
| NIC | `Procedure` | `Procedure.code.coding` | `urn:handover:terminology:NIC` | Implementado con codificacion opcional |
| NOC | `Observation` | `Observation.code.coding` | `urn:handover:terminology:NOC` | Implementado |
| Scores NOC | `Observation.component` | `baseline/target/current` | `urn:handover-pro:noc-score` | Implementado |

### Limitaciones explicitas

- Los `system` NNN actuales son URNs locales del producto.
- `Profile URI` especifico para NNN sigue como `no especificado`.
- El repo no distribuye corpus oficial NANDA/NIC/NOC ni prueba de licencia.

## 4.1) Dominios Core estructurados del turno

Desde el estado del repo revisado el 2026-03-19, el Core agrega salida FHIR aditiva para dominios operativos del relevo sin romper compatibilidad previa:

- `turnContext`: `Observation` de encuesta con franja operativa, carga del turno e incidencias de servicio codificadas con URNs locales HANDOVER.
- `pendingTasks[]`: `Observation` por pendiente/reevaluacion con categoria, prioridad, estado, hora objetivo y criterio de escalado cuando aplica.
- `contingencyPlan`: `Observation` de encuesta con items a vigilar, acciones inmediatas, criterios de escalado y contacto de aviso.
- `exams[]` / `procedures[]`: se mantiene el contrato previo y se anaden notas aditivas para prioridad, responsable y hora objetivo/programada.

Estas extensiones siguen en sistemas locales `urn:handover-pro:*` y se documentan como soporte interoperable piloto-grade, no como perfil externo cerrado.

## 4.2) Contexto clinico contextual exportado de forma aditiva

Desde el estado del repo revisado el 2026-03-19, HANDOVER exporta contexto Core/UPP/SOP y senal de pendientes criticos de forma aditiva, sin romper el `Bundle` existente:

- `Composition.extension` documenta version del contrato contextual (`https://handover.app/fhir/StructureDefinition/handover-context-version`) y perfiles activos (`https://handover.app/fhir/StructureDefinition/handover-active-profile`).
- `Composition.section[title="Clinical context"]` agrega una seccion dedicada cuando existe contexto exportable real.
- La seccion contextual referencia una `Observation` resumida con perfiles activos, senales de prioridad visibles del pack activo y conteo de pendientes criticos abiertos.
- `pendingTasks[]` sigue siendo la fuente detallada de pendientes; el nuevo bloque contextual no reemplaza ni duplica el detalle operativo ya emitido.

### Politica de transporte FHIR

| Campo / contexto | Origen real | Destino FHIR | Clasificacion | Decision |
|---|---|---|---|---|
| Core siempre activo | `ProfileContext.coreProfileId` | `Composition.extension` + `Observation.component` | clinico | incluido para dejar trazabilidad del baseline clinico compartido |
| UPP activo | `profileTrace.unitProfileId` resuelto contra catalogo | `Composition.extension` + `Observation.component` | clinico | incluido por impacto real en continuidad de cuidados |
| SOP activos | `profileTrace.specialtyOverlayIds` resueltos contra catalogo | `Composition.extension` + `Observation.component` | clinico | incluidos si estan activos y compatibles |
| Senales contextuales visibles | `prioritySignals` de UPP/SOP activos | `Observation.component` | clinico | incluidas solo como labels visibles; no se exportan pesos ni heuristicas internas |
| Pendientes criticos abiertos | `pendingTasks[]` con prioridad critica / categoria critica o escalado | `Observation.component` + `Observation.note` | clinico | incluido como senal resumida; el detalle sigue en `pendingTasks[]` |
| Bedside checklist | `bedsideChecklist` | `Observation` ya existente + `Composition.section` ya existente | clinico | se mantiene sin duplicacion contextual |
| Resumen operativo del turno | `turnContext.operationalSummary` y `serviceIncidents` | `Observation` ya existente en seccion administrativa | operativo | se mantiene fuera del nuevo bloque clinico contextual |
| `mergeTrace`, `specialtySource`, `hasHumanSpecialtyOverride` | `profileTrace` | no exportado | operativo / tecnico | excluido por ser trazabilidad de runtime y no contexto clinico del paciente |
| `iceaContext`, pesos MPAC, placeholders analiticos | `ProfileContext.iceaContext` y scoring derivado | no exportado | analitico | excluido en PRE-11 para no abrir contrato ICEA runtime antes de PRE-12 |
| `visibleOutputs`, `focusAreas`, `sentinelEvents`, `explanations` de packs | catalogo de perfiles | no exportado | analitico / editorial | excluidos por describir el pack, no el estado clinico puntual del paciente |

### Notas de compatibilidad

- El contrato es aditivo: no cambia recursos base ni secciones previas obligatorias.
- El caller real del frontend ya estaba cableado: `src/screens/HandoverForm.tsx` construye `profileTraceInput` con `buildProfileTraceInput(profileRuntime)`, lo inyecta en `buildHandoverInputPayload(...)` y luego envia ese payload a `buildHandoverBundleAsync(...)` antes de encolar el Bundle.
- `validate:fhir` no requirio cambios porque la validacion local ya acepta `Composition.extension` y secciones adicionales validas en R4.
- No se modifica `fhir-client`, cola offline, sync ni writeback backend para habilitar este transporte.
## 4) Evidencia concreta por tipo NNN

### NANDA

- `dxNursingStructured` se prioriza sobre el texto legacy.
- Si no hay NANDA estructurado, el texto libre legacy sigue siendo compatible.
- Evidencia:
  - `src/lib/__tests__/fhir-map.nnn.spec.ts`
  - `tests/validation/handover-schema.spec.ts`

### NIC

- `treatments[]` sigue siendo opcional.
- `treatments[].code` con `system = "NIC"` agrega la codificacion NIC a `Procedure.code`.
- Evidencia:
  - `src/lib/__tests__/fhir-map.medications.spec.ts`
  - `tests/validation/handover-schema.spec.ts`

### NOC

- `outcomes[]` sigue siendo opcional y limitado a 3 resultados.
- Cada resultado se mapea a `Observation` con `category = outcome`.
- Evidencia:
  - `src/lib/__tests__/fhir-map.medications.spec.ts`
  - `tests/validation/handover-schema.spec.ts`

## 5) Catalogos NNN gobernados

- Frontend:
  - `EXPO_PUBLIC_NANDA_CATALOG_JSON|URL`
  - `EXPO_PUBLIC_NIC_CATALOG_JSON|URL`
  - `EXPO_PUBLIC_NOC_CATALOG_JSON|URL`
- Backend:
  - `NANDA_CATALOG_JSON|FILE`
  - `NIC_CATALOG_JSON|FILE`
  - `NOC_CATALOG_JSON|FILE`
- Endpoints:
  - `GET /api/catalogs/nanda`
  - `GET /api/catalogs/nic`
  - `GET /api/catalogs/noc`

Soporte real:

- placeholders locales;
- `licensed`, `version`, `warning`, `codes`;
- `ETag` y `Cache-Control`.

Lo que no hace el repo:

- no administra contratos de licencia;
- no incrusta catalogos completos comerciales;
- no prueba conformidad semantica externa con un terminoserver oficial para NNN.

## 6) Validacion y envio

- Cliente:
  - `FHIR_BASE_URL` / `EXPO_PUBLIC_FHIR_BASE_URL`
  - cola offline con cifrado AES-GCM;
  - reintentos y cabeceras de idempotencia.
- Backend:
  - `HANDOVER_FHIR_VALIDATION_MODE = off | remote`
  - cierres finales requieren firma clínica saliente en el Bundle
  - `pilot/production` requieren firma criptográfica fuerte backend-managed (`HANDOVER_PRIVATE_KEY_PATH` + `HANDOVER_PUBLIC_KEY_PATH`) y no aceptan `HANDOVER_SIGNATURE_DISABLED=true`
  - `BundleView` preserva `OperationOutcome.issue[]` del FHIR server cuando la transaccion es rechazada, para que frontend/sync muestren errores estructurados y no solo strings genéricos
- reenvio a FHIR con `Prefer: return=representation`

Notas de alcance:

- la validacion FHIR remota existe;
- `pnpm -w validate:fhir` valida tambien el fixture `tests/fixtures/fhir/representative-transaction-bundle.json` para cubrir diagnostico, medicacion, tratamiento, dispositivo, adjunto y escalas en un mismo Bundle;
- la validacion terminologica oficial para NNN no esta cerrada en este repo;
- el ETL lee el Bundle persistido, no un recurso writeback nuevo de ICEA.

## 7) Relacion con ICEA+

- ICEA+ consume datos derivados del Bundle ya persistido o de su payload analitico derivado.
- El repo no introduce writeback FHIR nuevo de `RiskAssessment` para el retorno bedside.
- La fuente clinica original para ETL sigue siendo `HandoverBundleRecord`.

## 8) Riesgos residuales de interoperabilidad

| Riesgo | Delimitacion actual |
|---|---|
| Terminologia oficial NNN no embebida | el repositorio usa URNs locales y BYO-license |
| Profiles NNN no cerrados | no se publica `profileUri` oficial en estos mappings |
| Consumo externo mas estricto | un tercero puede requerir ValueSets/profiles adicionales no presentes aqui |

Este documento sirve para trazabilidad tecnica de piloto, no como declaracion de conformidad interoperable completa frente a un perfil externo especifico.




