# Seguridad, autenticación y PHI

## Modelo de autenticación/autorización
- Autenticación JWT OIDC mediante `AUTH0_ISSUER_BASE_URL` y `AUTH0_AUDIENCE`.
- Todas las operaciones clínicas sensibles en DRF validan token Bearer.
- El backend aplica:
  - **RBAC** por rol (ej. `nurse`, `supervisor`, `admin`).
  - **Scopes** por operación (ej. `handover:write`, `fhir:transaction`).
- Las rutas sensibles de IA/STT/uploads nunca deben relajarse por `DEBUG` ni por falta de configuración local.

## Endpoints AI/STT/uploads protegidos
- `POST /api/ai/transcribe`
- `POST /api/ai/summarize-sbar`
- `POST /api/ai/refine-sbar`
- `POST /api/ai/suggest-interventions`
- `POST /api/upload/audio-to-fhir`

## Credencial requerida para AI/STT/uploads
- Requieren `Authorization: Bearer <access-token>` válido.
- Requieren rol clínico mínimo `nurse`, `supervisor` o `admin`.
- Requieren scope `handover:write`.
- No existe fallback cliente mediante variables públicas de token ni secretos expuestos al bundle para estas rutas.
- Si faltan credenciales, la API responde `401`.
- Si el token no trae rol/scope suficiente, la API responde `403`.

## Identidad clínica y anti-spoofing
- La identidad de usuario usada para firma/auditoría se deriva del claim `sub` del JWT validado.
- No se confía en cabeceras cliente para identidad de usuario final.
- Política explícita: tratar `X-User-Id` (u otras cabeceras equivalentes) como no autoritativas para evitar spoofing.

## Validación FHIR y errores clínicos
- `HANDOVER_FHIR_VALIDATION_MODE` define la estrategia (`off`, `remote`, `strict`).
- Cuando procede, los errores de interoperabilidad se normalizan usando `OperationOutcome`.
- `HANDOVER_REQUIRE_RBAC_ON_FHIR=true` obliga a reenviar solicitudes FHIR sólo con contexto de usuario autorizado.

## Firma digital y trazabilidad
- Firma digital de `Bundle` controlada por:
  - `HANDOVER_SIGNATURE_DISABLED`
  - `HANDOVER_PRIVATE_KEY_PATH`
  - `HANDOVER_PUBLIC_KEY_PATH`
- Se registra evidencia de firma para auditoría y trazabilidad clínica.

## PHI y Seguridad (política formal)
### Prohibiciones operativas
- Prohibido loguear payload clínico completo.
- Prohibido loguear tokens de acceso/refresh.
- Prohibido loguear cabeceras `Authorization`.

### Reglas de minimización y seudonimización
- Usar hashing/HMAC para correlación técnica de eventos.
- Limitar logs a metadatos mínimos (estado, tipo de evento, tamaño, hash, timestamp).
- Mantener separación entre datos identificativos y telemetría operativa.

### Gestión de errores y respuesta segura
- Preferir respuestas estándar y estructuradas (`OperationOutcome` en contexto FHIR).
- Evitar filtrar detalles internos de infraestructura en mensajes al cliente.
- En uploads/AI no se debe reenviar texto crudo de errores upstream que pueda contener PHI; responder con detalle seguro y código de error estable.

### Enfoque regulatorio (MDR/AEMPS-ready)
- Aplicar defense-in-depth (authn + authz + validación + auditoría + firma).
- Mantener trazabilidad de cambios, evidencia de test y registro auditable de eventos críticos.
- Diseñar documentación y controles para facilitar expediente técnico y actividades de vigilancia post-mercado.
