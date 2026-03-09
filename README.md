# Handover Pro

![CI](./ci-badge.svg)
![Coverage](./coverage-badge.svg)

Aplicación móvil para pases de turno clínico construida con React Native (Expo) y TypeScript. Incluye un backend único en Django/DRF para FHIR, IA clínica y auditoría, además de una cola offline que garantiza la entrega de bundles FHIR incluso con conectividad intermitente.

## Identificación comercial y posicionamiento regulatorio

**Nombre comercial oficial:** HANDOVER – Relevo Seguro de Enfermería  
**Subtítulo técnico (MDR / QMS):** Sistema Clínico Digital para la Entrega y Continuidad del Turno de Enfermería  
**Referencia normativa (uso obligatorio):** HANDOVER – Relevo Seguro de Enfermería, Sistema Clínico Digital para la Entrega y Continuidad del Turno de Enfermería (hereinafter, HANDOVER).

**Posicionamiento regulatorio:** Software as a Medical Device (SaMD) orientado a soporte clínico. La documentación MDR (Annex II) y QMS está disponible en [`/docs`](docs). Este software apoya la continuidad del turno de enfermería y no sustituye el juicio clínico.

**Seguridad y control de acceso (resumen):**
- Autenticación JWT con Auth0 (OIDC) en el backend Django.
- Autorización por roles (`nurse`, `supervisor`, `admin`) y scopes clínicos (`handover:write`, `handover:audit`).
- Endpoint `/api/me/capabilities` expone capacidades derivadas de roles y scopes.

**Auditoría y trazabilidad (resumen):**
- Eventos de auditoría estructurados sin PHI, con hash de payload y request IDs.
- Retención configurable y comando de limpieza de eventos.

**Documentación regulatoria adicional:**
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

## Requisitos

- Node.js 20
- pnpm 10
- Expo CLI (`pnpm dlx expo install` instala dependencias nativas cuando se añaden paquetes)
- (Opcional) Python 3.10+ y PostgreSQL/SQLite si se desea correr el backend incluido en `backend/`

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
    - `FHIR_BASE_URL` o `EXPO_PUBLIC_FHIR_BASE` define la URL consumida por `src/lib/fhir-client.ts` para leer/escribir Bundles.
    - `EXPO_PUBLIC_ALLOWED_UNITS` y `EXPO_PUBLIC_ALLOW_ALL_UNITS` filtran el acceso a unidades clínicas específicas.
    - `EXPO_PUBLIC_BYPASS_SCOPE` habilita cuentas de soporte que omiten filtros RBAC en situaciones operativas.
    - `HANDOVER_FHIR_VALIDATION_MODE`: controla la validación de Bundles FHIR en el backend Django/DRF.
      - `"off"` (por defecto): el backend reenviará los Bundles sin validarlos.
      - `"remote"`: se invocará `$validate` contra el servidor FHIR (`FHIR_BASE/Bundle/$validate`) antes de reenviar; si se detectan errores `error`/`fatal` se responderá `422` con detalles.
2. Variables adicionales leídas desde Expo (`app.json > expo.extra`) o el entorno:
   - `EXPO_PUBLIC_HANDOVER_FHIR_VALIDATION_MODE`: `off | local | remote` controla la validación del cliente (por defecto `off` en desarrollo; en producción se recomienda `remote` para validar contra el servidor FHIR antes de enviar). Requiere que el backend tenga `HANDOVER_FHIR_VALIDATION_MODE=remote` para que el servidor valide.
   - `EXPO_PUBLIC_API_BASE_URL` (o `API_BASE_URL`) apunta al backend REST si se usa el servidor Django.
   - `EXPO_PUBLIC_API_TOKEN` agrega un token para llamadas autenticadas contra APIs complementarias.
   - `EXPO_PUBLIC_STORAGE_NAMESPACE` personaliza el espacio de almacenamiento seguro y el aislamiento de datos offline.
   - `EXPO_PUBLIC_OFFLINE_ENCRYPTION_KEY` es la base para derivar la clave AES-256-GCM que cifra los bundles en la cola offline (usa al menos 32 caracteres, gestiona el valor como un secreto real).
   - `EXPO_PUBLIC_OFFLINE_REPLAY_MAX_ATTEMPTS` y `EXPO_PUBLIC_QUEUE_BACKOFF_BASE` afinan la cola offline y el backoff exponencial.
   - `EXPO_PUBLIC_OFFLINE_ENCRYPTION_DISABLED` desactiva temporalmente el cifrado AES de la cola offline (solo para debugging en desarrollo; `true/1/TRUE` lo deshabilitan, cualquier otro valor lo deja activo por defecto).
   - `EXPO_PUBLIC_CLIENT_SIGNING_ENABLED` habilita la firma ECDSA P-256 de los Bundles FHIR en el cliente antes de encolarlos (por defecto `false`; si no hay WebCrypto o clave, continúa enviando sin firma).
   - `EXPO_PUBLIC_FAST_VALIDATE_BEFORE_QUEUE` habilita una validación remota rápida (`Bundle/$validate`) antes de encolar si hay conectividad. Si el servidor devuelve un `OperationOutcome` con severidad `error`/`fatal`, se muestra un alert con los detalles y no se encola el bundle; en modo offline sigue encolando para respetar offline-first. Recomendado en entornos de staging/producción para detectar problemas de estructura antes de ocupar la cola.
   - Voz + IA:
     - `EXPO_PUBLIC_API_BASE_URL`/`API_BASE_URL`: base única del backend Django/DRF.
     - STT usa siempre `POST /api/ai/transcribe` (derivado como `${API_BASE_URL}/api/ai/transcribe`).
     - `EXPO_PUBLIC_AI_BACKEND_BASE_URL`/`AI_BACKEND_BASE_URL`: backend IA para endpoints no STT (p. ej. `/ai/summarize-sbar`). Si no se define, la app usa `API_BASE_URL/api` por defecto.
     - `EXPO_PUBLIC_AI_SBAR_URL`/`AI_SBAR_URL` (expone `AI_SBAR_BASE_URL`): backend de refinado SBAR.
     - `EXPO_PUBLIC_AI_SBAR_API_KEY`/`AI_SBAR_API_KEY`: token opcional para el refinado.
     - `EXPO_PUBLIC_OPENAI_API_KEY`/`OPENAI_API_KEY`: credencial del proveedor de IA (configurada en el backend).
   - `EXPO_PUBLIC_EIDAS_API_URL` apunta al proveedor eIDAS homologado (firma cualificada PAdES).
   - `EXPO_PUBLIC_EIDAS_CLIENT_ID`, `EXPO_PUBLIC_EIDAS_CLIENT_SECRET` y/o `EXPO_PUBLIC_EIDAS_API_KEY` son credenciales del proveedor (gestionarlas como secretos).
3. Define `EXPO_TOKEN` o credenciales EAS en CI/CD cuando generes binarios firmados con Expo Application Services.

## Login y permisos

- El login usa OAuth 2.0/OIDC mediante `expo-auth-session` con Auth0. Define permisos y roles en el backend de identidad para que el claim `role` incluya valores como `nurse`, `admin` o `viewer`.
- Deep links de autenticación:
  - Prod: `handover-pro://redirect` y `handover-pro://logout`.
  - Dev Client: `exp+handover-pro://redirect`.
  - En Web se usan `--/redirect` y `--/logout` (ver `app.config.ts`).
- `AuthProvider` llama `configureFHIRClient({ getToken, ensureFreshToken })` para que el FHIR client renueve tokens silenciosamente antes de cada request.
- En Android se solicitan permisos para cámara, micrófono y notificaciones (ver `app.json`). El flujo de QR y notas de audio depende de `android.permission.CAMERA` y `android.permission.RECORD_AUDIO` respectivamente.
- Para pruebas sin un proveedor OIDC real, puedes habilitar la pantalla mock en `src/screens/LoginMock.tsx` ajustando las banderas de características en `app.json`.
- Las guardias RBAC reutilizables viven en `src/security/acl.ts`; usa `ensureRole` y `ensureUnit` para proteger nuevas pantallas.

## Offline y resiliencia de red

- `safeFetch` en `src/lib/net.ts` fuerza HTTPS en producción, aplica timeouts y reintentos con backoff exponencial frente a errores 502/503/504, y añade cabeceras de idempotencia.
- La cola offline (`src/lib/queue.ts` + `src/lib/sync.ts`) genera UUID por bundle, persiste en SQLite y reintenta envíos cuando detecta conectividad con `@react-native-community/netinfo`.
- Puedes inspeccionar y vaciar la cola desde la pantalla `SyncCenter` (`src/screens/SyncCenter.tsx`). Los elementos con `syncStatus=error` muestran el estado específico (incluyendo `422 Error de validación FHIR`), un badge “Error” y detalle de issues FHIR cuando el servidor devolvió un `OperationOutcome`.
- Los borradores se guardan en SecureStore; al reconectar se validan mediante esquemas Zod antes de sincronizar.

## Adjuntos y módulos Expo

- Los adjuntos (imágenes, documentos, audio) se capturan con `expo-image-picker`, `expo-document-picker` y `expo-file-system`. Mantén estos paquetes en `dependencies` para asegurar compatibilidad con el SDK de Expo.
- El flujo de audio utiliza `expo-audio` y permisos de micrófono definidos en `app.json`.

## Voz, dictado y SBAR con IA

- En móvil, usa **Adjuntos → “Abrir nota de voz avanzada”** para grabar audio, dictar o transcribir la nota. En web el dictado con micrófono se marca como no disponible.
- Dictado STT y transcripción IA usan un único endpoint DRF: `${API_BASE_URL}/api/ai/transcribe`.
- El frontend centraliza esta URL en `AI_TRANSCRIBE_ENDPOINT` (derivada de `resolveApiBaseUrl`) y normaliza errores HTTP (401/413/415/5xx) sin loguear PHI.
- SBAR con IA:
  - Generación y refinado usan `AI_BACKEND_BASE_URL` (`/ai/summarize-sbar`) y/o `AI_SBAR_BASE_URL` (`/api/sbar/refine`).
  - Si no hay credenciales, los botones de IA se deshabilitan y se mantiene la generación local determinística.
- TTS usa `expo-speech` y solo está disponible en iOS/Android; en web se muestra como no disponible.
- Subida de audio a FHIR (opcional) requiere `API_BASE_URL` con el endpoint `/upload/audio-to-fhir`.

## Criptografía en cliente

- Hashing y random bytes se resuelven vía `expo-crypto` sin añadir polyfills globales de `crypto`.
- La firma de bundles FHIR depende de `globalThis.crypto.subtle`; si no está disponible, la firma se omite y el envío continúa sin bloquear la cola.

## Optimización del mapeo FHIR

- El mapeo FHIR vive en `src/lib/fhir-map.ts` y se expone vía `buildHandoverBundle`. Para evitar bloqueos en UI, usa `buildHandoverBundleAsync` en flujos interactivos (defer en el event loop) y encapsula la creación del bundle dentro de callbacks memoizados. Así evitas recrear funciones costosas en cada render y preparas el terreno para futuras ejecuciones en Web Workers para web.
- Las pruebas de estrés están en `src/lib/__tests__/fhir-map.performance.spec.ts` y usan `performance.now()` para capturar duraciones de escenarios pequeños/medianos/grandes. Ajusta los tamaños si necesitas calibrar tiempos en dispositivos de baja gama.

## Firma eIDAS de PDFs (entrega clínica)

- El flujo de firma cualificada eIDAS se integra en `src/lib/eidas-signature.ts` y genera PDFs firmados en formato PAdES, con metadatos de auditoría (certificado, timestamp) anexados al `DocumentReference` FHIR.
- En producción configura `EXPO_PUBLIC_EIDAS_API_URL` y credenciales (`EXPO_PUBLIC_EIDAS_CLIENT_ID`, `EXPO_PUBLIC_EIDAS_CLIENT_SECRET`, `EXPO_PUBLIC_EIDAS_API_KEY`) mediante secretos o almacenamiento seguro; nunca hardcodear certificados o claves.
- En desarrollo, si no hay proveedor configurado, se genera un mock local para no bloquear la UI. Antes de usar en un entorno real, valida el flujo con el proveedor eIDAS homologado y actualiza las políticas internas de trazabilidad (IEC 62304, MDR, eIDAS).


## Arquitectura backend unificada (Django/DRF)

Se retiró el servidor auxiliar FastAPI de STT para unificar validación y seguridad en el backend Django/DRF.

### Endpoints principales

| Método | Ruta | Descripción | Auth |
|---|---|---|---|
| POST | `/api/fhir/transaction` | Transacción Bundle FHIR con validación remota opcional, firma/verificación digital y creación de `AuditEvent`. | JWT + rol/scope clínico |
| POST | `/api/ai/transcribe` | Transcripción de audio (STT) con `multipart/form-data`. | JWT + `handover:write` |
| POST | `/api/ai/summarize-sbar` | Resume notas clínicas en formato SBAR. | JWT + `handover:write` |
| POST | `/api/ai/suggest-interventions` | Genera sugerencias de intervenciones de enfermería. | JWT + `handover:write` |
| POST | `/api/upload/audio-to-fhir` | Sube audio y crea un `DocumentReference` en servidor FHIR. | JWT + `handover:write` |

CLI (sin servidor auxiliar):
```bash
python manage.py transcribe_audio ./audio.m4a --language es
```

### Variables de entorno backend

- FHIR y validación: `FHIR_BASE`, `HANDOVER_FHIR_VALIDATION_MODE`, `HANDOVER_VALIDATE_STRICT`, `HANDOVER_REQUIRE_RBAC_ON_FHIR`.`r`n- ICEA+: `ICEA_WEBHOOK_ENABLED`, `ICEA_WEBHOOK_URL`, `ICEA_WEBHOOK_SECRET`, `ICEA_WEBHOOK_TIMEOUT_MS`, `ICEA_WEBHOOK_RETRY_MAX`, `ICEA_WEBHOOK_ANTI_REPLAY`, `ICEA_WEBHOOK_REPLAY_WINDOW_SECONDS`.
- Firma digital: `HANDOVER_PRIVATE_KEY_PATH`, `HANDOVER_PUBLIC_KEY_PATH`, `HANDOVER_SIGNATURE_DISABLED`.
- IA: `OPENAI_API_KEY`, `OPENAI_MODEL_SBAR`, `OPENAI_MODEL_WHISPER`, `OPENAI_MODEL_SUGGESTIONS`, `AI_SUGGESTIONS_ENABLED`.
- Uploads de audio: `HANDOVER_MAX_AUDIO_BYTES` (por defecto `26214400`, equivalente a 25 MB).

## Instalación y ejecución

1. Instala dependencias JavaScript:
   ```bash
   pnpm -w install
   ```
2. Levanta el backend opcional (Django) si necesitas un API REST local:
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
- La firma se serializa en `bundle.signature` como recurso FHIR Signature (ECDSA + SHA-256) y se registra un hash único en la tabla `HandoverSignatureAudit` junto con `user_id`, `signed_at` y el `data` base64.
- En entornos de desarrollo se puede desactivar la firma criptográfica exportando `HANDOVER_SIGNATURE_DISABLED=true`. Cuando la librería `cryptography` no está disponible, el backend recurre a `openssl dgst` para firmar/verificar usando las claves PEM configuradas.

## Pruebas

La automatización usa Vitest junto con utilidades específicas para FHIR y seguridad.

- Revisar tipos: `pnpm -w typecheck`
- Linter: `pnpm -w lint`
- Unit/integration y validaciones FHIR: `pnpm -w vitest run --reporter=verbose`
- Cobertura ≥ 80 %: `pnpm -w vitest run --reporter=verbose --coverage`
- Validación puntual de bundles FHIR: `pnpm validate:fhir`

Los umbrales de cobertura están definidos en `vitest.config.ts` y se enfocan en seguridad (`src/lib/auth.ts`, `src/lib/net.ts`), validaciones (`src/validation/schemas.ts`) y componentes críticos (`src/screens/HandoverForm.tsx`).
El reporte HTML queda en `coverage/unit/index.html` y el `lcov.info` en `coverage/unit/lcov.info` para integrar con Codecov u otras herramientas.

### CI y resiliencia del registry

El workflow `CI` usa Node 20 y pnpm 10. El job de Node está configurado como “non-blocking” (`continue-on-error: true`) para mitigar errores `403` intermitentes del registry de npm; revisa los logs del paso `Install` para confirmar si ocurrió la incidencia.


El workflow también instala navegadores Playwright y ejecuta E2E (`pnpm -w test:e2e`), por lo que las referencias a Playwright/E2E en PRs son válidas para CI mientras ese job permanezca activo en `.github/workflows/ci.yml`.

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

### Catálogos NNN gobernados (BYO-license)

Los catálogos completos de `NANDA`, `NIC` y `NOC` se mantienen en modo **BYO-license**:
- el repo solo incluye placeholders mínimos para búsqueda y pruebas;
- los datasets completos se cargan bajo demanda desde variables de entorno, URL externa o endpoints backend cacheables;
- la UI muestra un gate explícito antes de habilitar el catálogo completo.

Frontend/Expo:

```bash
export EXPO_PUBLIC_NANDA_CATALOG_JSON='{"licensed":true,"version":"2026","codes":[{"system":"NANDA","code":"00001","display":"Oxigenación alterada"}]}'
export EXPO_PUBLIC_NANDA_CATALOG_URL='https://terminology.example/nanda.json'
export EXPO_PUBLIC_NIC_CATALOG_JSON='{"licensed":true,"version":"2026","codes":[{"system":"NIC","code":"2210","display":"Administración de analgésicos"}]}'
export EXPO_PUBLIC_NIC_CATALOG_URL='https://terminology.example/nic.json'
export EXPO_PUBLIC_NOC_CATALOG_JSON='{"licensed":true,"version":"2026","codes":[{"system":"NOC","code":"0402","display":"Estado respiratorio: permeabilidad de las vías aéreas"}]}'
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

Consulta `docs/DEPLOY.md` para builds Android/iOS/Web. Las notas de la versión RC actual están en `RELEASE_NOTES.md` y los cambios detallados en `CHANGELOG.md`. Para publicar una RC:

1. Ejecuta los cheques (`pnpm -w typecheck`, `pnpm -w lint`, `pnpm -w vitest run --reporter=verbose`).
2. Genera los binarios siguiendo la guía de despliegue.
3. Crea el tag `v0.4.0-rc.1` y sube artefactos + notas al repositorio.

## Para desarrolladores
Explora la documentación técnica para conocer la arquitectura, configuración y flujos clave antes de contribuir al proyecto.

- [Arquitectura general](docs/overview-architecture.md)
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
- Backend: `ENABLE_ICEA_BRIDGE`, `ENABLE_ICEA_IMMEDIATE_SCORING`, `ENABLE_ICEA_ENRICHED_SCORING=false` por defecto, `ICEA_BRIDGE_MODEL_ID` obligatorio para score real, `ICEA_BRIDGE_SCORE_PATH=/api/v1/icea-plus/score/`, `ICEA_BRIDGE_STATUS_PATH` opcional
- Frontend: `EXPO_PUBLIC_ENABLE_ICEA_BRIDGE`, `EXPO_PUBLIC_ENABLE_ICEA_IMMEDIATE_SCORING`, `EXPO_PUBLIC_ENABLE_ICEA_ENRICHED_SCORING=false` por defecto

Mientras el upstream ICEA+ no publique un endpoint real de status para score, HANDOVER no inventa polling: el estado local visible pasa a ser la fuente operativa y solo se intenta refresh remoto cuando el cliente pide `refresh=true` y existe `ICEA_BRIDGE_STATUS_PATH` configurado.

Documentacion relacionada:
- [Bridge analitico ICEA+](docs/icea-bridge.md)
- [Integracion ICEA+](docs/icea-integration.md)




