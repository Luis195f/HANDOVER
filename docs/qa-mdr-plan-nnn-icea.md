# Plan de QA clínico + cumplimiento MDR para NNN + ICEA+

## 1) Objetivo y alcance
Este plan define cómo verificar, validar y documentar los módulos **NNN** (NANDA/NIC/NOC) y la integración **ICEA+** para demostrar, de forma auditable, que:

1. se mantiene el principio de **apoyo, no diagnóstico**;
2. no se incrementa de forma clínicamente relevante el tiempo de registro;
3. se preservan seguridad, trazabilidad y control documental alineados con MDR (Anexo II).

> Declaración de uso previsto: NNN e ICEA+ son funcionalidades de apoyo a la documentación y coordinación clínica. No generan diagnóstico autónomo ni sustituyen el juicio profesional.

## 2) Criterios de aceptación globales (Go/No-Go)
- **Clínico-regulatorio:** todas las pruebas de no-autonomía diagnóstica y de continuidad de flujo clínico en degradación deben pasar.
- **Rendimiento operativo:** no incremento clínicamente relevante del tiempo de registro (definido por comité clínico/QMS); si hay incremento, debe existir beneficio compensatorio documentado y aprobado.
- **Seguridad:** checklist de ciberseguridad completada sin hallazgos críticos abiertos.
- **Evidencia MDR:** trazabilidad completa requisito→implementación→test→evidencia archivada.

## 3) Estrategia de QA funcional

### 3.1 Unit tests (idempotencia y consistencia)
**Objetivo:** evitar duplicaciones y efectos secundarios en reintentos/offline.

Casos mínimos:
- `bundle identifier` estable bajo reintentos controlados.
- `request_id` único por operación y reutilizado correctamente para deduplicación.
- reintentos offline no duplican transacciones válidas ya confirmadas.
- no duplicación en:
  - servidor FHIR (Bundle/recursos derivados),
  - outbox/cola offline,
  - persistencia ETL vinculada a ICEA+.

**Evidencia esperada:** reporte de tests + logs técnicos sin PHI + hash de artefactos.

### 3.2 Pruebas de integración
Cobertura mínima:
- webhook ICEA+ (firma/HMAC, replay window, códigos de error, retry controlado);
- `GET /api/handover/{id}` (consistencia de payload y estado tras eventos ICEA+);
- mapeo FHIR para elementos NNN (estructura, códigos, cardinalidades, trazabilidad).

**Criterio de paso:** contrato de datos estable, validaciones sintácticas/semánticas en verde, sin ruptura de compatibilidad con handover base.

### 3.3 E2E clínico-operativas
Escenarios obligatorios:
- happy path completo (captura→sugerencia→confirmación clínica→persistencia→auditoría);
- degradación controlada (latencia alta / servicio parcial);
- IA caída con continuidad del flujo clínico sin bloqueo;
- NIC/NOC opcionales (no bloquear guardado si no se aceptan);
- NNN visible pero no obligatoria.

**Resultado esperado:** el profesional siempre puede completar el handover sin aceptar sugerencias.

### 3.4 Regresión
- Verificar que el flujo de handover base (sin NNN/ICEA+) no se rompe.
- Rejecutar suite crítica en cada release candidate y en cambios de configuración de seguridad.

## 4) Plan de rendimiento (baseline vs post)

### 4.1 Diseño de medición
- Baseline: referencia operacional definida en Prompt 1.
- Post-implementación: medición equivalente, mismo tipo de usuarios, ventana temporal y carga comparable.
- Segmentación obligatoria por unidad/servicio (ej. UCI, medicina interna, urgencias).

### 4.2 Métricas mínimas
- mediana de time-to-complete;
- percentil 90;
- tasa de abandono/error del registro;
- comparación con IA habilitada vs deshabilitada.

### 4.3 Criterio de aceptación
- No incremento clínicamente relevante de tiempo de registro; **o**
- incremento justificado por beneficio compensatorio documentado (seguridad clínica, completitud, continuidad asistencial), con aprobación formal.

## 5) Seguridad y ciberseguridad
Controles mínimos a ejecutar y evidenciar:
- OWASP Mobile (cliente) + controles backend API;
- no registro de PHI/tokens en logs de app/backend/observabilidad;
- validación de secretos (rotación, almacenamiento, exposición en CI/CD);
- webhook ICEA+ con HMAC y anti-replay;
- scopes/RBAC/S2S en endpoints críticos;
- rate limiting, retry y protección ante replay/doble envío;
- políticas de almacenamiento/retención/borrado seguro.

Referenciar checklist operativa: `docs/cybersecurity-checklist-nnn-icea.md`.

## 6) Estructura documental MDR (Anexo II)
Para cada requisito funcional y no funcional, capturar:
1. función prevista;
2. límites de uso;
3. riesgo asociado;
4. mitigación implementada;
5. evidencia de verificación;
6. evidencia de validación.

Declaraciones obligatorias en expediente técnico:
- NNN e ICEA+ apoyan documentación y coordinación clínica.
- No realizan diagnóstico autónomo.
- No sustituyen juicio clínico profesional.

## 7) Paquete de evidencias para auditoría interna
Conservar, versionado por release:
- matriz de trazabilidad firmada por QA/Regulatorio;
- informe de rendimiento por unidad (baseline vs post);
- registro de decisiones clínicas de IA (aceptación/rechazo);
- checklist de ciberseguridad y plan de remediación;
- resultados de pruebas (unit/integration/E2E/regresión) y logs técnicos depurados;
- acta de revisión clínica/regulatoria con decisión Go/No-Go.

## 8) Ejecución operativa por fase
1. **Preparación:** congelar alcance, identificar requisitos y asignar dueños de evidencia.
2. **Ejecución técnica:** correr suites funcionales, integración, E2E y seguridad.
3. **Rendimiento:** recopilar baseline/post por unidad, analizar diferencias.
4. **Consolidación MDR:** completar trazabilidad y anexos de verificación/validación.
5. **Revisión final:** comité clínico + QA + regulatorio; emisión de acta.

## 9) Roles y responsabilidades
- **QA líder:** coordina plan, ejecución y consolidación de evidencias.
- **Líder clínico:** valida criterios de aceptabilidad clínica y no-autonomía diagnóstica.
- **Seguridad:** ejecuta checklist y aprueba controles críticos.
- **Regulatorio/QMS:** integra evidencias en expediente técnico MDR.
- **Engineering:** remedia hallazgos y asegura trazabilidad técnica.

## 10) Criterio de cierre
El plan se considera cerrado cuando existe:
- cobertura de pruebas obligatorias completada;
- matriz de trazabilidad sin huecos críticos;
- informe de rendimiento por unidad revisado;
- checklist de seguridad cerrada o con plan de acción aprobado;
- evidencia MDR compilada y referenciada para auditoría.

## Cobertura añadida para orquestación de pipeline

Casos verificados en backend:
- autorización en `/api/icea/status`, `/api/icea/events`, `/api/icea/dashboard-summary` y `/api/icea/actions/*`;
- `200/4xx/5xx` con contrato JSON estable para consultas y acciones;
- estado vacío (`404 icea_snapshot_not_found`);
- error remoto/timeout (`502 icea_transport_error` / `502 icea_remote_error`);
- persistencia y consulta de snapshots/eventos por unidad;
- refresh manual de `dashboard-summary` sin abrir acceso a usuarios no autorizados.

## Cobertura añadida para el puente analitico

Casos verificados en backend/frontend:
- mapper analitico: payload completo y degradado, calculo minimo de `missingnessRate`, `structuredCompletenessRate` y warnings trazables;
- trigger post-persistencia: el bridge se crea solo despues de `POST /api/fhir/transaction` exitoso y tras persistir `HandoverBundleRecord`;
- resiliencia clinica: un timeout o fallo de ICEA+ deja `IceaBridgeRequest.status=failed` sin revertir el guardado clinico;
- API bridge: permisos `nurse/supervisor/admin`, `403/404/400/200/202` y contrato JSON estable para `status`, `summary` y `retry`;
- scoring modes: distincion visible entre `immediate_provisional` y `enriched_followup`, con `ENABLE_ICEA_ENRICHED_SCORING=false` por defecto hasta habilitacion explicita;
- validacion operativa temprana: si falta `ICEA_BRIDGE_MODEL_ID` o es invalido, HANDOVER deja error explicito y no intenta entrega ambigua;
- contrato prudente de status: `remoteStatusSupported`, `remoteRefreshAttempted` y `localStatusIsAuthoritative` cuando no existe endpoint remoto de score;
- frontend: `pnpm typecheck` para nuevos tipos, hooks y visualizacion minima en dashboard admin.

Evidencia ejecutada en este corte:
- `pytest backend/api/tests/test_icea_bridge.py backend/api/tests/test_icea_pipeline_api.py backend/api/tests/test_icea_webhook.py backend/api/tests/test_handover_etl_read.py -q`
- `pnpm typecheck`





Cobertura bedside añadida en este corte:
- endpoint `/api/icea/patient-risk`: casos `no data`, `stale data`, `valid data`, `failed remote state`, `flag off` y permisos por rol.
- UI prudente: banner de paciente y lista de pacientes muestran apoyo analitico como soporte, nunca como diagnostico autonomo.
- flags de despliegue: `ENABLE_ICEA_PATIENT_RISK` y `ENABLE_ICEA_CAUSAL_SUMMARY` verificados como puertas de activacion separadas.
