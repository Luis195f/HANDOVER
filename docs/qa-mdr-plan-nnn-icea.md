# Plan de QA clinico + paquete MDR piloto para NNN + ICEA+

> Estado revisado contra el repo el 2026-03-09. Este paquete deja trazabilidad tecnica y limites operativos para un piloto serio, pero no declara cumplimiento MDR total ni cierre regulatorio completo.

## 1) Contexto real y arquitectura vigente

- Cliente: React Native/Expo.
- Backend unico: Django/DRF.
- Transaccion clinica principal: `POST /api/fhir/transaction`.
- Lectura ETL del Bundle clinico persistido: `GET /api/handover/{bundle_id}`.
- NNN:
  - captura estructurada opcional en formulario;
  - catalogos gobernados `NANDA`/`NIC`/`NOC` con placeholders locales y carga BYO-license;
  - mapeo FHIR a `Condition`, `Procedure` y `Observation`.
- ICEA+:
  - webhook tecnico desacoplado con outbox local;
  - coordinacion de pipeline bajo `/api/icea/*`;
  - bridge analitico bajo `/api/icea/bridge/*`;
  - resumen bedside prudente bajo `/api/icea/patient-risk` solo si las flags estan activas.

No existe en el estado actual del repo una arquitectura paralela para NNN + ICEA+. Todo el soporte documental debe referenciar esta arquitectura Django-only.

## 2) Objetivo del piloto

El objetivo del paquete NNN + ICEA+ es demostrar, con evidencia trazable del repo actual, que HANDOVER puede entrar en conversacion seria de piloto para:

1. capturar NNN sin volver obligatoria la codificacion estructurada;
2. intercambiar y persistir bundles FHIR con trazabilidad minima y firma obligatoria en cierres finales;
3. integrar ICEA+ como soporte analitico no bloqueante y no autonomo;
4. limitar exposicion de PHI en logs y canales tecnicos instrumentados;
5. dejar visibles los vacios que siguen siendo operativos o regulatorios.

## 3) Alcance del paquete

### Dentro de alcance y respaldado por codigo/tests

- Catalogos NNN gobernados con placeholders, `ETag`, `Cache-Control` y carga bajo licencia externa.
- Diagnosticos NANDA, intervenciones NIC y resultados NOC como campos opcionales y con mapeo FHIR.
- Persistencia local del Bundle clinico por `request_id`.
- Outbox ICEA+ con HMAC, idempotencia, retry y logging minimizado.
- ETL read con `client_credentials`, roles/scopes y `ETag`.
- Pipeline status/dashboard via HANDOVER.
- Bridge analitico ICEA+ con modos `immediate_provisional` y `enriched_followup`.
- Resumen bedside prudente para `patient-risk`, con filtros por unidad y mensajes de "no sustituye juicio clinico".
- Metricas de timing por seccion (`sbar`, `vitals`, `diagnostics`, `treatments`) sin contenido clinico.

### Fuera de alcance o no cerrado en el repo

- Demostracion de cumplimiento MDR integral.
- Benchmark automatizado de mediana/P90 de time-to-complete por unidad.
- Log persistente dedicado de aceptacion/rechazo clinico de sugerencias NNN/ICEA.
- Evidencia automatizada de dependency scanning, pentest o restauracion de backups dentro de este paquete.
- Suite E2E clinica completa que recorra todo NNN + ICEA+ de punta a punta en UI real.

## 4) Evidencia tecnica disponible hoy

| Area | Implementacion principal | Tests en repo | Estado |
|---|---|---|---|
| NNN opcional y no bloqueante | `src/validation/schemas.ts`, `src/screens/components/DiagnosisAutocomplete.tsx`, `src/screens/components/TreatmentsSection.tsx`, `src/screens/components/OutcomesSection.tsx`, `src/screens/handover/visibility.ts` | `tests/validation/handover-schema.spec.ts`, `src/screens/__tests__/handover.visibility.spec.ts`, `src/screens/__tests__/handover.sections.spec.tsx`, `src/screens/components/__tests__/DiagnosisAutocomplete.spec.tsx`, `src/screens/components/__tests__/TreatmentsSection.spec.tsx`, `src/screens/components/__tests__/OutcomesSection.spec.tsx` | Parcial: soporte real, sin E2E clinico completo |
| Catalogos BYO-license | `src/catalogs/*.ts`, `src/catalogs/governedCatalog.ts`, `backend/api/views_catalogs.py` | `src/catalogs/__tests__/nandaCodes.spec.ts`, `src/catalogs/__tests__/nicCodes.spec.ts`, `src/catalogs/__tests__/nocCodes.spec.ts`, `backend/api/tests/test_governed_catalog_api.py`, `backend/api/tests/test_nanda_catalog_api.py` | Soportado |
| FHIR NNN | `src/lib/fhir-map.ts`, `src/lib/fhir-map/nnn.ts`, `src/lib/fhir-terminology.ts` | `src/lib/__tests__/fhir-map.nnn.spec.ts`, `src/lib/__tests__/fhir-map.medications.spec.ts`, `tests/fhir-map.spec.ts` | Soportado con URNs locales y profiles no cerrados |
| Persistencia ETL | `backend/api/icea_transaction.py`, `backend/api/views.py`, `backend/api/models.py::HandoverBundleRecord` | `backend/api/tests/test_handover_etl_read.py`, `backend/api/tests/test_icea_transaction.py` | Soportado |
| Webhook ICEA+ | `backend/api/icea.py`, `backend/api/icea_client.py` | `backend/api/tests/test_icea_webhook.py` | Soportado, anti-replay opcional |
| Pipeline ICEA+ | `backend/api/icea_pipeline.py`, `backend/api/views_icea.py`, `backend/api/dashboard_summary.py` | `backend/api/tests/test_icea_pipeline_api.py`, `backend/api/tests/test_icea_dashboard_summary.py` | Soportado |
| Bridge analitico | `backend/api/icea_payload_mapper.py`, `backend/api/icea_bridge_service.py`, `backend/api/views_icea_bridge.py` | `backend/api/tests/test_icea_bridge.py` | Soportado, con limites explicitos de configuracion/status |
| Bedside patient risk | `backend/api/icea_clinical_feedback.py`, `backend/api/views_icea_bridge.py`, `src/lib/icea-bridge-api.ts` | `backend/api/tests/test_icea_bridge.py` | Soportado bajo flags |
| Timing por seccion | `src/hooks/useHandoverTiming.ts`, `src/lib/handover-timing-submit.ts`, `backend/api/views.py::HandoverTimingMetricsView` | `backend/api/tests/test_handover_timing_metrics.py`, `backend/api/tests/test_icea_dashboard_summary.py` | Parcial: no calcula mediana/P90 ni time-to-complete total |

## 5) Criterios piloto Go/No-Go

### Go tecnico minimo

- Suites criticas de NNN + ICEA+ en verde para el corte del piloto.
- Variables de entorno del entorno piloto validadas:
  - catalogos NNN licenciados si se pretende usar catalogo completo;
  - `ICEA_WEBHOOK_*` para outbox tecnico;
  - `ICEA_API_*` y `ICEA_BRIDGE_MODEL_ID` si se habilita bridge/patient-risk.
- Capa `/api/icea/*` accesible solo via HANDOVER con roles/scopes esperados.
- Resumen bedside, si se habilita, visible como soporte prudente y no como diagnostico autonomo.
- Checklist de ciberseguridad cerrado al menos sin hallazgos criticos abiertos.
- Evidencia de que el cierre final devuelve `400` si falta firma clínica o si la firma criptográfica de transporte es inválida.

### Go operativo adicional

- Acta clinica que acepte que NNN es opcional y que ICEA+ es soporte no bloqueante.
- Evidencia de licencia BYO para NANDA/NIC/NOC si se despliega mas alla de placeholders.
- Informe baseline/post completado fuera del repo con datos del centro piloto.

### No-Go explicito

- `ICEA_BRIDGE_MODEL_ID` ausente o invalido cuando se exige score real.
- Falta de filtros de unidad/rol para `patient-risk`.
- Cualquier dependencia de llamada directa desde la app a ICEA+.
- Cualquier despliegue piloto que dependa de `HANDOVER_SIGNATURE_DISABLED=true`, de firma cliente opcional o de cierre final sin firma clínica.
- Documentacion que afirme cumplimiento regulatorio total o E2E clinico cerrado sin evidencia adicional.

## 6) Estrategia de verificacion y validacion

### 6.1 NNN funcional

Cobertura real disponible:

- opcionalidad de NIC/NOC y compatibilidad con payload legacy;
- autocompletado NANDA y fallback a texto libre;
- gate de licencia antes de habilitar catalogos completos;
- mapeo FHIR de NANDA/NIC/NOC con namespaces locales.

Limitacion:

- no hay una suite E2E completa que pruebe, en UI real, guardado final de handover con todas las variantes NNN.

### 6.2 ICEA+ tecnico y analitico

Cobertura real disponible:

- side effects solo despues de transaccion FHIR exitosa;
- fallo ICEA no revierte guardado clinico;
- outbox con estados `queued/retry/delivered/failed`;
- bridge con estados `queued/sent/accepted/pending/scored/failed/stale`;
- resumen bedside prudente con filtros por rol/unidad.

Limitacion:

- el repo trata el estado local como fuente autoritativa cuando no existe `ICEA_BRIDGE_STATUS_PATH`; eso es intencionado, pero debe aceptarse como limite del piloto.

### 6.3 Seguridad y PHI

Cobertura real disponible:

- hash de identificadores sensibles en logs ICEA;
- pruebas de no exposicion de tokens/payload sensible en logs del outbox y ETL;
- metrica de timing sin texto clinico;
- control de acceso por rol/scope para ETL, dashboard y bridge.

Limitacion:

- la evidencia de "no PHI en logs" no cubre absolutamente todo el backend; cubre especificamente las superficies instrumentadas y testeadas de este paquete.

### 6.4 Rendimiento operativo

Cobertura real disponible:

- instrumentacion por seccion y agregacion por unidad;
- dashboard con `handoverTiming`.

Limitacion:

- el repo no calcula por si solo mediana, P90 ni abandono de handover completo;
- esos datos siguen siendo una tarea operativa/BI del piloto.

## 7) Riesgos residuales aceptados para piloto

| Riesgo residual | Delimitacion actual | Mitigacion disponible |
|---|---|---|
| Interpretacion excesiva de ICEA+ | El bridge puede devolver resumen/provisional score, pero no existe writeback FHIR de un recurso clinico final ni una conciliacion downstream cerrada | copy prudente, flags, `patient-risk` con mensaje de "no sustituye juicio clinico", estado local autoritativo |
| Uso de terminologia NNN sin licencia | El repo solo trae placeholders y no demuestra contrato de licencia | gate explicito, variables BYO-license, documentar licencia del operador |
| Falta de log dedicado de decision clinica | No se persiste aun aceptacion/rechazo/modificacion de sugerencias | usar la plantilla `docs/clinical-decision-log-template-nnn-icea.md` como registro operativo separado |
| Evidencia de rendimiento incompleta | Solo hay timing por seccion | completar baseline/post y percentiles fuera del repo antes del Go final |
| Cierre regulatorio parcial | La trazabilidad tecnica esta disponible, pero no sustituye expediente, revision clinica ni aprobacion QMS | mantener este paquete como soporte a auditoria interna, no como declaracion de conformidad total |

## 8) Evidencia a adjuntar por release/piloto

- `docs/traceability-matrix-nnn-icea.md`
- `docs/cybersecurity-checklist-nnn-icea.md`
- `docs/performance-report-template-nnn-icea.md`
- `docs/clinical-decision-log-template-nnn-icea.md`
- reporte de tests frontend NNN
- reporte de tests backend ICEA/ETL
- evidencia de configuracion/licencia del entorno piloto
- acta clinica/regulatoria de Go/No-Go

## 9) Comandos recomendados para este paquete

Frontend:

- `pnpm exec vitest run src/screens/components/__tests__/DiagnosisAutocomplete.spec.tsx src/catalogs/__tests__/diagnosisCodes.spec.ts src/catalogs/__tests__/nandaCodes.spec.ts`
- `pnpm exec vitest run src/screens/components/__tests__/TreatmentsSection.spec.tsx src/screens/__tests__/handover.sections.spec.tsx src/lib/__tests__/fhir-map.medications.spec.ts tests/validation/handover-schema.spec.ts`
- `pnpm exec vitest run src/screens/components/__tests__/OutcomesSection.spec.tsx src/screens/__tests__/handover.visibility.spec.ts src/lib/__tests__/fhir-map.medications.spec.ts tests/validation/handover-schema.spec.ts`

Backend:

- `pytest backend/api/tests/test_icea_webhook.py backend/api/tests/test_icea_pipeline_api.py backend/api/tests/test_icea_bridge.py backend/api/tests/test_handover_etl_read.py backend/api/tests/test_handover_timing_metrics.py -q`

## 10) Criterio de cierre de este paquete documental

Este paquete se considera cerrado cuando:

1. la trazabilidad documento -> codigo -> test -> limitacion queda completa;
2. no quedan afirmaciones aspiracionales sin respaldo;
3. los riesgos residuales siguen visibles y acotados;
4. el material permite una conversacion seria de piloto sin fingir cierre regulatorio total.



