# Handover Pro

> Estado del documento
> - Estado: `pilot`.
> - Última revisión: 2026-03-26.
> - Fuente de verdad / evidencia base: árbol actual del repo, [`docs/MASTER_GOVERNANCE_REGISTER.md`](docs/MASTER_GOVERNANCE_REGISTER.md), `git tag --list`, `.github/workflows/*`, `backend/api/urls.py`.
> - Riesgos o lagunas abiertas: el único tag Git verificable en este corte es `v0.2.0-rc.0`; cualquier narrativa de `v0.4.0-rc.1` en el repo debe leerse como borrador documental no verificado hasta que exista un tag/publicación real.

![CI](./ci-badge.svg)
![Coverage](./coverage-badge.svg)

Aplicación móvil para pases de turno clínico construida con React Native (Expo) y TypeScript. Incluye un backend único en Django/DRF para FHIR, asistencia documental con IA y auditoría, además de una cola offline que garantiza la entrega de bundles FHIR incluso con conectividad intermitente.

## Identificación comercial y postura pública

**Nombre comercial oficial:** HANDOVER – Relevo Seguro de Enfermería  
**Subtítulo documental de trabajo:** Sistema Clínico Digital para la Entrega y Continuidad del Turno de Enfermería  
**Referencia documental base:** HANDOVER – Relevo Seguro de Enfermería, Sistema Clínico Digital para la Entrega y Continuidad del Turno de Enfermería.

**Posicionamiento público de este repositorio:** HANDOVER es hoy un piloto operativo de software clínico orientado a soporte de continuidad del turno de enfermería. El repo incluye documentación MDR/QMS útil como baseline de trabajo y trazabilidad, pero no debe presentarse como expediente regulatorio cerrado, certificación, autorización comercial ni software production-ready. Este software apoya la continuidad del turno de enfermería y no sustituye el juicio clínico.

**Seguridad y control de acceso (resumen):**
- Autenticación JWT con Auth0 (OIDC) en el backend Django.
- Autorización por roles (`nurse`, `supervisor`, `admin`) y scopes clínicos (`handover:write`, `handover:audit`).
- Endpoint `/api/me/capabilities` expone capacidades derivadas de roles y scopes.

**Auditoría y trazabilidad (resumen):**
- Eventos de auditoría estructurados sin PHI, con hash de payload y request IDs.
- Retención configurable y comando de limpieza de eventos.

**Documentación de gobernanza y preparación regulatoria disponible en el repo:**
- [Annex II (MDR)](docs/MDR_Anexo_II_HANDOVER.md)
- [QMS](docs/QMS_HANDOVER.md)
- [Matriz de trazabilidad MDR](docs/MDR_traceability_matrix.md)
- [Integración ICEA+ webhook](docs/icea-integration.md)

## QA clínico, rendimiento y MDR (NNN + ICEA+)

Para ejecución de piloto clínico, auditoría interna y preparación regulatoria de NNN + ICEA+, usar este paquete documental:

- [Plan de QA clínico + cumplimiento MDR](docs/qa-mdr-plan-nnn-icea.md): estrategia ejecutable de pruebas funcionales, integración, E2E, seguridad, rendimiento y estructura de evidencia para Anexo II.
- [Matriz de trazabilidad NNN + ICEA+](docs/traceability-matrix-nnn-icea.md): tabla requisito → implementación → test → evidencia para control de cobertura regulatoria.
- [Plantilla de informe de rendimiento por unidad](docs/performance-report-template-nnn-icea.md): formato baseline vs post con métricas mínimas (mediana, P90, abandono/error, IA ON/OFF) y criterio de aceptación.
- [Plantilla de registro de decisiones clínicas de IA](docs/clinical-decision-log-template-nnn-icea.md): estructura para auditar sugerencia mostrada, aceptación/rechazo, contexto mínimo y timestamp.
- [Checklist de ciberseguridad NNN + ICEA+](docs/cybersecurity-checklist-nnn-icea.md): verificación operativa de logs/PHI, secretos, HMAC, rate limits, replay, retry offline e idempotencia.

Recomendación de uso: completar estos documentos por release candidate y enlazar sus evidencias en el expediente técnico/QMS antes de la aprobación Go/No-Go.
Importante: este paquete queda ahora en estado piloto-grade trazable; no declara cumplimiento MDR total ni sustituye la evidencia operativa/regulatoria específica del entorno.

## Requisitos

- Node.js 20
- pnpm 10
- Expo CLI (`pnpm dlx expo install` instala dependencias nativas cuando se añaden paquetes)
- Python 3.10+ y SQLite/PostgreSQL si vas a ejecutar localmente el backend operativo Django/DRF incluido en `backend/`

## Configuración de entorno

1. Copia el archivo de ejemplo y ajusta las variables de OpenID Connect y FHIR:
   ```bash
   cp .env.example .env
   ```
   - Variables de Auth0/OIDC (cliente móvil):
     - `EXPO_PUBLIC_AUTH0_DOMAIN` + `EXPO_PUBLIC_AUTH0_CLIENT_ID` (recomendado para Auth0) o, en su defecto, `EXPO_PUBLIC_OIDC_ISSUER` + `EXPO_PUBLIC_OIDC_CLIENT_ID`.
     - `EXPO_PUBLIC_AUTH0_AUDIENCE` o `EXPO_PUBLIC_OIDC_AUDIENCE` para emitir access tokens con audiencia del API.
     - `EXPO_PUBLIC_OIDC_SCOPE` (por ejemplo `openid profile email offline_access` para refresh tokens).
     - El flujo se resuelve en `src/security/OAuthService.ts` y se integra en `src/security/auth.tsx`; las guardias RBAC viven en `src/security/acl.ts`.
    - `FHIR_BASE_URL` o `EXPO_PUBLIC_FHIR_BASE_URL` define la URL consumida por `src/lib/fhir-client.ts` para leer/escribir Bundles.
    - `EXPO_PUBLIC_ALLOWED_UNITS` restringe el acceso del cliente a unidades clínicas explícitas.
    - `HANDOVER_FHIR_VALIDATION_MODE`: controla la validación de Bundles FHIR en el backend Django/DRF.
      - `"off"` (por defecto): el backend reenviará los Bundles sin validarlos.
      - `"remote"`: se invocará `$validate` contra el servidor FHIR (`FHIR_BASE/Bundle/$validate`) antes de reenviar; si se detectan errores `error`/`fatal` se responderá `422` con detalles.
2. Variables adicionales leídas desde Expo (`app.config.ts > extra`) o el entorno:
   - `EXPO_PUBLIC_HANDOVER_FHIR_VALIDATION_MODE`: `off | local | remote` controla la validación del cliente (por defecto `off` en desarrollo; en producción se recomienda `remote` para validar contra el servidor FHIR antes de enviar). Requiere que el backend tenga `HANDOVER_FHIR_VALIDATION_MODE=remote` para que el servidor valide.
   - `EXPO_PUBLIC_API_BASE_URL` (o `API_BASE_URL`) apunta al backend REST si se usa el servidor Django.
   - `EXPO_PUBLIC_STORAGE_NAMESPACE` personaliza el espacio de almacenamiento seguro y el aislamiento de datos offline.
   - La clave de cifrado offline se genera en runtime y se persiste en almacenamiento seguro del dispositivo; no se acepta una semilla secreta desde el bundle cliente.
   - `EXPO_PUBLIC_OFFLINE_REPLAY_MAX_ATTEMPTS` y `EXPO_PUBLIC_QUEUE_BACKOFF_BASE` afinan la cola offline y el backoff exponencial.
   - `EXPO_PUBLIC_FAST_VALIDATE_BEFORE_QUEUE` habilita una validación remota rápida (`Bundle/$validate`) antes de encolar si hay conectividad. Si el servidor devuelve un `OperationOutcome` con severidad `error`/`fatal`, se muestra un alert con los detalles y no se encola el bundle; en modo offline sigue encolando para respetar offline-first. Recomendado en entornos de staging/producción para detectar problemas de estructura antes de ocupar la cola.
   - Voz + IA:
     - `EXPO_PUBLIC_API_BASE_URL`/`API_BASE_URL`: base única del backend Django/DRF.
     - STT usa siempre `POST /api/ai/transcribe` (derivado como `${API_BASE_URL}/api/ai/transcribe`).
     - `EXPO_PUBLIC_AI_BACKEND_BASE_URL`/`AI_BACKEND_BASE_URL`: backend Django/DRF para generación y refinado SBAR, STT y sugerencias. Si no se define, la app usa `API_BASE_URL/api` por defecto.
     - Las claves reales del proveedor de IA viven solo en el backend (`OPENAI_API_KEY` y compañía); el cliente no acepta claves del proveedor.
   - La firma eIDAS cliente queda degradada: la app no acepta credenciales ni llamadas directas al proveedor desde Expo. Hasta disponer de un endpoint backend-mediated, solo se mantiene un mock local en desarrollo.
3. Define `EXPO_TOKEN` o credenciales EAS en CI/CD cuando generes binarios firmados con Expo Application Services.

## Login y permisos

- El login usa OAuth 2.0/OIDC mediante `expo-auth-session` con Auth0. Define permisos y roles en el backend de identidad para que el claim `role` incluya valores como `nurse`, `admin` o `viewer`.
- Deep links de autenticación:
  - Prod: `handover-pro://redirect` y `handover-pro://logout`.
  - Dev Client: `exp+handover-pro://redirect`.
  - En Web se usan `--/redirect` y `--/logout` (ver `app.config.ts`).
- `AuthProvider` llama `configureFHIRClient({ getToken, ensureFreshToken })` para que el FHIR client renueve tokens silenciosamente antes de cada request.
- En Android se solicitan permisos para cámara, micrófono y notificaciones (ver `app.config.ts`). El flujo de QR y notas de audio depende de `android.permission.CAMERA` y `android.permission.RECORD_AUDIO` respectivamente.
- Para pruebas sin un proveedor OIDC real, puedes habilitar la pantalla mock en `src/screens/LoginMock.tsx` ajustando las banderas de características en `app.config.ts`.
- Las guardias RBAC reutilizables viven en `src/security/acl.ts`; usa `ensureRole` y `ensureUnit` para proteger nuevas pantallas.

## Offline y resiliencia de red

- `safeFetch` en `src/lib/net.ts` fuerza HTTPS en producción, aplica timeouts y reintentos con backoff exponencial frente a errores 502/503/504, y añade cabeceras de idempotencia.
- La cola offline (`src/lib/queue.ts` + `src/lib/sync.ts`) genera UUID por bundle, persiste en SQLite y reintenta envíos cuando detecta conectividad con `@react-native-community/netinfo`.
- Puedes inspeccionar y vaciar la cola desde la pantalla `SyncCenter` (`src/screens/SyncCenter.tsx`). Los elementos con `syncStatus=error` muestran el estado específico (incluyendo `422 Error de validación FHIR`), un badge “Error” y detalle de issues FHIR cuando el servidor devolvió un `OperationOutcome`.
- Los borradores se guardan en SecureStore; al reconectar se validan mediante esquemas Zod antes de sincronizar.

## Adjuntos y módulos Expo

- Los adjuntos (imágenes, documentos, audio) se capturan con `expo-image-picker`, `expo-document-picker` y `expo-file-system`. Mantén estos paquetes en `dependencies` para asegurar compatibilidad con el SDK de Expo.
- El flujo de audio utiliza `expo-audio` y permisos de micrófono definidos en `app.config.ts`.

## Voz, dictado y SBAR con IA

- En móvil, usa **Adjuntos → “Abrir nota de voz avanzada”** para grabar audio, dictar o transcribir la nota. En web el dictado con micrófono se marca como no disponible.
- Dictado STT y transcripción IA usan un único endpoint DRF: `${API_BASE_URL}/api/ai/transcribe`.
- El frontend centraliza esta URL en `AI_TRANSCRIBE_ENDPOINT` (derivada de `resolveApiBaseUrl`) y normaliza errores HTTP (401/413/415/5xx) sin loguear PHI.
- SBAR con IA:
  - Generación y refinado usan `AI_BACKEND_BASE_URL` (`/ai/summarize-sbar` y `/ai/refine-sbar`) y envían el bearer token real de sesión al backend Django/DRF.
  - Si el backend no está configurado, devuelve `401/403`, o no responde, la UI muestra un borrador local por reglas de forma explícita para no bloquear el handover.
  - La sugerencia SBAR asistida queda en revisión humana antes de aceptarse o descartarse; no se trata como paso clínico obligatorio ni como automatización decisoria.
- TTS usa `expo-speech` y solo está disponible en iOS/Android; en web se muestra como no disponible.
- Subida de audio a FHIR (opcional) requiere `API_BASE_URL` con el endpoint `/upload/audio-to-fhir`.

## Criptografía en cliente

- Hashing y random bytes se resuelven vía `expo-crypto` sin añadir polyfills globales de `crypto`.
- La firma de bundles FHIR depende de `globalThis.crypto.subtle`; si no está disponible, la firma se omite y el envío continúa sin bloquear la cola.

## Optimización del mapeo FHIR

- El mapeo FHIR vive en `src/lib/fhir-map.ts` y se expone vía `buildHandoverBundle`. Para evitar bloqueos en UI, usa `buildHandoverBundleAsync` en flujos interactivos (defer en el event loop) y encapsula la creación del bundle dentro de callbacks memoizados. Así evitas recrear funciones costosas en cada render y preparas el terreno para futuras ejecuciones en Web Workers para web.
- Las pruebas de estrés están en `src/lib/__tests__/fhir-map.performance.spec.ts` y usan `performance.now()` para capturar duraciones de escenarios pequeños/medianos/grandes. Ajusta los tamaños si necesitas calibrar tiempos en dispositivos de baja gama.

## Firma eIDAS de PDFs (entrega clínica)

- La app ya no intenta firmar contra un proveedor eIDAS directamente desde el cliente.
- En desarrollo se conserva un mock local para no bloquear la UI. En producción, hasta disponer de un endpoint backend-mediated, la subida continúa como PDF no firmado y se registra la degradación de capacidad.
- La firma criptográfica autoritativa de Bundles FHIR sigue viviendo en el backend Django/DRF (`HANDOVER_PRIVATE_KEY_PATH`, `HANDOVER_PUBLIC_KEY_PATH`, `HANDOVER_SIGNATURE_DISABLED`).

## Arquitectura backend unificada (Django/DRF)

Se retiró el servidor auxiliar FastAPI de STT para unificar validación y seguridad en el backend Django/DRF.

Fuente de verdad operativa del backend en este corte:

- `manage.py` fija `backend.settings`
- `backend/api/urls.py` publica la API clínica operativa
- `Procfile` arranca `gunicorn backend.wsgi`
- en esta rama no hay `main.py` trackeado en la raíz y, por tanto, no forma parte de la ruta operativa actual

La decisión queda registrada en [`docs/adr/0001-backend-source-of-truth.md`](docs/adr/0001-backend-source-of-truth.md).

### Endpoints principales

| Método | Ruta | Descripción | Auth |
|---|---|---|---|
| POST | `/api/fhir/transaction` | Transacción Bundle FHIR con validación remota opcional, attestation de cierre para relevos finales, firma/verificación digital de transporte y creación de `AuditEvent`. | JWT + rol/scope clínico |
| POST | `/api/ai/transcribe` | Transcripción de audio (STT) con `multipart/form-data`. | JWT + `handover:write` |
| POST | `/api/ai/summarize-sbar` | Resume notas clínicas en formato SBAR. | JWT + `handover:write` |
| POST | `/api/ai/suggest-interventions` | Genera sugerencias de intervenciones de enfermería. | JWT + `handover:write` |
| POST | `/api/upload/audio-to-fhir` | Sube audio y crea un `DocumentReference` en servidor FHIR. | JWT + `handover:write` |

CLI (sin servidor auxiliar):
```bash
python manage.py transcribe_audio ./audio.m4a --language es
```

### Variables de entorno backend

- FHIR y validación: `FHIR_BASE`, `HANDOVER_FHIR_VALIDATION_MODE`, `HANDOVER_VALIDATE_STRICT`, `HANDOVER_REQUIRE_RBAC_ON_FHIR`.
- ICEA+: `ICEA_WEBHOOK_ENABLED`, `ICEA_WEBHOOK_URL`, `ICEA_WEBHOOK_SECRET`, `ICEA_WEBHOOK_TIMEOUT_MS`, `ICEA_WEBHOOK_RETRY_MAX`, `ICEA_WEBHOOK_ANTI_REPLAY`, `ICEA_WEBHOOK_REPLAY_WINDOW_SECONDS`.
- Firma digital: `HANDOVER_PRIVATE_KEY_PATH`, `HANDOVER_PUBLIC_KEY_PATH`, `HANDOVER_SIGNATURE_DISABLED`.
- IA: `OPENAI_API_KEY`, `OPENAI_MODEL_SBAR`, `OPENAI_MODEL_WHISPER`, `OPENAI_MODEL_SUGGESTIONS`, `AI_SUGGESTIONS_ENABLED`.
- Uploads de audio: `HANDOVER_MAX_AUDIO_BYTES` (por defecto `26214400`, equivalente a 25 MB).

## Instalación y ejecución

1. Instala dependencias JavaScript:
   ```bash
   pnpm -w install
   ```
2. Levanta el backend operativo Django/DRF si necesitas un API REST local o validar la ruta clínica end-to-end:
   ```bash
   python -m venv .venv
   source .venv/bin/activate  # Windows: .venv\Scripts\activate
   pip install -r requirements.txt
   python manage.py migrate
   python manage.py runserver 0.0.0.0:8000
   ```
   - Define `HANDOVER_ALLOWED_ORIGINS` (p. ej. `https://app.handover-pro.es,https://app.handover-pro.lat`) para restringir CORS/ALLOWED_HOSTS en Django.
   - En producción mantén `ENABLE_SSL_REDIRECT=true` y despliega detrás de un proxy TLS 1.3 con HSTS (ya habilitado en `backend/settings.py`).

### Autenticación JWT (Auth0) en el backend Django

1. Crea `backend/.env` a partir del ejemplo `backend/.env.example` y define:
   - `AUTH0_ISSUER_BASE_URL`
   - `AUTH0_AUDIENCE`
2. En una terminal inicia el servidor:
   ```bash
   python manage.py runserver 0.0.0.0:8000
   ```
3. En otra terminal valida que los endpoints FHIR estén protegidos:
   ```bash
   curl http://localhost:8000/api/fhir/transaction
   ```
   Debe responder `401`.
4. Con un JWT válido de Auth0 (reemplaza `<TOKEN>`):
   ```bash
   curl -H "Authorization: Bearer <TOKEN>" http://localhost:8000/api/fhir/transaction
   ```
   Debe pasar autenticación (por ejemplo responder `422` si el payload no es válido), pero no `401`.
3. Arranca el cliente Expo:
   ```bash
   pnpm expo start
   ```
   Usa la app Expo Go o un emulador (`pnpm expo run:android`, `pnpm expo run:ios`, `pnpm expo start --web`).

### Firma digital de Bundles FHIR

- Genera un par de claves ECDSA (prime256v1) y guarda las rutas en variables de entorno:
  ```bash
  openssl ecparam -name prime256v1 -genkey -noout -out private.pem
  openssl ec -in private.pem -pubout -out public.pem
  export HANDOVER_PRIVATE_KEY_PATH=$PWD/private.pem
  export HANDOVER_PUBLIC_KEY_PATH=$PWD/public.pem
  ```
- El backend (`/fhir/transaction`) firma los Bundles antes de reenviarlos al servidor FHIR cuando ambas rutas están definidas y `HANDOVER_SIGNATURE_DISABLED` no es `true`. Si el cliente ya envía `bundle.signature`, se verifica con la clave pública y se rechaza con `400` si la firma es inválida.
- En cierres finales, HANDOVER exige checklist completo, attestation de enfermera saliente, attestation autenticada de enfermera entrante y actores distintos; el actor entrante debe coincidir con el usuario autenticado que envía la transacción.
- La evidencia criptográfica de transporte se serializa en `bundle.signature` y se registra con hash único en `HandoverSignatureAudit`; esta evidencia no debe presentarse como firma profesional cualificada/eIDAS del relevo clínico.
- En entornos de desarrollo se puede desactivar la firma criptográfica exportando `HANDOVER_SIGNATURE_DISABLED=true`. Cuando la librería `cryptography` no está disponible, el backend recurre a `openssl dgst` para firmar/verificar usando las claves PEM configuradas.

## Pruebas

La automatización usa Vitest como runner principal de frontend y `pytest` para Django/DRF.

- Revisar tipos: `pnpm -w typecheck`
- Linter estricto: `pnpm -w lint:ci`
- Runner principal JS: `pnpm test`
- Suites pilot-grade sensibles con cobertura: `pnpm -w test:pilot:coverage`
- Espejo local del gate JS de CI (incluye `test:e2e`): `pnpm -w quality:pilot:ci`
- Runner secundario Vitest general: `pnpm -w test:unit`
- Runner legacy de compatibilidad: `pnpm -w test:legacy`
- Runner backend: `pytest --ds=backend.settings --disable-socket --allow-hosts=127.0.0.1,localhost backend tests`
- Validación de bundles FHIR representativos: `pnpm -w validate:fhir`

Los umbrales de cobertura sensibles están definidos en `vitest.pilot.config.ts` y se enfocan en auth/ACL, queue/sync, `src/lib/fhir-map.ts`, `src/validation/schemas.ts`, `src/lib/profile-runtime.ts`, `src/screens/HandoverForm.tsx` y `src/screens/handover/submission.ts`.
En local, `pnpm -w test:pilot:coverage` deja `lcov.info` bajo `coverage/pilot-grade/`. En CI, `pnpm -w test:pilot:coverage:ci` emite `lcov.info` y Cobertura XML bajo `coverage/`.

### CI y resiliencia del registry

El workflow `CI` usa `.nvmrc` (`20.17.0`) y `packageManager=pnpm@10.17.1` para fijar el toolchain del gate JS. En el estado actual del repo, el job de Node es bloqueante: instala dependencias con `pnpm install --frozen-lockfile`, ejecuta `pnpm -w typecheck`, `pnpm -w lint:ci`, `pnpm -w gate:any-sensitive`, `pnpm -w test:pilot:coverage:ci`, instala Playwright, corre `pnpm -w test:e2e` y valida bundles con `pnpm -w validate:fhir`.

La evidencia de RC publicada por `CI` incluye `coverage-badge`, `coverage-pilot`, `playwright-evidence` y `fhir-validation`. La evidencia backend (`backend-coverage-xml`) sigue en el workflow separado `Django CI`.

### Feature flags avanzadas por unidad (HANDOVER_UNITS_JSON)

Puedes pilotar la visibilidad de funcionalidades por unidad sin redeploy usando defaults globales (`EXPO_PUBLIC_SHOW_*`) y overrides por unidad (`HANDOVER_UNITS_JSON`).

Ejemplo:

```bash
export EXPO_PUBLIC_SHOW_NIC_CODING=false
export EXPO_PUBLIC_SHOW_NOC_OUTCOMES=false
export EXPO_PUBLIC_SHOW_HANDOVER_TIMING_METRICS=false
export EXPO_PUBLIC_HIDE_LEGACY_FIELDS=false

export EXPO_PUBLIC_HANDOVER_UNITS_JSON='[
  {
    "id": "uci-adulto",
    "name": "UCI Adulto",
    "specialty": "icu",
    "default": true,
    "features": {
      "showNicCoding": true,
      "showNocOutcomes": true,
      "showHandoverTimingMetrics": true,
      "hideLegacyFields": true
    }
  },
  {
    "id": "pediatria",
    "name": "Pediatría",
    "specialty": "ped",
    "features": {
      "showNicCoding": "0",
      "showNocOutcomes": "1"
    }
  }
]'
```

Notas de robustez:
- Se aceptan valores booleanos y boolean-like (`true/false/1/0/on/off/yes/no`) en features por unidad.
- Si `HANDOVER_UNITS_JSON` está vacío, malformado o no es un arreglo válido, la app hace fallback automático a la configuración estática por defecto.
- La activación productiva de perfiles y overlays se controla aparte con `EXPO_PUBLIC_HANDOVER_PROFILE_ACTIVATION_JSON` o `HANDOVER_PROFILE_ACTIVATION_JSON`; el catálogo maestro queda centralizado en `src/config/profiles/index.ts` y un overlay no se activa sin un UPP compatible ya activo.

### Catálogos NNN gobernados (BYO-license)

Los catálogos completos de `NANDA`, `NIC` y `NOC` se mantienen en modo **BYO-license**:
- el repo solo incluye placeholders mínimos para búsqueda y pruebas;
- los datasets completos se cargan bajo demanda desde variables de entorno, URL externa o endpoints backend cacheables;
- la UI muestra un gate explícito antes de habilitar el catálogo completo.

Frontend/Expo:

```bash
export EXPO_PUBLIC_NANDA_CATALOG_URL='https://terminology.example/nanda.json'
export EXPO_PUBLIC_NIC_CATALOG_URL='https://terminology.example/nic.json'
export EXPO_PUBLIC_NOC_CATALOG_URL='https://terminology.example/noc.json'
```

Backend/Django:
- `GET /api/catalogs/nanda`
- `GET /api/catalogs/nic`
- `GET /api/catalogs/noc`
- Variables opcionales: `NANDA_CATALOG_JSON`/`NANDA_CATALOG_FILE`, `NIC_CATALOG_JSON`/`NIC_CATALOG_FILE`, `NOC_CATALOG_JSON`/`NOC_CATALOG_FILE`
- Respuestas versionadas con `licensed`, `version`, `warning`, `codes`, `ETag` y `Cache-Control`

### Seguridad de dependencias

Se recomienda activar Dependabot para revisar automáticamente librerías frontend/backend y recibir PRs con actualizaciones de seguridad. El archivo de configuración vive en `.github/dependabot.yml` y está preparado para el ecosistema npm/pnpm.

## Estructura relevante

- `src/lib/net.ts`: capa de red con timeouts, reintentos y bloqueo de HTTP en producción.
- `src/lib/fhir-client.ts`: cliente FHIR con manejo de OperationOutcome y cabeceras idempotentes.
- `src/lib/queue.ts` y `src/lib/sync.ts`: sincronización offline de bundles con SQLite/Expo.
- `scripts/validate-fhir.ts`: validación de recursos FHIR durante CI o pipelines.
- `docs/DEPLOY.md`: guía de despliegue multiplataforma.

## Despliegue y release candidate

Consulta `docs/DEPLOY.md` para el estado real del despliegue. La topología automatizada prioritaria del repo es la exportación web estática en staging mediante `Dockerfile` + `docker-compose.yml` + `.github/workflows/deploy-staging.yml`; el backend Django sigue siendo un servicio separado con arranque `gunicorn` vía `Procfile`.

El estado consolidado de gobierno técnico y documental está en [`docs/MASTER_GOVERNANCE_REGISTER.md`](docs/MASTER_GOVERNANCE_REGISTER.md). En este corte del repo:

- el único tag Git verificable localmente es `v0.2.0-rc.0`;
- `CHANGELOG.md` y `RELEASE_NOTES.md` conservan una narrativa heredada rotulada como `v0.4.0-rc.1`, pero esa etiqueta no está respaldada por un tag Git local verificable;
- `package.json` y `app.config.ts` siguen en `1.0.0` como metadato de build, no como identificador fiable de release piloto.

Para publicar una RC nueva sin deriva documental:

1. Ejecuta los cheques del gate sensible (`pnpm -w typecheck`, `pnpm -w lint:ci`, `pnpm -w gate:any-sensitive`, `pnpm -w test:pilot:coverage`, `pnpm -w test:e2e`, `pnpm -w validate:fhir`, `pytest --ds=backend.settings --disable-socket --allow-hosts=127.0.0.1,localhost backend tests`).
2. Genera los binarios siguiendo la guía de despliegue.
3. Crea el tag que realmente vaya a publicarse y actualiza `CHANGELOG.md`, `RELEASE_NOTES.md` y el registro maestro en el mismo corte.
4. Trata el tag Git + `RELEASE_NOTES.md` + los artefactos CI del corte como fuente de verdad del release piloto; no asumas que `package.json` o `app.config.ts` reflejan ese identificador.
5. Si quieres bloquear merges o tags sin ese gate, configura branch protection / required checks en GitHub como follow-up manual; este repo solo puede documentarlo.

## Para desarrolladores
Explora la documentación técnica para conocer la arquitectura, configuración y flujos clave antes de contribuir al proyecto.

- [Arquitectura general](docs/overview-architecture.md)
- [ADR-0001: backend source of truth](docs/adr/0001-backend-source-of-truth.md)
- [Contrato base de perfiles clínicos](docs/profile-architecture.md)
- [Playbook de rollout y gate de reanudación](docs/profile-rollout-playbook.md)
- [Guía de onboarding](docs/dev-onboarding.md)
- [Interoperabilidad FHIR](docs/fhir-and-interoperability.md)
- [Seguridad y autenticación](docs/security-and-auth.md)
- [Offline y cola](docs/offline-sync-and-queue.md)
- [Pruebas y CI](docs/testing-and-ci.md)
- [Guía de despliegue](docs/DEPLOY.md)

## Puente analitico ICEA+

HANDOVER incluye ahora un puente analitico dedicado hacia ICEA+ que se activa **solo despues** de una transaccion clinica FHIR exitosa.

Que hace HANDOVER:
- estructura y mapea el Bundle FHIR a un payload analitico v1;
- envia la solicitud de scoring de forma desacoplada y no bloqueante;
- persiste estado visible, hash, warnings, modo de scoring y resumen minimo del resultado;
- expone endpoints `/api/icea/bridge/*` para UI y dashboards.

Que no hace HANDOVER:
- no ejecuta el motor matematico de ICEA+;
- no afirma conclusiones clinicas definitivas en `immediate_provisional`;
- no permite llamadas directas desde la app movil a ICEA+.

Flags principales:
- Backend: `ENABLE_ICEA_BRIDGE`, `ENABLE_ICEA_IMMEDIATE_SCORING=false` por defecto, `ENABLE_ICEA_ENRICHED_SCORING=false` por defecto, `ENABLE_ICEA_PATIENT_RISK=false`, `ENABLE_ICEA_CAUSAL_SUMMARY=false`, `ICEA_BRIDGE_MODEL_ID` obligatorio para score real, `ICEA_BRIDGE_SCORE_PATH=/api/v1/icea-plus/score/`, `ICEA_BRIDGE_STATUS_PATH` opcional
- Frontend: `EXPO_PUBLIC_ENABLE_ICEA_BRIDGE`, `EXPO_PUBLIC_ENABLE_ICEA_IMMEDIATE_SCORING=false` por defecto, `EXPO_PUBLIC_ENABLE_ICEA_ENRICHED_SCORING=false` por defecto, `EXPO_PUBLIC_ENABLE_ICEA_PATIENT_RISK=false`, `EXPO_PUBLIC_AI_SUGGESTIONS_ENABLED=false`

Mientras el upstream ICEA+ no publique un endpoint real de status para score, HANDOVER no inventa polling: el estado local visible pasa a ser la fuente operativa y solo se intenta refresh remoto cuando el cliente pide `refresh=true` y existe `ICEA_BRIDGE_STATUS_PATH` configurado.

En postura de piloto prudente, HANDOVER conserva la trazabilidad tecnica del bridge pero suprime cualquier salida ICEA paciente-a-paciente en la UI operativa, incluido score individual, resumen causal y soporte bedside visible.

Documentacion relacionada:
- [Bridge analitico ICEA+](docs/icea-bridge.md)
- [Integracion ICEA+](docs/icea-integration.md)
