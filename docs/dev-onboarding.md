# Guía de onboarding para desarrolladores

## Requisitos de entorno
- Node.js 20 y pnpm 10.
- Expo CLI (`pnpm dlx expo install` instala dependencias nativas cuando se añaden paquetes).
- (Opcional) Python 3.10+ y PostgreSQL/SQLite si se va a ejecutar el backend Django incluido.

## Puesta en marcha del repositorio
1. Clona el repositorio y crea tu archivo de entorno:
   ```bash
   git clone <url>
   cd HANDOVER
   cp .env.example .env
   ```
2. Completa las variables OIDC (`OIDC_ISSUER`, `OIDC_CLIENT_ID`, `OIDC_AUDIENCE`, `OIDC_SCOPE`, `OIDC_REDIRECT_SCHEME`) y los endpoints FHIR (`FHIR_BASE_URL` o `EXPO_PUBLIC_FHIR_BASE_URL`). Ajusta otros valores de `EXPO_PUBLIC_*` según el entorno.

## Instalación de dependencias
- Cliente móvil: `pnpm -w install`.
- Adjuntos (imágenes/documentos): `pnpm dlx expo install expo-image-picker expo-document-picker expo-file-system`.
- Backend opcional (solo si necesitas API REST local):
  ```bash
  python -m venv .venv
  source .venv/bin/activate  # Windows: .venv\Scripts\activate
  pip install -r requirements.txt
  python manage.py migrate
  python manage.py runserver 0.0.0.0:8000
  ```

## Ejecución de la app Expo
- Desarrollo con QR o emulador: `pnpm expo start`.
- Ejecución directa en emuladores: `pnpm expo run:android` o `pnpm expo run:ios`.
- Web: `pnpm expo start --web`.

## Funciones de desarrollo
- Login mock para entornos sin OIDC: habilita `LoginMock.tsx` ajustando las banderas de características en `app.json` (`expo.extra`).
- Las variables de entorno también pueden configurarse en `app.json` bajo `expo.extra` para integrarse con EAS y builds móviles.
