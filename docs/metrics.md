# Métricas de tiempo de handover

## Objetivo
Medir tiempo efectivo por sección para detectar fricción sin registrar contenido clínico.

## Secciones instrumentadas
- `sbar`
- `vitals`
- `diagnostics`
- `treatments`

## Flujo frontend
- Hook: `useHandoverTiming` con `performance.now()`.
- Inicio/fin por expansión/colapso de secciones.
- Envío al backend en `flush` durante submit (best-effort, no bloquea el encolado clínico).
- Feature flag: `SHOW_HANDOVER_TIMING_METRICS` (off por defecto).

## Endpoint backend
- `POST /api/metrics/handover-time`
  - payload permitido: `sectionId`, `durationMs`, `unitId`, `requestId`.
  - guarda evento en auditoría como `AuditEvent` (`event_type=handover_timing`) con `meta.timing` y estructura FHIR-like en `meta.fhir`.
- `GET /api/metrics/handover-time`
  - supervisor/admin only.
  - agrega en base de datos por `unitId` y `sectionId` sobre todos los eventos disponibles (sin truncado silencioso).

## Privacidad
Nunca se guarda SBAR, notas ni payload clínico. Solo:
- `durationMs`
- `sectionId`
- `unitId`
- `requestId`
