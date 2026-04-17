# Variables de entorno y frontera de secretos

> Objetivo: dejar una sola verdad para configuración pública del cliente Expo y secretos/backend Django/DRF sin mezclar fronteras.

## Frontend Expo / variables públicas
- `EXPO_PUBLIC_API_BASE_URL`: URL base pública del backend Django/DRF para la app/export web.
- `EXPO_PUBLIC_FHIR_BASE_URL`: URL pública del FHIR base consumido por el cliente.
- `EXPO_PUBLIC_AUTH0_DOMAIN`, `EXPO_PUBLIC_AUTH0_CLIENT_ID`, `EXPO_PUBLIC_AUTH0_AUDIENCE`, `EXPO_PUBLIC_OIDC_ISSUER`, `EXPO_PUBLIC_OIDC_CLIENT_ID`, `EXPO_PUBLIC_OIDC_AUDIENCE`, `EXPO_PUBLIC_OIDC_SCOPE`: metadata de cliente OIDC/Auth0. Son identificadores/URLs públicas; no son secretos.
- `EXPO_PUBLIC_HANDOVER_DEPLOYMENT_MODE`, `EXPO_PUBLIC_HANDOVER_UNITS_JSON`, `EXPO_PUBLIC_HANDOVER_PROFILE_ACTIVATION_JSON`: controlan contexto/configuración pública del cliente. El rollout sensible se resuelve en backend vía `HANDOVER_PILOT_CONTROL_JSON`.
- `EXPO_PUBLIC_ENABLE_ICEA_BRIDGE`, `EXPO_PUBLIC_ENABLE_ICEA_IMMEDIATE_SCORING`, `EXPO_PUBLIC_ENABLE_ICEA_ENRICHED_SCORING`, `EXPO_PUBLIC_ENABLE_ICEA_PATIENT_RISK`, `EXPO_PUBLIC_AI_SUGGESTIONS_ENABLED`, `EXPO_PUBLIC_FAST_VALIDATE_BEFORE_QUEUE`, `EXPO_PUBLIC_NANDA_CATALOG_URL`, `EXPO_PUBLIC_NIC_CATALOG_URL`, `EXPO_PUBLIC_NOC_CATALOG_URL`: flags o endpoints públicos permitidos para comportamiento/lectura del cliente. En features sensibles funcionan solo como hard kills locales; no habilitan rollout por sí solos.
- Regla dura: no introducir secretos en `EXPO_PUBLIC_*`. El cliente Expo no admite `OPENAI_API_KEY`, secretos ICEA, secretos Django, claves privadas, bypass tokens, flags para desactivar cifrado offline ni datasets NNN inline embebidos en el bundle.

## Backend core
- `DJANGO_SETTINGS_MODULE`: módulo de settings (normalmente `backend.settings`).
- `SECRET_KEY`: clave secreta de Django (obligatoria en producción).
- `HANDOVER_DEPLOYMENT_MODE`: `development` | `demo` | `test` | `pilot` | `production`.
- `FHIR_BASE`: base URL del servidor FHIR para reenvío/interoperabilidad.
- `HANDOVER_FHIR_VALIDATION_MODE`: `off` | `remote` | `strict`.
- `HANDOVER_REQUIRE_RBAC_ON_FHIR`: fuerza contexto de usuario autorizado para llamadas FHIR.
- `HANDOVER_PRIVATE_KEY_PATH`: ruta a clave privada para firma criptográfica fuerte.
- `HANDOVER_PUBLIC_KEY_PATH`: ruta a clave pública para verificación criptográfica.
- `HANDOVER_SIGNATURE_DISABLED`: solo válido en `development`/`demo`/`test` controlado; `pilot`/`production` fallan al arrancar si se activa.
- `HANDOVER_MAX_AUDIO_BYTES`: límite de tamaño de audio para `/api/ai/transcribe`.
- `HANDOVER_BUNDLE_ENCRYPTION_KEY`: clave opcional de cifrado en reposo para Bundles clínicos persistidos. Si falta, HANDOVER mantiene compatibilidad usando una clave derivada de `SECRET_KEY`.
- `AUDIT_HASH_SECRET`: secreto dedicado para HMAC de payloads/pseudónimos de auditoría. Si falta, HANDOVER usa `SECRET_KEY` como fallback operativo.

## Auth / OIDC
- `AUTH0_ISSUER_BASE_URL`: issuer base de Auth0/OIDC.
- `AUTH0_AUDIENCE`: audiencia esperada en JWT access token.
- `OIDC_ISSUER` y `OIDC_AUDIENCE`: aliases compatibles usados por parte del runtime/backend; fuera del perímetro local deben resolver al mismo valor canónico que `AUTH0_*`.

## IA
- `HANDOVER_AI_ENABLED`: flag utilizado en CI para desactivar flujos AI externos.
- `HANDOVER_OPENAI_DISABLED`: flag de compatibilidad usado en CI para garantizar ejecución offline.
- `OPENAI_API_KEY`: credencial API para proveedor compatible OpenAI. Solo backend; el cliente Expo no admite equivalente público.
- `OPENAI_BASE_URL`: URL base del proveedor LLM/STT (en CI se usa dummy local inválido).
- `OPENAI_MODEL_WHISPER`: modelo de transcripción.
- `OPENAI_MODEL_SBAR`: modelo para resumen clínico SBAR.

## CI / Test flags
En GitHub Actions se usan valores dummy para asegurar que CI **no realiza llamadas externas**.
- `OPENAI_API_KEY=dummy`
- `OPENAI_BASE_URL=http://127.0.0.1:9/v1`

## Notas de endurecimiento
- En producción, `AUDIT_HASH_SECRET` debe configurarse como secreto dedicado y estable. Si se deja caer a `SECRET_KEY`, la rotación de `SECRET_KEY` cambia hashes/pseudónimos de auditoría y acopla dos dominios de secreto que conviene separar.
- `AUTH0_ISSUER_BASE_URL=https://example.invalid`
- `FHIR_BASE=http://127.0.0.1:9/fhir`
- además de bloqueo de sockets en pytest (`--disable-socket`).

## Ejemplo `.env.example` (sin secretos)
```env
# Django
DJANGO_SETTINGS_MODULE=backend.settings
SECRET_KEY=change-me-in-prod
DJANGO_DEBUG=false
HANDOVER_DEPLOYMENT_MODE=production

# FHIR
FHIR_BASE=https://fhir.example.com
HANDOVER_FHIR_VALIDATION_MODE=off
HANDOVER_REQUIRE_RBAC_ON_FHIR=true

# Firma digital fuerte backend
HANDOVER_PRIVATE_KEY_PATH=/secure/path/handover-private.pem
HANDOVER_PUBLIC_KEY_PATH=/secure/path/handover-public.pem
# Solo dev/demo/test controlado
# HANDOVER_SIGNATURE_DISABLED=true

# AI
HANDOVER_AI_ENABLED=1
HANDOVER_OPENAI_DISABLED=0
OPENAI_API_KEY=
OPENAI_BASE_URL=https://api.openai.com/v1
OPENAI_MODEL_WHISPER=whisper-1
OPENAI_MODEL_SBAR=gpt-4.1-mini
HANDOVER_MAX_AUDIO_BYTES=26214400
HANDOVER_BUNDLE_ENCRYPTION_KEY=

# Auth0 / OIDC
AUTH0_ISSUER_BASE_URL=
AUTH0_AUDIENCE=
```

## Regla operativa de frontera
- `.env.example` en raíz mezcla placeholders públicos del cliente y variables del backend para facilitar desarrollo local, pero la frontera sigue siendo estricta: `EXPO_PUBLIC_*` solo para configuración pública; secretos reales solo en backend/entorno seguro.
- `config/staging.env` es configuración pública/versionable del export web; no debe reutilizarse como almacén de secretos ni como fuente de verdad del backend.
- La postura endurecida actual elimina de la configuración versionada del cliente los knobs `EXPO_PUBLIC_ALLOW_ALL_UNITS`, `EXPO_PUBLIC_BYPASS_SCOPE`, `EXPO_PUBLIC_OFFLINE_ENCRYPTION_DISABLED` y los `EXPO_PUBLIC_*_CATALOG_JSON`; si reaparecen, debe tratarse como regresión de frontera de confianza.

## Compatibilidad operativa de descifrado
- La lectura de Bundles persistidos prioriza `encryption_metadata.key_source` cuando el registro lo incluye.
- Existe fallback controlado entre `HANDOVER_BUNDLE_ENCRYPTION_KEY` (`env`) y la clave derivada de `SECRET_KEY` (`secret_key_derived`) para mantener legibles registros legacy retenidos.
- Este mecanismo mejora compatibilidad backward; no implementa rotación formal de claves ni reescritura automática de registros ya guardados.
