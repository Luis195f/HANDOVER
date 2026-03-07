# Plantilla de registro de decisiones clínicas de IA (NNN + ICEA+)

> Finalidad: evidenciar uso real de sugerencias IA como soporte documental, preservando trazabilidad y minimización de datos.

## 1) Reglas de uso
- Registrar cada sugerencia relevante mostrada al profesional en flujo clínico.
- No incluir PHI directa en texto libre; usar identificadores internos pseudonimizados.
- Mantener integridad temporal (timestamp UTC y zona local si aplica).
- Relacionar cada entrada con `request_id` o ID de evento técnico para auditoría.

## 2) Estructura mínima por registro

| Campo | Obligatorio | Descripción |
|---|---|---|
| `event_id` | Sí | ID único del evento de decisión |
| `timestamp_utc` | Sí | Fecha/hora UTC de presentación/decisión |
| `unit_id` | Sí | Unidad/servicio (código interno) |
| `role` | Sí | Rol del profesional (ej. nurse/supervisor) |
| `handover_id` | Sí | ID del handover asociado |
| `request_id` | Sí | ID técnico correlacionable en logs |
| `suggestion_type` | Sí | Tipo: NNN / NIC / NOC / resumen / otra |
| `suggestion_shown` | Sí | Texto/código mostrado (redactado si aplica) |
| `decision` | Sí | `accepted` / `rejected` / `modified` |
| `minimal_context` | Sí | Contexto mínimo no identificable |
| `reason_code` | No | Motivo estructurado (si se recoge) |
| `notes` | No | Comentario adicional (sin PHI) |

## 3) Formato recomendado (JSONL)
```json
{"event_id":"evt-0001","timestamp_utc":"2026-01-15T08:31:22Z","unit_id":"UCI-A","role":"nurse","handover_id":"h-abc123","request_id":"req-789","suggestion_type":"NNN","suggestion_shown":"NANDA: Riesgo de infección","decision":"accepted","minimal_context":"postoperatorio inmediato","reason_code":"CLINICAL_FIT","notes":""}
{"event_id":"evt-0002","timestamp_utc":"2026-01-15T08:33:05Z","unit_id":"UCI-A","role":"nurse","handover_id":"h-abc123","request_id":"req-790","suggestion_type":"NIC","suggestion_shown":"NIC: Vigilancia de signos vitales","decision":"modified","minimal_context":"ajuste por protocolo local","reason_code":"LOCAL_PROTOCOL","notes":"frecuencia adaptada"}
```

## 4) Controles de calidad del registro
- [ ] Unicidad de `event_id`.
- [ ] `timestamp_utc` válido y monotónico por sesión.
- [ ] `decision` dentro de catálogo permitido.
- [ ] `suggestion_shown` presente y trazable a la versión del modelo/regla.
- [ ] Ausencia de PHI y secretos en `notes`.

## 5) Retención y acceso
- Retención según política QMS/MDR y normativa local de protección de datos.
- Acceso restringido por RBAC (QA, regulatorio, seguridad, responsables clínicos designados).
- Cifrado en reposo y en tránsito; exportes con control de integridad.
