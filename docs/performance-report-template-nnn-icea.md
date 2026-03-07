# Plantilla de informe de rendimiento por unidad (NNN + ICEA+)

> Objetivo: comparar desempeño operacional **baseline vs post** sin inferir resultados clínicos no medidos.

## 1) Metadatos del informe
- Unidad/servicio:
- Centro/hospital:
- Ventana baseline (fecha/hora):
- Ventana post (fecha/hora):
- Versión app/backend evaluada:
- IA: ON / OFF / Mixto (detallar):
- Responsable de extracción de datos:
- Responsable de análisis QA:
- Aprobación clínica:

## 2) Definiciones operativas
- **Time-to-complete:** tiempo entre apertura de handover e intento de cierre exitoso.
- **Abandono:** handover iniciado sin cierre dentro de ventana definida por operación.
- **Error:** intento que termina con fallo técnico o validación bloqueante.
- **Segmentación mínima:** por unidad/servicio y turno (si aplica).

## 3) Tabla comparativa principal

| Métrica | Baseline | Post | Delta absoluto | Delta % | Interpretación |
|---|---:|---:|---:|---:|---|
| Mediana time-to-complete (min) |  |  |  |  |  |
| P90 time-to-complete (min) |  |  |  |  |  |
| Tasa de abandono (%) |  |  |  |  |  |
| Tasa de error (%) |  |  |  |  |  |
| Casos con IA habilitada (%) |  |  |  |  |  |
| Casos sin IA (%) |  |  |  |  |  |

## 4) Desglose IA ON vs IA OFF

| Segmento | n | Mediana (min) | P90 (min) | Abandono (%) | Error (%) | Observaciones |
|---|---:|---:|---:|---:|---:|---|
| IA ON |  |  |  |  |  |  |
| IA OFF |  |  |  |  |  |  |

## 5) Criterio de aceptación
- [ ] No incremento clínicamente relevante del tiempo de registro.
- [ ] Si hay incremento: beneficio compensatorio documentado y aprobado (especificar).
- [ ] Sin aumento no controlado de abandono/error.

## 6) Hallazgos y riesgos
- Hallazgo 1:
- Hallazgo 2:
- Riesgo residual:
- Acción correctiva/preventiva (CAPA):

## 7) Evidencias anexas
- Export de métricas:
- Reportes de tests de rendimiento/flujo:
- Acta de revisión clínica/QA:
- Referencias a matriz de trazabilidad:

## 8) Decisión
- Estado: Aprobado / Aprobado con acciones / No aprobado
- Fecha:
- Firma QA:
- Firma líder clínico:
- Firma regulatorio/QMS:
