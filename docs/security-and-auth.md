# Seguridad y autenticación

## Flujo OAuth2/OIDC
- La app usa `expo-auth-session` para iniciar sesión contra el proveedor OIDC configurado.
- Variables clave en `.env` o `app.json` (`expo.extra`): `OIDC_ISSUER`, `OIDC_CLIENT_ID`, `OIDC_AUDIENCE`, `OIDC_SCOPE`, `OIDC_REDIRECT_SCHEME`. Ajusta el `client_secret` si el flujo lo requiere.
- Tras autenticarse, los tokens se usan para llamar al servidor FHIR y al backend opcional.

## Almacenamiento de sesión
- `src/security/auth.ts` guarda tokens y metadatos en `SecureStore`, maneja renovación y limpia la sesión en logout.
- Se expone el estado de autenticación para proteger rutas y reintentos de red.

## Roles y RBAC
- Roles básicos esperados: `nurse`, `admin`, `viewer` (claim `role` en el token).
- `src/security/acl.ts` implementa guardias reutilizables:
  - `ensureRole` valida que el usuario posea alguno de los roles requeridos.
  - `ensureUnit` limita acceso a unidades clínicas específicas según `EXPO_PUBLIC_ALLOWED_UNITS`/`EXPO_PUBLIC_ALLOW_ALL_UNITS`.
- Usa estas utilidades en nuevas pantallas para mantener reglas de acceso coherentes.
