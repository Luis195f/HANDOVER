# Handover Pro

![CI](./ci-badge.svg)
![Coverage](./coverage-badge.svg)

Aplicación móvil para pases de turno clínico construida con React Native (Expo) y TypeScript. Incluye un backend Django opcional para pruebas locales y una cola offline que garantiza la entrega de bundles FHIR incluso con conectividad intermitente.

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
    - `HANDOVER_FHIR_VALIDATION_MODE`: controla la validación de Bundles FHIR en el backend FastAPI (`main.py`).
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
     - `EXPO_PUBLIC_STT_ENDPOINT`/`STT_ENDPOINT`: endpoint HTTPS para dictado (STT).
     - `EXPO_PUBLIC_AI_BACKEND_BASE_URL`/`AI_BACKEND_BASE_URL`: backend IA (FastAPI) con `/ai/transcribe` y `/ai/summarize-sbar`.
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
- Dictado STT:
  - `STT_ENDPOINT` habilita el proveedor externo de dictado (stream/near‑real‑time) en iOS/Android.
  - Si no hay `STT_ENDPOINT`, la app puede degradar a una transcripción batch vía `AI_BACKEND_BASE_URL` (envía el audio grabado al backend).
  - Si ningún backend está configurado, el dictado se desactiva y no bloquea el flujo clínico (feature preparada para proveedor externo).
- Transcripción con IA (botón “Transcribir nota con IA”) usa `AI_BACKEND_BASE_URL` → `/ai/transcribe` y requiere un backend configurado. Sin backend, la UI muestra error y el resto del formulario funciona.
- SBAR con IA:
  - Generación y refinado usan `AI_BACKEND_BASE_URL` (`/ai/summarize-sbar`) y/o `AI_SBAR_BASE_URL` (`/api/sbar/refine`).
  - Si no hay credenciales, los botones de IA se deshabilitan y se mantiene la generación local determinística.
- TTS usa `expo-speech` y solo está disponible en iOS/Android; en web se muestra como no disponible.
- Subida de audio a FHIR (opcional) requiere `API_BASE_URL` con el endpoint `/upload/audio-to-fhir`.

## Criptografía en cliente

- Hashing y random bytes se resuelven vía `expo-crypto` sin añadir polyfills globales de `crypto`.
- La firma de bundles FHIR depende de `globalThis.crypto.subtle`; si no está disponible, la firma se omite y el envío continúa sin bloquear la cola.

## Firma eIDAS de PDFs (entrega clínica)

- El flujo de firma cualificada eIDAS se integra en `src/lib/eidas-signature.ts` y genera PDFs firmados en formato PAdES, con metadatos de auditoría (certificado, timestamp) anexados al `DocumentReference` FHIR.
- En producción configura `EXPO_PUBLIC_EIDAS_API_URL` y credenciales (`EXPO_PUBLIC_EIDAS_CLIENT_ID`, `EXPO_PUBLIC_EIDAS_CLIENT_SECRET`, `EXPO_PUBLIC_EIDAS_API_KEY`) mediante secretos o almacenamiento seguro; nunca hardcodear certificados o claves.
- En desarrollo, si no hay proveedor configurado, se genera un mock local para no bloquear la UI. Antes de usar en un entorno real, valida el flujo con el proveedor eIDAS homologado y actualiza las políticas internas de trazabilidad (IEC 62304, MDR, eIDAS).

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
   - Define `HANDOVER_ALLOWED_ORIGINS` (p. ej. `https://app.handover-pro.es,https://app.handover-pro.lat`) para restringir CORS/ALLOWED_HOSTS y mantener CSP/Referrer-Policy alineadas en Django/FastAPI.
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
