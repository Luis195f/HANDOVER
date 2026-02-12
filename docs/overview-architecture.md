# Arquitectura general

La aplicación móvil usa React Native (Expo) y TypeScript con una capa de formularios que valida datos con Zod antes de mapearlos a recursos FHIR. El flujo típico es UI → validaciones (`zod`) → mapeo a `Bundle` FHIR → envío mediante el cliente FHIR → backend/HCE opcional cuando se necesita integración adicional.

## Componentes principales
- **Pantallas (`src/screens/`)**: formularios y vistas como `HandoverForm.tsx`, `SyncCenter.tsx` y `LoginMock.tsx` para flujos de clínica, sincronización y pruebas.
- **Librerías (`src/lib/`)**: 
  - `net.ts` aplica `safeFetch` con timeouts, backoff y cabeceras de idempotencia.
  - `fhir-client.ts` centraliza llamadas FHIR, manejo de `OperationOutcome` y compatibilidad con reenvíos.
  - `queue.ts` y `sync.ts` gestionan la cola offline, almacenando bundles en SQLite y reintentando cuando hay conectividad.
  - `fhir-map.ts` transforma los datos del formulario en `Bundle` y recursos (`Observation`, `Composition`, `MedicationStatement`, entre otros).
- **Seguridad (`src/security/`)**: `auth.ts` implementa el flujo OAuth/OIDC y almacenamiento seguro, mientras que `acl.ts` provee guardias (`ensureRole`, `ensureUnit`) para proteger pantallas según rol y unidad.
- **Validación (`src/validation/schemas.ts`)**: define los esquemas Zod para validar datos del formulario antes de generar recursos interoperables.
- **Scripts y backend opcional**:
  - `scripts/validate-fhir.ts` permite validar bundles en CI o de forma local.
  - El backend Django en `backend/` expone una API REST opcional y puede reenviar bundles al servidor FHIR.

## Configuración y entornos
- Variables de entorno en `.env` gobiernan OIDC, FHIR y parámetros de red; Expo las expone también desde `app.json` en `expo.extra` para el cliente móvil.
- `FHIR_BASE_URL` o `EXPO_PUBLIC_FHIR_BASE_URL` indican el endpoint FHIR; otras variables de `EXPO_PUBLIC_*` afinan la cola offline, almacenamiento y autenticación.
- El backend opcional puede ejecutarse localmente para pruebas; la app se comunica con él mediante `EXPO_PUBLIC_API_BASE_URL`.
