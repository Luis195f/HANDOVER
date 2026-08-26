# Demo de Salud Mental: relevo por excepciones

Estado revisado el 2026-08-26.

## Alcance

La demo usa el Core existente y el perfil común `behavioral-health`. Adultos, infanto-adolescencia y psicogeriatría no tienen formularios paralelos. La superficie compacta de unidad vive en `PatientList` y mantiene `HandoverForm` como detalle clínico completo.

El comportamiento es una demostración sintética controlada. No implementa conexión con una HCE, no descubre endpoints, permisos ni perfiles FHIR, y no constituye validación clínica del clasificador.

## Baseline gobernado

El escenario sano conserva el orden y la distribución previos de 40 identidades sintéticas:

- A: 2 pacientes (`demo-psych-adult-001`, `demo-psych-udcc-001`).
- B: 6 pacientes (`demo-psych-child-001`, `demo-psych-unit-005` a `demo-psych-unit-009`).
- C: 32 pacientes (`demo-psych-adult-002`, `demo-psych-unit-010` a `demo-psych-unit-040`).

El golden test fija IDs, motivos y orden. Con fuentes completas y vigentes, A/B no cambian. Solo pacientes del baseline C pueden dividirse entre C y R por insuficiencia o vencimiento de información esperada.

## Modelo de estado

El seam separa:

- `ClinicalStatus`: `stable | watcher | unstable`.
- `HandoffLane`: `A | B | C | R`.
- `SourceStatus`: `current | stale | missing | unavailable`.
- `UnitDataHealth`: `healthy | degraded | unavailable`.

Cada clasificación registra carril, estado clínico, motivos clínicos visibles, fecha, origen `rule | human`, estados de fuente, timestamp relevante más antiguo, override vigente y override previo cuando corresponda.

## Semántica A/B/C/R

- A representa prioridad inmediata y exige check-back o escalado explícito.
- B representa novedad, pendiente o acción relevante para el turno.
- C significa “sin novedades confirmadas con datos esperados vigentes”.
- R significa revisión requerida por información que sí se esperaba y está ausente, vencida, incoherente o no verificable.

La expectativa no se deriva de “falta cualquier dato”. Para `behavioral-health` se resuelve desde nivel de observación, riesgo activo y plan vigente:

- valoración directa y plan vigente son fuentes base;
- registro de observación se exige con observación reforzada/constante o riesgo activo;
- administración de medicación se exige cuando el plan requiere verificarla;
- incidencias/retornos se exige cuando existe permiso o retorno que revisar.

Las razones de usuario están en lenguaje clínico. No se muestran claves técnicas de fuentes o reglas.

## Frescura y umbrales demo

La configuración versionada vive en `src/config/profiles/exceptionHandover.ts`:

| Fuente | Vigencia demo |
| --- | ---: |
| Valoración directa | 240 min |
| Registro de observación | 120 min |
| Administración de medicación | 480 min |
| Plan vigente | 720 min |
| Incidencias y retornos | 480 min |

Los warnings `ratioRWarning = 0.20`, `absoluteRWarning = 8`, `maxRAgeMinutes = 120` y `checkBackBypassWarningRatio = 0.10` están etiquetados como provisionales de demo. No son umbrales clínicamente validados y pueden cambiarse sin modificar el clasificador.

## Salud de integración

### Saludable

Se clasifican pacientes A/B/C/R normalmente.

### Degradación parcial

Se muestra un único banner de unidad. Solo un baseline C dependiente de la fuente afectada pasa a R. A/B no se degradan a C. R se puede revisar individualmente o reconocer colectivamente por causa, sin fabricar notas individuales.

La unidad también se considera degradada por fallo de fuente crítica o por reglas configurables de volumen/antigüedad R. Tras una degradación, no vuelve a `healthy` hasta que exista confirmación de recuperación y una ventana estable de 15 minutos.

### Indisponibilidad total

Se suspende la clasificación automática y se muestra un único banner persistente:

> Clasificación automática suspendida: fuente clínica no disponible

No se generan 40 a 80 tarjetas R. La última clasificación se presenta solo como no vigente con fecha/hora. La confirmación colectiva C desaparece. El flujo degradado registra manualmente pacientes prioritarios, novedades, pendientes críticos, responsable receptor y hora, además del reconocimiento de la incidencia a nivel de unidad.

El flujo no afirma que los pacientes o los valores clínicos hayan sido validados.

## Gobierno R y cierre

Cada R muestra motivo, fuente, antigüedad, responsable, estado y tiempo acumulado. Las métricas visibles son `countR`, `ratioR`, `oldestRAge`, `affectedSources`, `meanTimeInR`, `resolvedR` y `transferredUnresolvedR`.

R nunca cuenta como C. Para cerrar, R debe resolverse/reclasificarse o transferirse como información incompleta con motivo, momento objetivo y reconocimiento del receptor. El reconocimiento colectivo de una causa técnica no resuelve a los pacientes afectados.

El copy de responsabilidad es:

> Revisión colectiva del resumen de unidad. No constituye validación individual de valores clínicos ni genera evoluciones individuales. La responsabilidad asistencial del turno se transfiere al equipo receptor.

En modo degradado se añade:

> Clasificación automática suspendida. El relevo se realiza con información parcial y con las excepciones registradas manualmente.

## Check-back y overrides

Para A, el estado es `pending-acknowledgement` hasta que la profesional entrante confirma entre uno y tres puntos críticos. Un check-back válido produce `completed`; un escalado explícito produce `escalated`. La ruta demo no implementa bypass ordinario ni institucional.

Las métricas son `requiredCheckBacks`, `completedCheckBacks`, `pendingCheckBacks`, `bypassCount`, `bypassRate` y `clarificationCount`.

Un override exige clasificación anterior/nueva, motivo clínico, profesional, turno, fecha y fuentes disponibles. Se conserva el registro con clave idempotente. En el siguiente turno se recalcula la regla y el override anterior aparece solo como antecedente.

## SBAR

A y B muestran un `Borrador determinista` preliminar. El relevo breve editable se persiste por separado y no se sobrescribe al renderizar de nuevo. A requiere check-back; B requiere validación humana del borrador.

C no genera SBAR individual. R muestra solo insuficiencia y acciones. En indisponibilidad total no se presenta un SBAR anterior como vigente.

## Persistencia y offline

Los eventos demo, overrides, contadores, borradores breves y transferencia degradada usan el adaptador cifrado local ya existente. Las escrituras fusionan claves idempotentes para que reintentos y reanudaciones no dupliquen check-back, overrides ni transferencias.

Estos eventos no se introducen en la queue FHIR y no se envían a una HCE. La limpieza segura de sesión elimina también este store. No se afirma persistencia web después de cerrar pestaña; depende del adaptador disponible y no cambia la limitación de la queue web actual.

## Contrato interno y FHIR

El mapper FHIR productivo no se modificó. La capacidad futura se documenta así:

| Contrato interno | Correspondencia futura | Estado real |
| --- | --- | --- |
| `HandoffCommunication` | `Communication` | `pending` |
| `HandoffProvenance` | `Provenance` | `pending` |
| `HandoffAudit` | `AuditEvent` | `pending` |
| `HandoffTask` | `Task` | `pending` |
| `HandoffSummary` | `Composition` | Solo formulario Core existente |
| Valoración realizada | `Observation` | Solo datos realmente documentados en Core |

La ruta compacta no emite recursos FHIR. En particular, C y R no producen `Composition`, `Observation`, evolución, firma ni atestación individual. El detalle completo conserva el pipeline existente `UI -> Zod -> FHIR -> queue/sync -> fhir-client`.

## Presupuesto de interacciones

Guardrails demo configurables:

- C colectivo: máximo 2.
- B: máximo 4 por paciente.
- A: máximo 8 por paciente.
- R: máximo 4 por paciente.
- Modo degradado: máximo 3, sin contar escritura manual de excepciones.

Cuenta una interacción relevante cada apertura de paciente, confirmación, toggle de punto crítico, resolución, escalado, override, transferencia o reconocimiento que cambie el estado del relevo. No cuentan render, carga automática, scroll ni navegación no relacionada.

## Veredicto de alcance

- GO: demo sintética controlada.
- NO GO: integración HCE o piloto clínico. Faltan contratos institucionales, terminología/perfiles validados, permisos, backend/auditoría operativa y validación clínica prospectiva.
