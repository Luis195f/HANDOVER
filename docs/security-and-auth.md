# Seguridad y autenticación

## Flujo OAuth2/OIDC
- La app usa `expo-auth-session` para iniciar sesión contra el proveedor OIDC configurado.
- Solicita el scope `offline_access` (u otro equivalente) para recibir `refresh_token`.
- Variables clave en `.env` o `app.json` (`expo.extra`): `OIDC_ISSUER`, `OIDC_CLIENT_ID`, `OIDC_AUDIENCE`, `OIDC_SCOPE` (incluye `offline_access`), `OIDC_REDIRECT_SCHEME`.
- Tras autenticarse, la app almacena `access_token` y `refresh_token` en `SecureStore` y renueva automáticamente cuando falten ~5 minutos para expirar.
- El backend expone `/api/auth/refresh` para renovar tokens si se necesita centralizar el flujo (usa `OIDC_TOKEN_URL`).

## Almacenamiento de sesión
- `src/security/auth.tsx` guarda tokens y metadatos en `SecureStore`, maneja renovación y limpia la sesión en logout.
- Se expone el estado de autenticación para proteger rutas y reintentos de red.

## Endurecimiento de red y cabeceras
- Define `HANDOVER_ALLOWED_ORIGINS` con los orígenes HTTPS permitidos (separados por comas). Django/DRF usará esta lista para CORS y `ALLOWED_HOSTS`. En desarrollo se permiten hosts `localhost` via regex.
- HSTS y redirección a HTTPS se activan con `SECURE_SSL_REDIRECT` (forzado en producción) y `SECURE_HSTS_SECONDS=31536000`. Consulta la guía oficial de Django para cabeceras seguras: https://docs.djangoproject.com/en/stable/topics/security/#ssl-https y valida los valores en `backend/settings.py`.
- Django añade cabeceras seguras (`X-Content-Type-Options`, `X-Frame-Options=DENY`, `Referrer-Policy=strict-origin-when-cross-origin`) y CSP a través de `django-csp`. Ajusta `CONTENT_SECURITY_POLICY` en `backend/settings.py` si incorporas scripts o fuentes externas adicionales.
- Para despliegue productivo se recomienda colocar el backend detrás de un reverse proxy (Nginx, Traefik, ALB) configurado con certificados de Let's Encrypt, TLS 1.3, HTTP/2 y suites modernas (p. ej. `TLS_AES_256_GCM_SHA384`). Revisa el ejemplo en `config/nginx/handover.conf` y ajusta el dominio y rutas de certificados. Si se usa `uvicorn` directo, define `ssl_certfile`, `ssl_keyfile` y `ssl_version=ssl.PROTOCOL_TLSv1_3`.

## Roles y RBAC
- Roles básicos esperados: `nurse`, `admin`, `viewer` (claim `role` en el token).
- `src/security/acl.ts` implementa guardias reutilizables:
  - `ensureRole` valida que el usuario posea alguno de los roles requeridos.
  - `ensureUnit` limita acceso a unidades clínicas específicas según `EXPO_PUBLIC_ALLOWED_UNITS`/`EXPO_PUBLIC_ALLOW_ALL_UNITS`.
- Usa estas utilidades en nuevas pantallas para mantener reglas de acceso coherentes.
- El backend valida roles + scopes antes de ejecutar la lógica de la vista y reenvía el `access_token` del usuario al servidor FHIR para aplicar RBAC de forma consistente.
- Evita usar tokens estáticos (`FHIR_TOKEN`) para llamadas de usuario; el token del usuario se reenvía en `Authorization`.

## Variables de entorno adicionales (backend)
- `OIDC_TOKEN_URL`: endpoint del proveedor OIDC para `refresh_token` (requerido por `/api/auth/refresh`).
- `OIDC_CLIENT_ID` / `OIDC_CLIENT_SECRET`: credenciales para el flujo de refresh.
- `OIDC_SCOPE`: scopes solicitados en el refresh (incluye `offline_access` si el proveedor lo exige).
- `HANDOVER_REQUIRE_RBAC_ON_FHIR`: si es `true`, el backend requiere un token de usuario para reenviar peticiones a FHIR (evita usar tokens estáticos).

## Variables de entorno adicionales (frontend)
- `EXPO_PUBLIC_OIDC_SCOPE`: incluye `offline_access` para recibir `refresh_token`.

## Captura clínica en el relevo
- Las secciones de enfermería capturan nutrición (tipo de dieta, tolerancia, ingesta), eliminación (diuresis, patrón deposicional, sonda rectal), movilidad/piel (nivel de movilidad, plan de reposicionamiento, estado de piel y úlceras por presión) y balance hídrico (entradas, salidas, balance neto y notas).
- Signos vitales incluyen valores numéricos, AVPU y timestamps opcionales de registro/emisión en formato ISO (útiles para el mapeo FHIR y auditoría clínica).
- Exámenes y procedimientos permiten registrar descripción, estado y si se realizaron, para sincronizar con el backend y el bundle FHIR correspondiente.
