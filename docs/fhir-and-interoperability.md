# Interoperabilidad FHIR (estado piloto-grade)

> Estado revisado el 2026-03-09. El repo soporta mapeo FHIR real para NNN y transaccion clinica via Django/DRF, pero no declara perfiles regulatorios cerrados ni terminologia oficial licenciada dentro del repositorio.

## 1) Arquitectura real

- La app envia bundles a `POST /api/fhir/transaction`.
- Django/DRF concentra validacion, firma opcional, auditoria y side effects ICEA.
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
  - firma opcional de `bundle.signature`
  - reenvio a FHIR con `Prefer: return=representation`

Notas de alcance:

- la validacion FHIR remota existe;
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
