# Matriz de trazabilidad NNN + ICEA+ (requisito → implementación → test → evidencia)

> Uso: completar por release/piloto. No registrar PHI en esta matriz; usar IDs de artefacto.

## Leyenda
- **Estado:** Pendiente / En curso / Aprobado / Bloqueado.
- **Tipo req.:** Funcional, rendimiento, seguridad, regulatorio.
- **Evidencia:** ruta de reporte, acta, captura de log técnico anonimizado, ticket de remediación.

## Matriz

| ID requisito | Tipo req. | Requisito verificable | Implementación (módulo/endpoint/proceso) | Prueba asociada (unit/int/e2e/regresión) | Evidencia esperada | Estado | Responsable |
|---|---|---|---|---|---|---|---|
| NNN-001 | Funcional | NNN visible pero no obligatoria para cerrar handover | Flujo de formulario clínico y reglas de validación | E2E: guardado sin seleccionar NIC/NOC | Reporte E2E + video/trace anonimizado | Pendiente | QA + Clinical Lead |
| NNN-002 | Funcional | Sugerencias IA se presentan como apoyo y no diagnóstico | Capa de presentación + copy regulatorio | E2E + revisión clínica documental | Captura de pantalla + checklist de copy | Pendiente | Clinical Lead |
| NNN-003 | Funcional | Flujo continúa cuando IA no está disponible | Manejo de errores/degradación en cliente/backend | E2E: IA caída y continuidad operativa | Reporte E2E + log de fallback | Pendiente | QA |
| IDEMP-001 | Funcional | Idempotencia por `bundle identifier` | Generación/validación de identificador de bundle | Unit: reintentos no cambian identificador | Reporte unit + hash artefacto | Pendiente | Engineering |
| IDEMP-002 | Funcional | Deduplicación por `request_id` | Middleware/API transaccional + outbox | Unit/Integración: doble envío controlado | Reporte pruebas + log técnico | Pendiente | Engineering |
| IDEMP-003 | Funcional | Reintentos offline no duplican en FHIR/outbox/ETL | Cola offline + sincronización + pipeline ETL ICEA+ | Unit + integración + regresión | Reporte combinado + query de no duplicados | Pendiente | QA + Data |
| ICEA-001 | Integración | Webhook ICEA+ valida HMAC y anti-replay | Endpoint webhook + validación firma/ventana | Integración: firma válida/inválida/replay | Reporte integración + muestras de payload redactadas | Pendiente | Security |
| ICEA-002 | Integración | `GET /api/handover/{id}` refleja estado coherente post-evento | API handover + estado integración | Integración + regresión | Reporte API contract | Pendiente | Backend |
| FHIR-001 | Integración | Mapeo FHIR para NNN cumple estructura/códigos | Mapper FHIR NNN | Integración: validación esquema/semántica | Resultado validación + fixtures versionadas | Pendiente | Interop |
| REG-001 | Regulatorio | Declaración explícita “apoyo, no diagnóstico” en expediente | Plan QA + Anexo II + QMS | Revisión documental | Acta de revisión regulatoria | Pendiente | Regulatory |
| PERF-001 | Rendimiento | No incremento clínicamente relevante de tiempo de registro | Protocolo baseline vs post por unidad | Medición comparativa + análisis estadístico descriptivo | Informe por unidad firmado | Pendiente | QA Ops |
| PERF-002 | Rendimiento | P90 y tasa de abandono/error bajo control | Instrumentación de métricas operativas | Comparativa IA ON/OFF | Dashboard/export + informe | Pendiente | QA Ops |
| SEC-001 | Seguridad | No logging de PHI/tokens | Config logging app/backend | Pruebas de seguridad + revisión de logs | Evidencia checklist seguridad | Pendiente | Security |
| SEC-002 | Seguridad | RBAC/scopes/S2S aplicados en endpoints críticos | Middleware authz + policy scopes | Integración de autorización | Reporte de casos permitidos/denegados | Pendiente | Security + Backend |
| SEC-003 | Seguridad | Rate limit/retry/replay protegidos | Gateway/API/webhook controls | Integración/seguridad | Evidencia técnica + configuración versionada | Pendiente | Security |

## Control de cambios de la matriz
| Fecha | Release | Cambio | Autor | Aprobador |
|---|---|---|---|---|
| YYYY-MM-DD | vX.Y.Z | Alta/actualización inicial | TBD | TBD |
