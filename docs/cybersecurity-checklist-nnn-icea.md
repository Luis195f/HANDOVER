# Checklist de ciberseguridad NNN + ICEA+ (basado en evidencia real)

> Corte documental: 2026-03-09. Estados: `Implementado`, `Parcial`, `Pendiente`.

## 1) Logging, PHI y observabilidad

| Control | Evidencia real | Tests | Estado | Riesgo residual |
|---|---|---|---|---|
| Logs ICEA no exponen payload clinico crudo ni secretos | `backend/api/icea.py::safe_icea_event_summary`, hashing de `bundle_id/patient_id/unit_id` | `backend/api/tests/test_icea_webhook.py` | Implementado | Cobertura centrada en outbox; otras rutas del backend requieren vigilancia continua |
| ETL/logs no exponen Bearer ni `patient_id` en duplicados | `backend/api/views.py`, persistencia idempotente por `request_id` | `backend/api/tests/test_handover_etl_read.py` | Implementado | La prueba cubre el flujo documentado, no toda la aplicacion |
| Timing metrics no guardan contenido clinico | `backend/api/views.py::HandoverTimingMetricsView`, `docs/metrics.md` | `backend/api/tests/test_handover_timing_metrics.py` | Implementado | El valor de `request_id` sigue siendo dato operativo sensible y debe tratarse como tal |

## 2) Tokens, secretos y credenciales

| Control | Evidencia real | Tests | Estado | Riesgo residual |
|---|---|---|---|---|
| Secretos por variables de entorno y validacion minima | `backend/api/icea_client.py`, `backend/api/icea_pipeline.py`, `backend/api/icea_bridge_service.py` | `backend/api/tests/test_icea_webhook.py`, `backend/api/tests/test_icea_bridge.py` | Implementado | No hay evidencia en repo de rotacion automatica ni vault externo |
| `ICEA_BRIDGE_MODEL_ID` invalido o ausente falla de forma explicita | `backend/api/icea_bridge_service.py` | `backend/api/tests/test_icea_bridge.py` | Implementado | Sigue siendo una validacion de arranque/logica, no una gestion de secretos completa |
| Politica de rotacion de secretos | No hay automatizacion ni runbook en este paquete | No aplica | Pendiente | Riesgo operativo del entorno piloto |

## 3) Service-to-service auth con ICEA

| Superficie | Mecanismo real | Evidencia | Estado | Riesgo residual |
|---|---|---|---|---|
| Webhook tecnico HANDOVER -> ICEA+ | HMAC compartido + `Idempotency-Key`; anti-replay opcional | `backend/api/icea_client.py`, `backend/api/tests/test_icea_webhook.py` | Parcial | Anti-replay no esta forzado por defecto |
| Pipeline/bridge HANDOVER -> ICEA+ | Bearer estatico o `client_credentials` | `backend/api/icea_pipeline.py`, `backend/api/tests/test_icea_pipeline_api.py`, `backend/api/tests/test_icea_bridge.py` | Implementado | La robustez final depende del proveedor ICEA+ y de la configuracion del entorno |
| App movil -> ICEA+ | No permitido; la app habla con HANDOVER | `src/lib/admin-api.ts`, `src/lib/icea-bridge-api.ts`, `backend/api/urls.py` | Implementado | Cualquier integracion futura debe mantener este principio |

## 4) HMAC, replay, retry e idempotencia

| Control | Evidencia real | Tests | Estado | Riesgo residual |
|---|---|---|---|---|
| Firma HMAC sobre JSON canonico | `backend/api/icea_client.py` | `backend/api/tests/test_icea_webhook.py` | Implementado | Depende de que el receptor valide la misma canonizacion |
| Anti-replay con `timestamp` + `nonce` | Disponible por flag `ICEA_WEBHOOK_ANTI_REPLAY` | `backend/api/tests/test_icea_webhook.py` | Parcial | Debe activarse explicitamente en el piloto si el riesgo lo exige |
| Reintentos con backoff y estados `retry/failed` | `backend/api/icea.py`, comando `flush_icea_outbox` | `backend/api/tests/test_icea_webhook.py` | Implementado | La recuperacion final sigue dependiendo del receptor remoto |
| Idempotencia local por `request_id` | `HandoverBundleRecord` + `IceaOutboundEvent` | `backend/api/tests/test_handover_etl_read.py`, `backend/api/tests/test_icea_webhook.py`, `backend/api/tests/test_icea_transaction.py` | Implementado | Si el cliente cambia `request_id`, crea una nueva transaccion legitima |

## 5) RBAC, scopes y accesos

| Control | Evidencia real | Tests | Estado | Riesgo residual |
|---|---|---|---|---|
| ETL read requiere `client-credentials` + rol/scope | `backend/api/views.py::HandoverEtlReadView` | `backend/api/tests/test_handover_etl_read.py` | Implementado | El endpoint devuelve PHI a servicios autorizados; TLS y custodia de credenciales siguen siendo criticos |
| Dashboard/pipeline requiere `supervisor/admin`; acciones solo `admin` | `backend/api/views_icea.py` | `backend/api/tests/test_icea_pipeline_api.py`, `backend/api/tests/test_role_acl.py` | Implementado | Cambios futuros en claims pueden abrir superficie si no se re-testan |
| Bridge clinico y patient-risk limitados por rol/unidad | `backend/api/views_icea_bridge.py` | `backend/api/tests/test_icea_bridge.py` | Implementado | La asignacion de `unitIds` en el IdP debe ser correcta |

## 6) Almacenamiento, retencion y borrado

| Control | Evidencia real | Tests | Estado | Riesgo residual |
|---|---|---|---|---|
| Cola offline cifrada en cliente | `src/lib/queue.ts`, `src/lib/sync.ts` | `tests/queue/offline-queue.spec.ts` | Implementado | La custodia de la clave sigue siendo responsabilidad del entorno del cliente |
| Retencion de bundles locales con expiracion por defecto | `backend/api/models.py::HandoverBundleRecord.default_expiry()` | `backend/api/tests/test_handover_etl_read.py` | Parcial | No hay prueba de expurgo/borrado seguro en este paquete |
| Backup/restore y borrado seguro | `scripts/backup-db.sh`, `scripts/backup-media.sh`, `scripts/restore-db.sh`, `scripts/restore-media.sh`, `.github/workflows/backup.yml`, `docs/backup-restore-drill.md` | Drill local reproducible + workflow nocturno | Parcial | El restore del repo es scratch-first y no sustituye snapshots infra, vault ni borrado seguro del proveedor |

## 7) Dependencias, hardening e incident response

| Control | Evidencia real | Estado | Riesgo residual |
|---|---|---|---|
| Hardening documental general | `docs/SECURITY_HARDENING.md`, `docs/security-and-auth.md` | Parcial | No aporta por si solo reporte de escaneo actualizado |
| Dependency scanning ejecutado para este paquete | No hay reporte adjunto en el repo para este corte | Pendiente | Queda fuera del cierre de este paquete documental |
| Plan de respuesta a incidentes especifico para NNN + ICEA+ | No hay runbook especifico en los documentos objetivo | Pendiente | Debe completarse en operaciones/QMS |

## 8) Resultado actual del checklist

- Sin evidencia de hallazgo critico abierto en el codigo revisado para NNN + ICEA+.
- Con pendientes reales antes de hablar de cierre regulatorio fuerte:
  - anti-replay obligatorio por entorno;
  - rotacion y custodia de secretos;
  - dependency scanning documentado;
  - DR de infraestructura y borrado seguro fuera del repo.

Resultado recomendado para este paquete: `Aprobado con hallazgos abiertos controlados para piloto`, no `Aprobado definitivo`.
