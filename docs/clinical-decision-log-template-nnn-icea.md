# Registro operativo de decisiones clinicas de IA (NNN + ICEA+)

> Estado real del repo: HANDOVER no persiste todavia un log dedicado de `accepted/rejected/modified` para sugerencias NNN o ICEA+. Este documento es una plantilla operativa para el piloto, anclada a IDs tecnicos que el repo si genera.

## 1) Que si existe hoy para correlacion

| Campo operativo | Fuente real en repo |
|---|---|
| `handover_id` | `HandoverBundleRecord.bundle_id` |
| `request_id` | `HandoverBundleRecord.request_id`, `AuditEvent.request_id`, `IceaBridgeRequest.request_id` |
| `bridge_request_id` | `IceaBridgeRequest.bridge_request_id` |
| `patient_id` | `HandoverBundleRecord.patient_id`, `IceaBridgeRequest.patient_id` |
| `unit_id` | `HandoverBundleRecord.unit_id`, `IceaBridgeRequest.unit_id`, `AuditEvent.meta.timing.unitId` |
| `timestamp_utc` | `AuditEvent.timestamp`, `IceaBridgeRequest.updated_at`, `IceaPipelineEvent.created_at` |
| `icea_summary` | `GET /api/icea/bridge/status/<handoverId>`, `GET /api/icea/patient-risk` |

## 2) Que no existe hoy

- No hay modelo backend dedicado a "decision clinica de sugerencia".
- La UI NNN no guarda automaticamente si una sugerencia NIC/NOC/NANDA fue aceptada, rechazada o modificada.
- ICEA+ expone estado y resumen, pero no una entidad de feedback clinico persistente en este repo.

Por tanto, para un piloto:

1. el registro debe mantenerse fuera de banda o en una exportacion controlada;
2. cada fila debe enlazarse a `request_id` y, si aplica, `bridge_request_id`;
3. no debe afirmarse que este log ya esta automatizado por HANDOVER.

## 3) Estructura minima recomendada

| Campo | Obligatorio | Como llenarlo hoy |
|---|---|---|
| `event_id` | Si | UUID del registro operativo |
| `timestamp_utc` | Si | Hora del registro o de la accion observada |
| `handover_id` | Si | `bundle_id` persistido en HANDOVER |
| `request_id` | Si | `request_id` del handover |
| `bridge_request_id` | No | Solo para eventos ICEA+ |
| `patient_id` | Si | ID pseudonimizado o ID interno permitido |
| `unit_id` | Si | Unidad del turno |
| `role` | Si | `nurse`, `supervisor`, `admin` o equivalente local |
| `suggestion_source` | Si | `nanda`, `nic`, `noc`, `icea_patient_risk`, `icea_bridge_summary` |
| `suggestion_reference` | Si | Codigo mostrado, texto resumido o `bridge_request_id` |
| `decision` | Si | `accepted`, `rejected`, `modified`, `viewed_only` |
| `minimal_context` | Si | Contexto breve sin PHI directa |
| `reason_code` | No | Motivo estructurado local |
| `notes` | No | Solo si no contiene PHI |

## 4) Catalogos recomendados

### `decision`

- `accepted`
- `rejected`
- `modified`
- `viewed_only`

### `reason_code`

- `CLINICAL_FIT`
- `LOCAL_PROTOCOL`
- `INSUFFICIENT_EVIDENCE`
- `LICENSING_LIMIT`
- `UI_FALLBACK`
- `OTHER_STRUCTURED`

## 5) Formato recomendado (JSONL)

```json
{"event_id":"8b6a7f5d-92c3-4f3f-a8b0-1d95c6a8a101","timestamp_utc":"2026-03-09T08:31:22Z","handover_id":"bundle-bridge-001","request_id":"req-bridge-001","bridge_request_id":"req-bridge-001:immediate_provisional","patient_id":"pat-risk-001","unit_id":"icu-a","role":"nurse","suggestion_source":"icea_patient_risk","suggestion_reference":"req-bridge-001:immediate_provisional","decision":"viewed_only","minimal_context":"cierre de turno UCI","reason_code":"INSUFFICIENT_EVIDENCE","notes":""}
{"event_id":"c2e6e87a-fb6a-4c3c-8df4-9db6de315d30","timestamp_utc":"2026-03-09T08:33:05Z","handover_id":"bundle-bridge-001","request_id":"req-bridge-001","patient_id":"pat-risk-001","unit_id":"icu-a","role":"nurse","suggestion_source":"nic","suggestion_reference":"NIC 2210","decision":"modified","minimal_context":"ajuste segun protocolo local","reason_code":"LOCAL_PROTOCOL","notes":"frecuencia adaptada sin cambiar el objetivo clinico"}
```

## 6) Controles de calidad

- [ ] `event_id` unico.
- [ ] `request_id` existente en HANDOVER.
- [ ] `bridge_request_id` presente solo cuando la entrada se refiere a ICEA+.
- [ ] `decision` dentro del catalogo permitido.
- [ ] `suggestion_reference` suficiente para volver a la evidencia tecnica.
- [ ] `notes` sin PHI directa, secretos ni payload clinico crudo.

## 7) Evidencia minima a archivar junto al log

- export o captura del `handover_id`/`request_id` correspondiente;
- si aplica, respuesta de `/api/icea/bridge/status/<handoverId>` o `/api/icea/patient-risk`;
- version del catalogo NNN activo (`licensed`, `version`, `source`);
- referencia a release/commit del piloto.

## 8) Riesgo residual

Hasta que exista una implementacion dedicada de feedback clinico en HANDOVER, este registro sigue siendo una evidencia operativa complementaria y no una auditoria automatica end-to-end.
