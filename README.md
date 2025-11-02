# Handover Pro

Aplicación móvil para pases de turno clínico construida con React Native (Expo) y TypeScript. Incluye un backend Django opcional para pruebas locales y una cola offline que garantiza la entrega de bundles FHIR incluso con conectividad intermitente.

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
   - `OIDC_ISSUER`, `OIDC_CLIENT_ID`, `OIDC_AUDIENCE`, `OIDC_SCOPE` y `OIDC_REDIRECT_SCHEME` configuran el flujo de OAuth/OIDC utilizado por el módulo `src/lib/auth.ts`.
   - `FHIR_BASE_URL` define la URL base consumida por `src/lib/fhir-client.ts` para leer/escribir Bundles.
2. Variables adicionales leídas desde Expo (`app.json > expo.extra`) o el entorno:
   - `EXPO_PUBLIC_API_BASE_URL` (o `API_BASE_URL`) apunta al backend REST si se usa el servidor Django.
   - `EXPO_PUBLIC_API_TOKEN` agrega un token para llamadas autenticadas contra APIs complementarias.
   - `EXPO_PUBLIC_STORAGE_NAMESPACE` personaliza el espacio de almacenamiento seguro.

## Login y permisos

- El login usa OAuth 2.0/OIDC mediante `expo-auth-session`. Define permisos y roles en el backend de identidad para que el claim `role` incluya valores como `nurse`, `admin` o `viewer`.
- En Android se solicitan permisos para cámara, micrófono y notificaciones (ver `app.json`). El flujo de QR y notas de audio depende de `android.permission.CAMERA` y `android.permission.RECORD_AUDIO` respectivamente.
- Para pruebas sin un proveedor OIDC real, puedes habilitar la pantalla mock en `src/screens/LoginMock.tsx` ajustando las banderas de características en `app.json`.

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
3. Arranca el cliente Expo:
   ```bash
   pnpm expo start
   ```
   Usa la app Expo Go o un emulador (`pnpm expo run:android`, `pnpm expo run:ios`, `pnpm expo start --web`).

## Pruebas

La automatización usa Vitest junto con utilidades específicas para FHIR y seguridad.

- Revisar tipos: `pnpm -w typecheck`
- Linter: `pnpm -w lint`
- Unit/integration y validaciones FHIR: `pnpm -w vitest run --reporter=verbose`
- Validación puntual de bundles FHIR: `pnpm validate:fhir`

Los umbrales de cobertura están definidos en `vitest.config.ts` y se enfocan en seguridad (`src/lib/auth.ts`, `src/lib/net.ts`), validaciones (`src/validation/schemas.ts`) y componentes críticos (`src/screens/HandoverForm.tsx`).

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
