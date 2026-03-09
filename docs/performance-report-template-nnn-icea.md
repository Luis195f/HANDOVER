# Informe de rendimiento piloto NNN + ICEA+ (baseline vs post)

> Estado real del repo: HANDOVER aporta instrumentacion de timing por seccion y actividad operativa por unidad. No calcula por si solo mediana/P90 de handover completo ni tasa de abandono total.

## 1) Metadatos

- Unidad/servicio:
- Centro/hospital:
- Ventana baseline:
- Ventana post:
- Version app/backend:
- Flags activas:
  - `SHOW_HANDOVER_TIMING_METRICS`
  - `ENABLE_ICEA_BRIDGE`
  - `ENABLE_ICEA_PATIENT_RISK`
  - `ENABLE_ICEA_CAUSAL_SUMMARY`
- Catalogo NNN desplegado:
  - placeholder / licenciado
  - version
  - fuente
- Responsable de extraccion:
- Responsable QA:
- Aprobacion clinica:

## 2) Que metricas salen del repo y cuales no

| Metrica | Fuente en repo | Estado |
|---|---|---|
| Tiempo medio por seccion (`sbar`, `vitals`, `diagnostics`, `treatments`) | `POST/GET /api/metrics/handover-time`, `GET /api/icea/dashboard-summary` | Disponible |
| Muestras por unidad y seccion | `GET /api/metrics/handover-time` | Disponible |
| Actividad operativa (`accepted`, `retry`, `failed`, outbox, bridge`) | `GET /api/icea/dashboard-summary` | Disponible |
| Mediana handover completo | Requiere extraccion externa o BI | No automatizado en repo |
| P90 handover completo | Requiere extraccion externa o BI | No automatizado en repo |
| Tasa de abandono | Requiere definicion operativa y dataset externo | No automatizado en repo |
| Error rate total de handover | Parcialmente inferible de outbox/bridge, no del flujo completo | Parcial |

## 3) Evidencia tecnica disponible para el analisis

- Frontend: `src/hooks/useHandoverTiming.ts`
- Backend: `backend/api/views.py::HandoverTimingMetricsView`
- Dashboard admin: `backend/api/dashboard_summary.py`
- Tests:
  - `backend/api/tests/test_handover_timing_metrics.py`
  - `backend/api/tests/test_icea_dashboard_summary.py`

## 4) Tabla principal

| Metrica | Baseline | Post | Fuente | Interpretacion |
|---|---:|---:|---|---|
| `sbar.avgDurationMs` |  |  | `/api/metrics/handover-time` |  |
| `vitals.avgDurationMs` |  |  | `/api/metrics/handover-time` |  |
| `diagnostics.avgDurationMs` |  |  | `/api/metrics/handover-time` |  |
| `treatments.avgDurationMs` |  |  | `/api/metrics/handover-time` |  |
| Handovers aceptados por unidad |  |  | `/api/icea/dashboard-summary` |  |
| Casos con `retry/failed` en outbox ICEA |  |  | `/api/icea/dashboard-summary` |  |
| Casos con `failed/stale/insufficientEvidence` en bridge |  |  | `/api/icea/dashboard-summary` |  |
| Mediana handover completo |  |  | fuente externa | Requerido para Go/No-Go, no sale directo del repo |
| P90 handover completo |  |  | fuente externa | Requerido para Go/No-Go, no sale directo del repo |
| Tasa de abandono |  |  | fuente externa | Requiere definicion operativa local |

## 5) Segmentacion minima del piloto

- Por unidad/servicio.
- Por turno si el centro distingue `Mañana/Tarde/Noche`.
- IA/ICEA habilitada vs deshabilitada.
- Placeholder NNN vs catalogo licenciado, si el piloto mezcla ambos modos.

## 6) Hallazgos y riesgos

- Hallazgo 1:
- Hallazgo 2:
- Riesgo residual:
- CAPA:

## 7) Criterio Go/No-Go propuesto

- [ ] No aumento no controlado de errores tecnicos visibles (`outbox.failed`, `bridge.failed`, `bridge.stale`).
- [ ] No empeoramiento operativo relevante en las secciones instrumentadas.
- [ ] Mediana/P90 de handover completo analizados con fuente externa.
- [ ] Cualquier empeoramiento queda compensado por beneficio clinico documentado y aprobado.

## 8) Limitacion que debe quedar explicita en el informe

Este informe no debe presentar las metricas por seccion del repo como sustituto automatico de:

- tiempo total de handover,
- abandono,
- carga cognitiva,
- beneficio clinico.

Esas dimensiones requieren medicion operativa adicional fuera del codigo actual.
