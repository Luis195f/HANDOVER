# Arquitectura general (Django-only)

> Estado del documento
> - Estado: `implemented`.
> - Última revisión: 2026-03-26.
> - Fuente de verdad / evidencia base: `backend/api/urls.py`, `backend/api/views.py`, `docs/MASTER_GOVERNANCE_REGISTER.md`.
> - Riesgos o lagunas abiertas: el documento describe la arquitectura vigente del repo, no una topología full-stack cerrada de despliegue ni un release publicado.

HANDOVER mantiene una arquitectura **Django-only** en backend: no existe dependencia operativa de FastAPI para la API clínica principal.

La fuente de verdad operativa del backend en este corte está compuesta por `manage.py`, `backend/api/urls.py`, `Procfile` y `.github/workflows/django.yml`. En esta rama no hay `main.py` trackeado en la raíz y no forma parte de la ruta clínica operativa actual. La decisión queda fijada en [`docs/adr/0001-backend-source-of-truth.md`](adr/0001-backend-source-of-truth.md).

## Resumen técnico
- **Frontend**: React Native + Expo (TypeScript).
- **Backend**: Django + Django REST Framework (DRF) como única capa API.
- **Interoperabilidad**: FHIR R4 mediante transacciones `Bundle` y recursos clínicos.
- **Seguridad**: autenticación JWT OIDC (Auth0), RBAC por rol, scopes por operación, firma digital opcional y auditoría.
- **Perfiles clínicos**: contrato base tipado para HANDOVER Core, Unit Profile Packs y Specialty Overlay Packs documentado en docs/profile-architecture.md, con activación separada del catálogo maestro y overlays bloqueados si no existe un UPP activo compatible.

## Backend clínico (100% Django + DRF)
- `BundleView` en `/api/fhir/transaction` recibe `Bundle` tipo transacción y reenvía al servidor FHIR.
- Endpoints complementarios incluyen paciente, medicación, capacidades y refresh de sesión.
- Endpoints AI disponibles en DRF:
  - `POST /api/ai/transcribe`
  - `POST /api/ai/summarize-sbar`
  - `POST /api/ai/suggest-interventions` (si está habilitado)

## Flujo de transacción FHIR (BundleView)
1. Verifica autenticación (Bearer) y controles de acceso (rol + scopes).
2. Resuelve `sub` autenticado desde claims/JWT como identidad canónica.
3. Valida estructura mínima del `Bundle`; modo de validación ampliado según `HANDOVER_FHIR_VALIDATION_MODE`.
4. Firma digitalmente (si no está deshabilitado) y registra evidencia de firma/auditoría.
5. Reenvía al FHIR server y normaliza respuestas de error (`OperationOutcome`) para cliente/observabilidad.

## Controles de seguridad aplicados
- **Validación FHIR**:
  - `off`: validación mínima de seguridad/estructura.
  - `remote`: validación remota `$validate` en servidor FHIR.
  - `strict`: validación de esquema más estricta.
- **Firma digital**:
  - Usa claves configuradas por entorno para firmar bundles.
  - Permite modo deshabilitado en desarrollo con flag explícito.
- **Auditoría**:
  - Eventos clínicos y AI con hash de payload y metadatos operativos.
- **RBAC + scopes**:
  - Acceso condicionado por rol clínico y permisos finos (`handover:write`, `fhir:transaction`, etc.).
- **Protección anti-spoofing de identidad**:
  - El backend usa el `sub` autenticado del token como fuente de verdad.
  - Cabeceras cliente como `X-User-Id` no son autoridad para identidad clínica.
