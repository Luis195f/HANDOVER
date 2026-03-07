# Checklist de ciberseguridad para NNN + ICEA+

> Uso: completar por entorno (dev/staging/prod) y por release. Marcar N/A con justificación.

## 1) Logging, PHI y observabilidad
- [ ] Logs de app/backend excluyen PHI en texto claro.
- [ ] Logs no contienen tokens JWT, API keys ni secretos.
- [ ] Existe política de redacción/masking para campos sensibles.
- [ ] Se definen niveles de log por entorno (sin debug sensible en producción).
- [ ] Existe trazabilidad por `request_id` sin exponer datos clínicos identificables.

## 2) Tokens, secretos y credenciales
- [ ] Secretos almacenados en gestor seguro (no hardcoded).
- [ ] Rotación de secretos definida y probada.
- [ ] Variables sensibles no se imprimen en CI/CD ni en excepciones.
- [ ] Scopes mínimos (least privilege) para tokens S2S.
- [ ] Revocación/expiración activa para tokens comprometidos.

## 3) Webhook ICEA+ y HMAC
- [ ] Firma HMAC obligatoria en webhook ICEA+.
- [ ] Verificación de timestamp + ventana anti-replay implementada.
- [ ] Rechazo explícito de firmas inválidas o ausentes (`401/403`).
- [ ] Secret de webhook diferenciado por entorno.
- [ ] Registros de fallo de verificación sin volcar payload sensible.

## 4) Rate limits, retry, replay e idempotencia
- [ ] Rate limiting activo en endpoints críticos.
- [ ] Política de retry con backoff exponencial y tope de intentos.
- [ ] Protección frente a replay (nonce/timestamp/request_id).
- [ ] Idempotencia verificada para reintentos offline.
- [ ] No duplicación confirmada en FHIR, outbox y ETL.

## 5) RBAC, scopes y comunicaciones S2S
- [ ] RBAC aplicado en endpoints de handover/IA/ICEA+.
- [ ] Validación de scopes por operación crítica.
- [ ] Integraciones S2S usan credenciales dedicadas y auditables.
- [ ] Principio de mínimo privilegio documentado.
- [ ] Revisión periódica de permisos y cuentas técnicas.

## 6) Almacenamiento, retención y borrado
- [ ] Cifrado en reposo para datos y colas offline.
- [ ] Política de retención documentada para logs y evidencias.
- [ ] Borrado seguro/expurgo probado según ventana definida.
- [ ] Backups protegidos y con restauración validada.
- [ ] Exportes de auditoría incluyen controles de integridad.

## 7) OWASP Mobile + backend API
- [ ] OWASP Mobile: almacenamiento seguro, protección de credenciales, TLS correcto.
- [ ] OWASP API: authz por objeto/función, limitación de recursos, validación de entrada.
- [ ] Gestión de errores sin fuga de información sensible.
- [ ] Dependencias con escaneo de vulnerabilidades vigente.
- [ ] Plan de respuesta a incidentes actualizado y ensayado.

## 8) Resultado y remediación
- Estado global: Aprobado / Aprobado con hallazgos / No aprobado
- Hallazgos críticos:
- Hallazgos mayores:
- CAPA asociadas (ID/ticket/fecha objetivo):
- Aprobadores (Seguridad / QA / Regulatorio):
