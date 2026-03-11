# Variables de entorno (Django-only)

> Objetivo: centralizar configuración de backend Django/DRF, auth OIDC, IA y CI sin exponer secretos.

## Backend core
- `DJANGO_SETTINGS_MODULE`: módulo de settings (normalmente `backend.settings`).
- `SECRET_KEY`: clave secreta de Django (obligatoria en producción).
- `FHIR_BASE`: base URL del servidor FHIR para reenvío/interoperabilidad.
- `HANDOVER_FHIR_VALIDATION_MODE`: `off` | `remote` | `strict`.
- `HANDOVER_REQUIRE_RBAC_ON_FHIR`: fuerza contexto de usuario autorizado para llamadas FHIR.
- `HANDOVER_SIGNATURE_DISABLED`: desactiva firma digital (útil sólo en dev/test controlado).
- `HANDOVER_PRIVATE_KEY_PATH`: ruta a clave privada para firma.
- `HANDOVER_PUBLIC_KEY_PATH`: ruta a clave pública para verificación.
- `HANDOVER_MAX_AUDIO_BYTES`: límite de tamaño de audio para `/api/ai/transcribe`.

## Auth / OIDC
- `AUTH0_ISSUER_BASE_URL`: issuer base de Auth0/OIDC.
- `AUTH0_AUDIENCE`: audiencia esperada en JWT access token.

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
- `AUTH0_ISSUER_BASE_URL=https://example.invalid`
- `FHIR_BASE=http://127.0.0.1:9/fhir`
- además de bloqueo de sockets en pytest (`--disable-socket`).

## Ejemplo `.env.example` (sin secretos)
```env
# Django
DJANGO_SETTINGS_MODULE=backend.settings
SECRET_KEY=change-me-in-prod

# FHIR
FHIR_BASE=http://localhost:8080/fhir
HANDOVER_FHIR_VALIDATION_MODE=off
HANDOVER_REQUIRE_RBAC_ON_FHIR=true

# Firma digital
HANDOVER_SIGNATURE_DISABLED=true
HANDOVER_PRIVATE_KEY_PATH=
HANDOVER_PUBLIC_KEY_PATH=

# AI
HANDOVER_AI_ENABLED=1
HANDOVER_OPENAI_DISABLED=0
OPENAI_API_KEY=
OPENAI_BASE_URL=https://api.openai.com/v1
OPENAI_MODEL_WHISPER=whisper-1
OPENAI_MODEL_SBAR=gpt-4.1-mini
HANDOVER_MAX_AUDIO_BYTES=26214400

# Auth0 / OIDC
AUTH0_ISSUER_BASE_URL=
AUTH0_AUDIENCE=
```
