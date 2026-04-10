# Seguridad, autenticación y PHI

> Estado del documento
> - Estado: `implemented`.
> - Última revisión: 2026-03-28.
> - Fuente de verdad / evidencia base: `backend/security/*`, `backend/api/views.py`, `backend/api/urls.py`, `docs/MASTER_GOVERNANCE_REGISTER.md`.
> - Riesgos o lagunas abiertas: la evidencia fuerte cubre authn/authz, attestation clínica, firma criptográfica de transporte y superficies sensibles principales; no equivale a una auditoría exhaustiva de todo el backend ni a una declaración de production-readiness.

## Modelo de autenticación/autorización
- Autenticación JWT OIDC mediante `AUTH0_ISSUER_BASE_URL` y `AUTH0_AUDIENCE`.
- Las variables `EXPO_PUBLIC_*` del cliente solo pueden contener metadata pública/flags. No deben transportar secretos, tokens privilegiados ni claves de proveedor.
- `DJANGO_DEBUG=true` solo es válido para desarrollo local explícito (`HANDOVER_DEPLOYMENT_MODE=development|demo`); no habilita bypass por sí mismo en `pilot`/`production` ni en despliegues sin modo local explícito.
- Si faltan `AUTH0_ISSUER_BASE_URL` o `AUTH0_AUDIENCE` (o sus aliases `OIDC_ISSUER` / `OIDC_AUDIENCE`) fuera de tests reales o de desarrollo local explícito con `DEBUG=true`, el backend debe abortar startup; no existe fallback silencioso a `AllowAny` fuera de ese perímetro.
- Todas las operaciones clínicas sensibles en DRF validan token Bearer.
- El backend aplica:
  - **RBAC** por rol (ej. `nurse`, `supervisor`, `admin`).
  - **Scopes** por operación (ej. `handover:write`, `fhir:transaction`).
- Las rutas sensibles de IA/STT/uploads nunca deben relajarse por `DEBUG` ni por falta de configuración local.

## Endpoint FHIR transaction protegido
- `POST /api/fhir/transaction` usa autenticación JWT OIDC estándar de DRF mediante `Auth0JWTAuthentication`.
- Requiere `Authorization: Bearer <access-token>` válido.
- Requiere rol clínico `nurse`, `supervisor` o `admin`.
- Requiere ambos scopes `fhir:transaction` y `handover:write`.
- Responde `400` cuando un cierre final no trae la attestation clínica requerida o la firma criptográfica de transporte es inválida, `401` sin credenciales válidas, `403` con rol/scope insuficiente y `422` cuando el Bundle es inválido.
- No existe bypass silencioso por `DEBUG` ni por ausencia de configuración Auth0 para este endpoint.

## Endpoints AI/STT/uploads protegidos
- `POST /api/ai/transcribe`
- `POST /api/ai/summarize-sbar`
- `POST /api/ai/refine-sbar`
- `POST /api/ai/suggest-interventions`
- `POST /api/upload/audio-to-fhir`

## Endpoints de pacientes con scope y unidad
- `GET /api/patients` requiere autenticación válida y scope `patients:read`.
- `POST /api/patients` requiere autenticación válida y scope `patients:write`.
- `GET /api/patients` además exige un rol permitido (`viewer`, `nurse`, `supervisor`, `admin`); `POST /api/patients` exige rol clínico operativo (`nurse`, `supervisor`, `admin`).
- Para roles no privilegiados, las consultas y altas de pacientes quedan limitadas a las unidades declaradas en claims (`unitIds` / `units` y aliases soportados).
- Si una unidad pedida o enviada queda fuera de alcance, la API responde `403` con código estable; no debe degradar a éxito vacío ambiguo fuera del scope explícito.
- Cuando `GET /api/patients` cae al FHIR remoto y el token no privilegiado cubre varias unidades, el backend hace fan-out por cada unidad autorizada y filtra la respuesta por unidad; no debe responder `200` vacío solo porque el upstream no soporte agregación multi-unit.
- Si el FHIR remoto falla y se usa el bundle demo como fallback, ese fallback también queda filtrado por unidades autorizadas; no debe reabrir visibilidad lateral por demo data.
- `GET /api/fhir/patient` mantiene el mismo perímetro deny-first: para roles no privilegiados exige unidad explícita en búsquedas multi-unit y valida que la respuesta quede dentro de las unidades autorizadas; una lectura cuyo `unit` no pueda resolverse responde `403` con código controlado en lugar de exponer datos ambiguos.

## Credencial requerida para AI/STT/uploads
- Requieren `Authorization: Bearer <access-token>` válido.
- Requieren rol clínico mínimo `nurse`, `supervisor` o `admin`.
- Requieren scope `handover:write`.
- No existe fallback cliente mediante variables públicas de token ni secretos expuestos al bundle para estas rutas.
- Si faltan credenciales, la API responde `401`.
- Si el token no trae rol/scope suficiente, la API responde `403`.
- `POST /api/ai/refine-sbar` exige que `draft` sea un objeto JSON; si llega como lista, string, bool u otro tipo no objeto responde `400` con `code=invalid_refine_draft` y `detail=draft must be an object.`.
- En `POST /api/ai/refine-sbar`, los campos `draft.situation`, `draft.background`, `draft.assessment` y `draft.recommendation` sólo aceptan `string` o `null`; tipos no válidos responden `400` con `code=invalid_refine_draft`.
- En `POST /api/ai/refine-sbar`, `handover` también debe ser un objeto JSON si viene explícitamente; otros tipos responden `400` con `code=invalid_refine_handover` y `detail=handover must be an object.`.

## Identidad clínica y anti-spoofing
- La identidad de usuario usada para attestation clínica y auditoría se deriva del claim `sub` del JWT validado.
- No se confía en cabeceras cliente para identidad de usuario final.
- Política explícita: tratar `X-User-Id` (u otras cabeceras equivalentes) como no autoritativas para evitar spoofing.

## Validación FHIR y errores clínicos
- `HANDOVER_FHIR_VALIDATION_MODE` define la estrategia (`off`, `remote`, `strict`).
- Cuando procede, los errores de interoperabilidad se normalizan usando `OperationOutcome`.
- `HANDOVER_REQUIRE_RBAC_ON_FHIR=true` obliga a reenviar solicitudes FHIR sólo con contexto de usuario autorizado.

## Firma digital y trazabilidad
- `HANDOVER_DEPLOYMENT_MODE` delimita el contrato operativo:
  - `development`, `demo`, `test`: pueden ejecutar flujos inseguros solo con delimitación explícita.
  - `pilot`, `production`: exigen defaults cerrados y no aceptan `HANDOVER_SIGNATURE_DISABLED=true`.
- En cierres finales, el backend exige checklist completo, attestation saliente con evidencia local, attestation autenticada entrante y actores distintos antes de reenviar la transacción.
- La firma criptográfica fuerte del backend requiere `HANDOVER_PRIVATE_KEY_PATH` y `HANDOVER_PUBLIC_KEY_PATH` en `pilot/production`.
- Si llega una firma criptográfica de transporte inválida, la API responde `400` y no reenvía el Bundle.
- Si la firma fuerte del backend no está disponible en un entorno serio, el despliegue debe fallar en startup; no existe fallback silencioso a unsigned.
- La evidencia criptográfica se registra en auditoría sin sobreescribir la attestation clínica del handover dentro del payload clínico y sin afirmar firma cualificada/eIDAS del relevo.

## PHI y Seguridad (política formal)
### Prohibiciones operativas
- Prohibido loguear payload clínico completo.
- Prohibido loguear tokens de acceso/refresh.
- Prohibido loguear cabeceras `Authorization`.

### Reglas de minimización y seudonimización
- Usar hashing/HMAC para correlación técnica de eventos.
- Limitar logs a metadatos mínimos (estado, tipo de evento, tamaño, hash, timestamp).
- Mantener separación entre datos identificativos y telemetría operativa.
- En `POST /api/audit`, la persistencia/lectura canónica de paciente del log móvil usa `patientKey` `ptk2_*` determinista y secreto-derivado en servidor. El cliente móvil todavía transporta un seudónimo de compatibilidad `ptk_` calculado localmente; el backend lo acepta solo por compatibilidad, lo canoniza a `ptk2_*` al persistir y devuelve `ptk2_*` en `GET /api/audit`. El endpoint rechaza `patientId` crudo o referencias equivalentes en payload/meta y no serializa `meta` en la proyección pública. Esto reduce exposición de PHI, pero no equivale todavía a una transición end-to-end donde el transporte móvil ya emita `ptk2_*`.

### Gestión de errores y respuesta segura
- Preferir respuestas estándar y estructuradas (`OperationOutcome` en contexto FHIR).
- Evitar filtrar detalles internos de infraestructura en mensajes al cliente.
- En uploads/AI no se debe reenviar texto crudo de errores upstream que pueda contener PHI; responder con detalle seguro y código de error estable.

### Orientación documental para piloto serio
- Aplicar defense-in-depth (authn + authz + validación + auditoría + attestation clínica + firma criptográfica de transporte).
- Mantener trazabilidad de cambios, evidencia de test y registro auditable de eventos críticos.
- Diseñar documentación y controles para facilitar una conversación seria de piloto, auditoría técnica y preparación regulatoria sin presentarlo como certificación o cierre regulatorio total.

## Backups y artefactos operativos
- Los scripts [`scripts/backup-db.sh`](../scripts/backup-db.sh) y [`scripts/backup-media.sh`](../scripts/backup-media.sh) exigen cifrado por defecto; si falta `BACKUP_ENCRYPTION_PASSPHRASE`, fallan salvo override explícito `BACKUP_REQUIRE_ENCRYPTION=false`.
- Con `BACKUP_REQUIRE_ENCRYPTION=true`, ambos scripts usan temporales con cleanup y no deben dejar `*.gz` o `*.tar.gz` persistentes en claro si falta passphrase, falla `gpg` o el proceso aborta antes de publicar el artefacto final.
- Los artefactos de backup generan `*.sha256` y el restore verifica checksum cuando está disponible antes de descifrar o extraer.
- Los restores del repo son `scratch-first`: [`scripts/restore-db.sh`](../scripts/restore-db.sh) y [`scripts/restore-media.sh`](../scripts/restore-media.sh) se niegan a sobrescribir DB/media existentes por defecto.
- Los ZIPs y contextos Docker excluyen `.env` no-ejemplo, bases locales, media local, `backups/`, `artifacts/`, logs y reportes temporales para reducir fuga accidental de PHI o secretos.

## Perf smoke sintético
- [`scripts/perf-smoke.py`](../scripts/perf-smoke.py) está aislado por defecto de cualquier BD viva: fuerza una SQLite efímera local y deja esa ruta explícita en la salida.
- Solo usa una BD no efímera si el operador define deliberadamente `PERF_SMOKE_ALLOW_NON_EPHEMERAL_DB=true`; ese override es peligroso y no debe usarse en rehearsal rutinario.

## Retención y cifrado en reposo
- Los Bundles clínicos persistidos para ETL ya no se guardan en claro en nuevas escrituras: se conservan con retención explícita (`HANDOVER_BUNDLE_RETENTION_DAYS`) y se cifran en reposo a nivel de aplicación antes de guardarse en base de datos.
- Los artefactos técnicos ICEA (`IceaOutboundEvent`, snapshots/eventos pipeline y bridge requests terminales) deben expurgarse con `prune_sensitive_records` según `HANDOVER_TECHNICAL_RETENTION_DAYS`.
- El endpoint `GET /api/handover/{bundle_id}` descifra el Bundle persistido solo para la respuesta autorizada, bloquea bundles expirados y responde con `Cache-Control: private, no-store` para reducir reexposición por caché.
- La lectura prioriza `encryption_metadata.key_source` cuando existe y mantiene fallback controlado entre `env` y `secret_key_derived` para compatibilidad backward de bundles retenidos.
- Ese fallback mejora la lectura operativa de registros legacy y de registros nuevos cifrados con `HANDOVER_BUNDLE_ENCRYPTION_KEY`, pero no equivale a una rotación formal de claves.
- Cuando un bundle persistido existe pero no puede descifrarse tras agotar candidatos válidos, ETL y bridge responden con un estado controlado de bundle almacenado no disponible; no deben degradar a `500` opaco.

## Límites del endurecimiento actual
- El cifrado fuerte en reposo del Bundle clínico depende de `HANDOVER_BUNDLE_ENCRYPTION_KEY`; si no se configura, HANDOVER deriva la clave desde `SECRET_KEY` como fallback de endurecimiento compatible con la arquitectura actual.
- Ese fallback mejora confidencialidad frente a lectura accidental de base de datos, pero no sustituye KMS/HSM, rotación de claves ni separación fuerte de secretos.
- La pseudonimización y el payload hashing de auditoría usan `AUDIT_HASH_SECRET`; si no se configura, HANDOVER cae a `SECRET_KEY`. Ese fallback mantiene compatibilidad operativa, pero acopla estabilidad de hashes/pseudónimos a la rotación de `SECRET_KEY` y no debe tratarse como postura final de producción.
- Los modelos técnicos ICEA siguen guardando identificadores operativos mínimos (`request_id`, `bundle_id`, `patient_id`, `unit_id`) para trazabilidad y correlación clínica.
- El repo deja ahora un drill de backup/restore verificable, pero no automatiza vault externo, snapshots inmutables ni restore full-stack del backend fuera del proceso scratch-first.

## Contratos controlados de bridge
- `stored_bundle_unavailable` significa que el bundle persistido sigue presente localmente pero es ilegible o no puede descifrarse con las claves disponibles.
- `handover_bundle_not_found` significa que el bundle local ya no existe, expiró o no pudo localizarse para retry/requeue.
