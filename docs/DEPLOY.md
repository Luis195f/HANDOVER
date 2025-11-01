# Despliegue y Release Candidate

Esta guía describe cómo generar builds para Android, iOS y Web, así como los requisitos de entorno para preparar el Release Candidate `v0.4.0-rc.1`.

## Pre-requisitos

- Node.js 20 y pnpm 10 instalados en la máquina de build.
- Cuenta en Expo/EAS con permisos para el proyecto (`app.json > expo.extra.eas.projectId`).
- Variables de entorno:
  - `EXPO_TOKEN` (si usas EAS Build en CI).
  - Credenciales de firma de Android (keystore) y iOS (Apple Developer) si se generan builds firmados.
- Archivo `.env` con configuración OIDC y `FHIR_BASE_URL` actualizado.

## Instalación común

```bash
pnpm -w install --frozen-lockfile
pnpm -w typecheck
pnpm -w lint
pnpm -w vitest run --reporter=verbose
```

Los comandos anteriores deben pasar antes de generar artefactos.

## Builds con Expo CLI (local)

### Android (APK debug)
```bash
pnpm expo run:android --variant debug
```
El APK se genera en `android/app/build/outputs/apk/debug/`. Comparte el archivo como artefacto del RC.

### Android (bundle firmado)
```bash
pnpm expo run:android --variant release
```
Asegúrate de configurar `android/gradle.properties` con las credenciales del keystore (alias, password). Sube el `.aab` o `.apk` resultante.

### iOS (simulador)
```bash
pnpm expo run:ios --device
```
Para builds firmados, abre `ios/` con Xcode y selecciona el equipo de firma. Exporta el `.ipa` desde el organizer y adjúntalo al release.

### Web
```bash
pnpm expo export --platform web
```
El contenido estático queda en `dist/`. Puedes desplegarlo en cualquier hosting estático (Netlify, Vercel, S3).

## Builds con EAS

1. Inicia sesión: `pnpm dlx eas login` (o configura `EAS_NO_VCS=1` en CI).
2. Sincroniza dependencias nativas: `pnpm expo prebuild` si agregaste paquetes nativos nuevos.
3. Ejecuta:
   - Android: `pnpm dlx eas build --platform android --profile preview`
   - iOS: `pnpm dlx eas build --platform ios --profile preview`
4. Descarga los artefactos desde la consola de Expo y adjúntalos al release.

## Consideraciones offline

- La cola offline reside en `src/lib/queue.ts` y `src/lib/sync.ts`. Antes de un release, verifica que la migración de esquema SQLite esté incluida en el build (`expo-sqlite`).
- Usa `pnpm validate:fhir` para asegurarte de que los bundles generados por la cola cumplan con los perfiles requeridos.

## Checklist para `v0.4.0-rc.1`

1. Ejecutar CI (typecheck, lint, vitest) en la rama release.
2. Generar artefactos Android/iOS/Web y almacenarlos como adjuntos del release en GitHub.
3. Redactar notas utilizando `RELEASE_NOTES.md` como base.
4. Crear tag y release:
   ```bash
   git tag v0.4.0-rc.1
   git push origin v0.4.0-rc.1
   ```
5. Publicar el release en GitHub con enlaces a los artefactos y resaltar cambios de seguridad/permisos, nuevas pruebas y validaciones FHIR.
