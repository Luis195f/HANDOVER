# Handover Pro — Release Candidate Guide

Handover Pro es una app móvil (Expo/React Native + TypeScript) respaldada por un backend Django que sincroniza reportes clínicos con servidores FHIR compatibles. Este documento resume cómo preparar tu entorno, autenticarte y ejecutar las verificaciones necesarias para el Release Candidate `v0.4.0-rc.1`.

## Requisitos

| Herramienta                | Versión recomendada |
| -------------------------- | ------------------- |
| Node.js                    | 20.x                |
| pnpm                       | 10.x                |
| Expo CLI                   | 10+ (viene con `pnpm expo`) |
| Python                     | 3.11/3.12 (para backend Django) |
| Java JDK (Android opcional)| 17                  |

> 💡 Asegúrate de tener permisos de red para acceder al registro de npm y, si compilas Android/iOS, instala los SDK correspondientes.

## Variables de entorno y credenciales

1. Copia el archivo de ejemplo y personaliza tus valores:
   ```bash
   cp .env.example .env
   ```
2. Configura un proveedor OIDC con permisos `openid profile email offline_access` y registra una app con redirect URI `handoverpro://callback` (o el esquema definido en `OIDC_REDIRECT_SCHEME`).
3. Solicita a tu administrador el `FHIR_BASE_URL` de tu entorno (sandbox o producción) y verifica que tengas permisos `Bundle.write` sobre el servidor.
4. Para pruebas locales puedes reutilizar usuarios de desarrollo; la app requiere acceso a micrófono, cámara y almacenamiento para adjuntar audio o imágenes.

## Instalación y ejecución

1. **Dependencias frontend**
   ```bash
   pnpm install
   ```
2. **Backend Django (opcional para pruebas end-to-end)**
   ```bash
   python -m venv .venv
   source .venv/bin/activate  # Windows: .venv\Scripts\activate
   pip install -r requirements.txt
   python manage.py migrate
   python manage.py runserver 0.0.0.0:8000
   ```
3. **Iniciar Expo**
   ```bash
   pnpm expo start --tunnel
   ```
   Desde la app Expo Go o un emulador podrás escanear el QR. Configura el mismo `FHIR_BASE_URL` que uses en backend/sandbox.

### Notas sobre permisos móviles

- Android: acepta permisos de micrófono, cámara y almacenamiento para adjuntar audio. Si usas modo offline, habilita `WRITE_EXTERNAL_STORAGE` en el dispositivo.
- iOS: el flujo requiere autorización de micrófono para la grabadora SBAR.
- Si tu organización aplica MDM, solicita whitelisting para el esquema `handoverpro://` y los endpoints del servidor FHIR.

## Pruebas y chequeos de calidad

| Comando | Descripción |
| ------- | ----------- |
| `pnpm typecheck` | Ejecuta `tsc --noEmit` sobre el workspace. |
| `pnpm lint` | Ejecuta ESLint con la configuración del monorepo. |
| `pnpm vitest run --reporter=verbose` | Corre las pruebas unitarias/Vitest (incluye la validación FHIR). |
| `pnpm validate:fhir path/al/bundle.json` | Valida un Bundle FHIR generado fuera del runner de pruebas (utiliza `scripts/validate-fhir.ts`). |

> ✅ Definition of Done del RC: los tres comandos anteriores deben pasar sin errores. Añade `pnpm validate:fhir` en CI cuando quieras validar bundles exportados desde pipelines externos.

## Flujo de autenticación

1. La app inicia sesión vía Auth0/Keycloak (cualquier servidor OIDC) usando `expo-auth-session`.
2. Se espera un token con scope `offline_access` para refrescar credenciales sin intervención del usuario.
3. El backend Django expone endpoints REST protegidos con el mismo JWT. Para depurar, puedes usar `curl -H "Authorization: Bearer <token>" http://localhost:8000/api/ping`.

## Sincronización y modo offline

- Los formularios se guardan en una cola local (SQLite) y se reintentan con backoff exponencial.
- En modo offline, la app almacena los bundles en espera. Al recuperar conexión, usa la cola para sincronizar con el servidor FHIR definido en `FHIR_BASE_URL`.
- Puedes monitorear el estado en la pantalla **Sync Center** (menú lateral).

## Recursos adicionales

- [docs/DEPLOY.md](docs/DEPLOY.md): pasos detallados para compilar Android/iOS/Web y generar artefactos.
- [CHANGELOG.md](CHANGELOG.md) y [RELEASE_NOTES.md](RELEASE_NOTES.md): resumen de cambios del Release Candidate.
- `.github/workflows/ci.yml`: pipeline con typecheck, lint y pruebas.

¡Listo! Con este flujo deberías poder preparar builds de validación clínica y entregar el Release Candidate `v0.4.0-rc.1`.
