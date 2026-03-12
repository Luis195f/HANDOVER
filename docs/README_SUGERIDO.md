# HANDOVER — README sugerido (Django-only)

## Resumen ejecutivo
HANDOVER es una solución digital para continuidad asistencial y relevo clínico estructurado, orientada a entornos sanitarios con requisitos de seguridad, trazabilidad e interoperabilidad FHIR. El producto combina una app móvil (Expo/React Native) con backend clínico Django/DRF, incorporando controles técnicos compatibles con un enfoque MDR/AEMPS-ready.

## Arquitectura técnica
- **Cliente**: React Native + Expo para captura en punto de cuidado.
- **Backend**: Django + DRF (arquitectura Django-only).
- **Interoperabilidad**: transacciones FHIR (`Bundle`) contra servidor FHIR externo.
- **Módulos clave backend**:
  - `BundleView` (`/api/fhir/transaction`) para ingestión y reenvío transaccional.
  - AI endpoints:
    - `POST /api/ai/transcribe`
    - `POST /api/ai/summarize-sbar`
    - `POST /api/ai/suggest-interventions` (si está habilitado)
  - Auditoría de eventos clínicos/IA.
  - Firma digital de bundles (configurable por entorno).

## Quickstart
### Backend
```bash
python -m venv .venv
source .venv/bin/activate  # Windows: .venv\\Scripts\\activate
pip install -r requirements.txt
python manage.py migrate
python manage.py runserver
```

### Frontend
```bash
pnpm install
expo start
```

### Conexión frontend → backend
Configurar `EXPO_PUBLIC_API_BASE_URL` para apuntar al backend Django, por ejemplo:
```env
EXPO_PUBLIC_API_BASE_URL=http://localhost:8000/api
```

### Tests
```bash
pytest --ds=backend.settings
pytest --cov=backend
```

## Variables de entorno

### Backend core
- `DJANGO_SETTINGS_MODULE`
- `SECRET_KEY`
- `FHIR_BASE`
- `HANDOVER_FHIR_VALIDATION_MODE`
- `HANDOVER_REQUIRE_RBAC_ON_FHIR`
- `HANDOVER_DEPLOYMENT_MODE`
- `HANDOVER_PRIVATE_KEY_PATH`
- `HANDOVER_PUBLIC_KEY_PATH`
- `HANDOVER_MAX_AUDIO_BYTES`

### Auth / OIDC
- `AUTH0_ISSUER_BASE_URL`
- `AUTH0_AUDIENCE`

### IA
- `HANDOVER_AI_ENABLED`
- `HANDOVER_OPENAI_DISABLED`
- `OPENAI_API_KEY`
- `OPENAI_BASE_URL`
- `OPENAI_MODEL_WHISPER`
- `OPENAI_MODEL_SBAR`

### CI/Test
CI usa variables dummy para ejecución offline/determinista y evita llamadas externas.

#### `.env.example` orientativo (sin secretos)
```env
DJANGO_SETTINGS_MODULE=backend.settings
SECRET_KEY=change-me-in-prod

FHIR_BASE=http://localhost:8080/fhir
HANDOVER_FHIR_VALIDATION_MODE=off
HANDOVER_REQUIRE_RBAC_ON_FHIR=true

HANDOVER_DEPLOYMENT_MODE=development
# HANDOVER_SIGNATURE_DISABLED=true
HANDOVER_PRIVATE_KEY_PATH=
HANDOVER_PUBLIC_KEY_PATH=

HANDOVER_MAX_AUDIO_BYTES=26214400

AUTH0_ISSUER_BASE_URL=
AUTH0_AUDIENCE=

HANDOVER_AI_ENABLED=1
HANDOVER_OPENAI_DISABLED=0
OPENAI_API_KEY=
OPENAI_BASE_URL=https://api.openai.com/v1
OPENAI_MODEL_WHISPER=whisper-1
OPENAI_MODEL_SBAR=gpt-4.1-mini
```

## Seguridad / PHI
### Controles implementados
- Validación FHIR (`off`/`remote`/`strict`) con tratamiento de `OperationOutcome`.
- RBAC + scopes para operaciones clínicas.
- Firma digital de bundles con contrato por entorno: `pilot/production` requieren claves backend y no aceptan `HANDOVER_SIGNATURE_DISABLED=true`.
- Auditoría de eventos relevantes con minimización de datos.
- Protección anti-spoofing: identidad clínica basada en `sub` del token validado (no en cabeceras cliente como `X-User-Id`).

### Política PHI
- Prohibido loguear payload clínico completo.
- Prohibido loguear tokens.
- Prohibido loguear cabecera `Authorization`.
- Usar hashing/HMAC para trazabilidad técnica sin exposición de contenido clínico.

## CI
La validación backend prioriza pytest:
- ejecución de tests Django/DRF,
- cobertura backend,
- bloqueo de red (`--disable-socket`),
- variables dummy para Auth/FHIR/OpenAI.

### Reproducción local de CI
```bash
pytest --ds=backend.settings --disable-socket --allow-hosts=127.0.0.1,localhost backend tests
```

## Estado actual
**MVP clínico avanzado** con backend Django/DRF estable para transacciones FHIR, controles de seguridad reforzados y endpoints AI orientados a productividad clínica.

## Roadmap corto
1. Endurecer validación terminológica y perfiles FHIR por especialidad.
2. Expandir paneles de auditoría clínica y operativa.
3. Fortalecer evidencias para expediente técnico regulatorio.
4. Extender automatización de pruebas de regresión clínica.


