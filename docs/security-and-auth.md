# Seguridad y autenticación

## Flujo OAuth2/OIDC
- La app usa `expo-auth-session` para iniciar sesión contra el proveedor OIDC configurado.
- Variables clave en `.env` o `app.json` (`expo.extra`): `OIDC_ISSUER`, `OIDC_CLIENT_ID`, `OIDC_AUDIENCE`, `OIDC_SCOPE`, `OIDC_REDIRECT_SCHEME`. Ajusta el `client_secret` si el flujo lo requiere.
- Tras autenticarse, los tokens se usan para llamar al servidor FHIR y al backend opcional.

## Almacenamiento de sesión
- `src/security/auth.ts` guarda tokens y metadatos en `SecureStore`, maneja renovación y limpia la sesión en logout.
- Se expone el estado de autenticación para proteger rutas y reintentos de red.

## Endurecimiento de red y cabeceras
- Define `HANDOVER_ALLOWED_ORIGINS` con los orígenes HTTPS permitidos (separados por comas). Django y FastAPI compartirán esta lista para CORS y `ALLOWED_HOSTS`. En desarrollo se permiten hosts `localhost` via regex.
- HSTS y redirección a HTTPS se activan con `SECURE_SSL_REDIRECT` (controlado por `ENABLE_SSL_REDIRECT`, por defecto `true`) y `SECURE_HSTS_SECONDS=31536000`.
- Django añade cabeceras seguras (`X-Content-Type-Options`, `X-Frame-Options=DENY`, `Referrer-Policy=strict-origin-when-cross-origin`) y CSP a través de `django-csp`. Ajusta `CSP_*` en `backend/settings.py` si incorporas scripts o fuentes externas adicionales.
- FastAPI envía CSP mínima y las mismas cabeceras de endurecimiento para Swagger/HTML mediante un middleware ligero.
- Para despliegue productivo se recomienda colocar el backend detrás de un reverse proxy (Nginx, Traefik, ALB) configurado solo con TLS 1.3, HTTP/2 y suites modernas (p. ej. `TLS_AES_256_GCM_SHA384`). Si se usa `uvicorn` directo, define `ssl_certfile`, `ssl_keyfile` y `ssl_version=ssl.PROTOCOL_TLSv1_3`.

## Roles y RBAC
- Roles básicos esperados: `nurse`, `admin`, `viewer` (claim `role` en el token).
- `src/security/acl.ts` implementa guardias reutilizables:
  - `ensureRole` valida que el usuario posea alguno de los roles requeridos.
  - `ensureUnit` limita acceso a unidades clínicas específicas según `EXPO_PUBLIC_ALLOWED_UNITS`/`EXPO_PUBLIC_ALLOW_ALL_UNITS`.
- Usa estas utilidades en nuevas pantallas para mantener reglas de acceso coherentes.
