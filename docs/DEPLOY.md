# Guía de despliegue — Handover Pro v0.4.0-rc.1

Este documento resume el flujo para generar builds de Android, iOS y Web, así como notas de troubleshooting y manejo offline.

## 1. Preparativos

1. **Variables de entorno**
   - Copia `.env.example` → `.env` y rellena:
     - `OIDC_ISSUER`, `OIDC_CLIENT_ID`, `OIDC_AUDIENCE`
     - `OIDC_REDIRECT_SCHEME` (`handoverpro` por defecto)
     - `FHIR_BASE_URL`
   - Exporta las mismas variables en tu entorno CI/CD (`EXPO_PUBLIC_*` si usas EAS Build).
2. **Credenciales Expo/EAS**
   - Ejecuta `pnpm expo login` y asegúrate de tener permisos sobre el proyecto.
   - Para builds nativos necesitarás certificados (Android keystore / Apple signing). Usa `eas credentials` para gestionarlos.
3. **Dependencias**
   ```bash
   pnpm install
   pnpm expo doctor
   ```
4. **Backend (opcional)**: desplegar `backend/` en tu servidor (Render, Railway, etc.) usando `Procfile` y `runtime.txt`. Ajusta `DJANGO_SETTINGS_MODULE`, `SECRET_KEY` y `ALLOWED_HOSTS`.

## 2. Build Android

### 2.1 EAS Build

```bash
pnpm dlx eas-cli build --platform android --profile preview
```

- Perfil recomendado: `preview` (debuggable) o `production` si cuentas con firma subida.
- Variables necesarias en `eas.json` o en el dashboard: `EXPO_PUBLIC_FHIR_BASE_URL`, `EXPO_PUBLIC_OIDC_*`.
- El artefacto generado (`.apk` o `.aab`) se adjunta automáticamente en la página del build. Descárgalo y súbelo al release `v0.4.0-rc.1`.

### 2.2 Build local (debug)

```bash
pnpm expo run:android --variant debug
```

Asegúrate de tener un emulador o dispositivo conectado con `adb devices`. El binario debug (`app-debug.apk`) aparece en `android/app/build/outputs/apk/debug/`.

## 3. Build iOS

1. Prepara Xcode 15+ y CocoaPods (`bundle install && npx pod-install`).
2. Para EAS:
   ```bash
   pnpm dlx eas-cli build --platform ios --profile preview
   ```
3. Para build local (`.ipa` ad-hoc):
   ```bash
   pnpm expo run:ios --device
   ```
   Necesitas una cuenta Apple Developer y registrar los dispositivos.

## 4. Build Web

```bash
pnpm expo export --platform web
```
El output queda en `dist/`. Sube el contenido a tu CDN o bucket S3 con HTTPS habilitado. Configura `EXPO_PUBLIC_FHIR_BASE_URL` para que la SPA apunte al backend correcto.

## 5. Pruebas previas al release

1. `pnpm typecheck`
2. `pnpm lint`
3. `pnpm vitest run --reporter=verbose`
4. `pnpm validate:fhir ./artifacts/handover-bundle.json` (si generas bundles vía API)

Documenta los resultados en la nota de lanzamiento. Si alguna prueba falla, bloquea la publicación del artefacto hasta resolverla.

## 6. Troubleshooting

| Problema | Diagnóstico | Solución |
| -------- | ----------- | -------- |
| **403 al instalar dependencias** | Proxy corporativo bloqueando `registry.npmjs.org` | Configura `.npmrc` con tu mirror interno o habilita acceso directo. |
| **OIDC login falla** | Redirect URI no coincide | Actualiza el esquema en el proveedor OIDC (`handoverpro://callback`). |
| **Uploads FHIR rechazan bundles** | Validación estructural | Ejecuta `pnpm validate:fhir` con el JSON enviado para revisar referencias y campos obligatorios. |
| **Modo offline no sincroniza** | Falta de permisos de almacenamiento/red | Verifica permisos Android/iOS y que `FHIR_BASE_URL` sea accesible cuando vuelve la red. |

## 7. Modo offline y colas

- Los bundles se guardan en SQLite (`expo-sqlite`).
- Cada intento de sincronización registra eventos en la pantalla **Sync Center**.
- Para depurar, habilita logs con `EXPO_PUBLIC_DEBUG_SYNC=1` (añade al `.env`).

## 8. Publicación del Release Candidate

1. Etiqueta el commit final con `v0.4.0-rc.1` (`git tag v0.4.0-rc.1`).
2. Adjunta en GitHub/EAS los artefactos:
   - APK/AAB (Android)
   - IPA (iOS) o enlace TestFlight
   - Paquete web (`dist/` comprimido)
3. Copia el resumen de [RELEASE_NOTES.md](../RELEASE_NOTES.md) en la página del release.
4. Documenta cualquier limitación conocida (p. ej. soporte offline parcial) y checklist de verificación.

Con estos pasos deberías tener builds reproducibles y validados para el Release Candidate.
