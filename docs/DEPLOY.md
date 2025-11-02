# Despliegue y Release Candidate

Esta guía describe cómo generar builds para Android, iOS y Web, así como los requisitos de entorno para preparar el Release Candidate `v0.4.0-rc.1`.

## Pre-requisitos

- Node.js 20 y pnpm 10 instalados en la máquina de build (los mismos usados por CI).
- Cuenta en Expo/EAS con permisos para el proyecto (`app.json > expo.extra.eas.projectId`).
- Archivo `.env` con configuración OIDC/FHIR actualizado y sincronizado en el servicio de secretos que uses.

### Variables de entorno críticas

| Contexto | Variable | Descripción |
| --- | --- | --- |
| App runtime | `OIDC_ISSUER`, `OIDC_CLIENT_ID`, `OIDC_AUDIENCE`, `OIDC_SCOPE`, `OIDC_REDIRECT_SCHEME` | Login OIDC seguro mediante `expo-auth-session`. |
| App runtime | `FHIR_BASE_URL` / `EXPO_PUBLIC_FHIR_BASE` | Endpoint FHIR con HTTPS obligatorio. |
| App runtime | `EXPO_PUBLIC_ALLOWED_UNITS`, `EXPO_PUBLIC_ALLOW_ALL_UNITS`, `EXPO_PUBLIC_BYPASS_SCOPE` | Configuración RBAC/ACL consumida por `src/security/acl.ts`. |
| App runtime | `EXPO_PUBLIC_STORAGE_NAMESPACE` | Namespacing de almacenamiento seguro/offline. |
| Offline/Red | `EXPO_PUBLIC_OFFLINE_REPLAY_MAX_ATTEMPTS`, `EXPO_PUBLIC_QUEUE_BACKOFF_BASE` | Ajustes de reintentos en la cola offline. |
| Builds | `EXPO_TOKEN` | Necesario para `eas build` en CI o cuando no se usa login interactivo. |
| Builds | `ANDROID_KEYSTORE_*` | Variables esperadas por Gradle si generas `.aab/.apk` firmados. |
| Builds | `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID`, `EAS_NO_VCS` | Variables requeridas por Expo/EAS para subir builds iOS. |

> Nota: El workflow `CI` mantiene el job de Node como no bloqueante para tolerar respuestas `403` del registry. Si reproduces la pipeline en tu entorno de release, conserva esa configuración o cache privado.

## Instalación común

```bash
pnpm -w install --frozen-lockfile
pnpm -w typecheck
pnpm -w lint
pnpm -w vitest run --reporter=verbose
pnpm -w vitest run --reporter=verbose --coverage
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
- Si planeas activar el modo de mantenimiento, configura `EXPO_PUBLIC_BYPASS_SCOPE` para permitir cuentas de soporte temporales.

## Matriz de pruebas manuales (pre-RC)

| Área | Caso | Pasos clave | Resultado esperado |
| --- | --- | --- | --- |
| UCI | Ingreso de paciente crítico | Autenticar con usuario UCI → Crear pase SBAR → Adjuntar audio → Guardar offline → Forzar modo avión → Restaurar conectividad → Sincronizar desde `SyncCenter`. | Bundle enviado con UUID único, aparece en historial con estado “Entregado”. |
| UCI | Revisión de alertas | Autenticar → Abrir lista de pacientes → Verificar badges NEWS2 > 5 → Acceder a detalle y confirmar que los datos coinciden con validaciones zod. | Alertas visibles, sin errores de permisos ni validaciones. |
| Urgencias | Escaneo QR | Autenticar con rol `triage` → Escanear QR de paciente → Completar formulario rápido → Enviar con conexión inestable (cortar Wi-Fi). | safeFetch reintenta y, si falla, el bundle queda en cola con backoff exponencial documentado. |
| Urgencias | RBAC unidades | Autenticar con usuario de Urgencias → Intentar acceder a módulo UCI protegido. | UI bloquea acceso y muestra mensaje de permisos insuficientes. |
| Transversal | Validación FHIR | Desde menú de soporte ejecutar `pnpm validate:fhir`. | Validaciones pasan sin errores; si hay fallos, se documentan antes del release. |

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
