# Clinical Profiles Framework - HANDOVER / ICEA+

## Estado de este documento
Este archivo es el **system of record clinico-arquitectonico** para la expansion multiunidad y multiespecialidad de HANDOVER con proyeccion hacia ICEA+.

- `AGENTS.md` define **como debe trabajar Codex**.
- Este documento define **que arquitectura clinica debe construir, respetar y no romper**.

Toda implementacion multiunidad, multiespecialidad, MPAC o integracion con ICEA+ debe ser consistente con este archivo.

---

# 1. Proposito

Formalizar una arquitectura mantenible para que HANDOVER evolucione desde un relevo estructurado universal hacia un ecosistema clinico capaz de:

1. registrar un relevo enfermero comun,
2. adaptarse por unidad sin crear formularios paralelos,
3. anadir overlays de especialidad sin fragmentar la experiencia,
4. priorizar y anticipar con logica enfermera contextual,
5. exportar variables comparables y ajustables para ICEA+.

---

# 2. Tesis central

No se deben crear multiples HANDOVER independientes por servicio.

La via correcta es:

- **HANDOVER Core** universal,
- ampliado mediante **Unit Profile Packs (UPP)**,
- afinado mediante **Specialty Overlay Packs (SOP)**,
- interpretado por un **Motor de Priorizacion y Anticipacion Contextual (MPAC)**,
- y proyectado analiticamente en una **ICEA+ Layer** ajustada por case-mix.

---

# 3. Objetivos de diseno

## 3.1. Objetivos
- Mantener un unico relevo estructurado para toda la enfermeria.
- Adaptar visibilidad, riesgos, prioridades y salidas por contexto clinico real.
- Minimizar carga documental adicional.
- Hacer computable el juicio clinico enfermero sin burocratizarlo.
- Preparar una base valida para analitica descriptiva, ajuste por complejidad y atribucion futura en ICEA+.

## 3.2. No objetivos
- No crear una app distinta por unidad.
- No construir una IA opaca desde el inicio.
- No usar ICEA+ para benchmarking punitivo o individual prematuro.
- No reemplazar juicio clinico por scoring automatico incuestionable.
- No exigir doble registro cuando exista dato fuente en HCE/FHIR.

---

# 4. Principios rectores

## 4.1. Nucleo comun irrenunciable
Todo servicio comparte una estructura minima de relevo para asegurar continuidad, interoperabilidad y comparabilidad.

## 4.2. Especializacion minima suficiente
Cada perfil anade solo lo que cambia la decision enfermera del turno. Lo redundante debe ocultarse o inferirse.

## 4.3. Prioridad explicable
Toda salida contextual debe explicar por que prioriza:
- dato fuente,
- cambio clinico,
- pendiente critico,
- evento a anticipar,
- contexto unidad/especialidad.

## 4.4. Cero doble registro
Si un dato ya existe en HCE, FHIR, catalogo o contexto del turno, no volver a pedirlo salvo justificacion clinica fuerte.

## 4.5. Humano en el circuito
Toda sugerencia puede ser:
- aceptada,
- ajustada,
- rechazada,
- por la enfermera responsable.

## 4.6. Gobernanza no punitiva
La analitica debe servir para seguridad, mejora, continuidad y gestion responsable; no para castigo automatico.

## 4.7. Ajuste por case-mix
No comparar unidades, turnos o equipos por volumen bruto de actividad. Toda comparacion relevante debe ajustarse por complejidad basal y contexto asistencial.

---

# 5. Arquitectura formal

## 5.1. Vista general

```text
HANDOVER Core
   ->
Unit Profile Packs (UPP)
   ->
Specialty Overlay Packs (SOP)
   ->
MPAC (priorizacion y anticipacion contextual)
   ->
FHIR / repositorio clinico / capa analitica
   ->
ICEA+ Layer
```

## 5.2. Sentido funcional

El Core registra.

Los UPP contextualizan por unidad.

Los SOP afinan por especialidad.

MPAC interpreta, prioriza y anticipa.

ICEA+ mide complejidad, carga, continuidad y valor ajustados.

---

# 6. HANDOVER Core

El Core es universal. No debe fragmentarse por servicio.

## 6.1. Dominios minimos obligatorios

### A. Contexto del turno
- unidad
- fecha/hora
- profesional saliente/entrante
- censo o carga de pacientes
- incidencias del servicio
- observaciones operativas del turno

### B. Identidad clinica
- paciente
- cama/ubicacion
- encounter/episodio
- diagnostico o problema principal
- alergias
- alertas de identificacion

### C. SBAR clinico
- Situation
- Background
- Assessment
- Recommendation

### D. Estado actual
- signos vitales
- consciencia
- dolor
- oxigenoterapia
- escalas transversales
- cambios recientes

### E. Tratamientos y dispositivos
- medicacion relevante
- fluidos
- perfusiones
- soporte respiratorio
- cateteres
- drenajes
- bombas
- accesos
- dispositivos de seguridad

### F. Riesgos y pendientes
- caidas
- UPP
- infeccion
- tareas criticas
- reevaluaciones
- estudios pendientes
- procedimientos pendientes
- alertas de omision

### G. Plan y contingencias
- que hacer primero
- que vigilar
- a quien avisar
- criterios de escalado
- plan inmediato del turno

## 6.2. Regla del Core

Toda unidad debe poder operar con este minimo comun incluso antes de activar su perfil especifico.

## 6.3. Contrato del diagnostico medico principal

- `dxMedical` es el diagnostico medico principal canonico y conserva `system`, `code` y `display` SNOMED CT.
- `dxMedicalStructured` contiene diagnosticos adicionales y no debe duplicar el SNOMED principal.
- La seleccion, sustitucion o eliminacion del SNOMED principal en la UI debe actualizar `dxMedical` de forma atomica.
- El prefill, la validacion, el submit, la persistencia y el mapping FHIR consumen el mismo valor canonico.

---

# 7. Unit Profile Packs (UPP)

## 7.1. Definicion

Un UPP es una extension configurable por unidad clinica.

No es un formulario independiente. Es una capa de configuracion clinica sobre el Core.

## 7.2. Cada UPP debe definir

- `id`
- `label`
- `base_unit_type`
- `enabled_sections`
- `hidden_sections`
- `required_extra_fields`
- `optional_extra_fields`
- `scales`
- `sentinel_events`
- `visibility_rules`
- `priority_rules`
- `anticipation_rules`
- `handover_summary_rules`
- `icea_vector_mapping`

## 7.3. Estructura conceptual sugerida

```ts
type UnitProfilePack = {
  id: string
  label: string
  baseUnitType: string
  enabledSections: string[]
  hiddenSections?: string[]
  requiredExtraFields?: string[]
  optionalExtraFields?: string[]
  scales?: string[]
  sentinelEvents?: string[]
  visibilityRules?: string[]
  priorityRules?: string[]
  anticipationRules?: string[]
  summaryRules?: string[]
  iceaVectorMapping?: string[]
}
```

---

# 8. Matriz maestra de UPP

## 8.1. Urgencias / Emergencias

Contexto: triage, boxes, observacion, sala de espera.
Juicio critico enfermero dominante: tiempo-dependencia, reevaluacion, dolor, riesgo de empeorar durante la espera, flujo saturado.
Variables extra minimas: triage, hora de llegada, reevaluacion obligatoria, aislamiento, motivo sindromico, destino probable.
Escalas sugeridas: Manchester/ESI local, NEWS2, dolor.
Eventos a anticipar: cambio de prioridad, sepsis, IAM, ictus, deterioro respiratorio, paciente aparentemente estable que descompensa.
Salida visible esperada: top pacientes a reevaluar, pendientes temporales, alerta de cambio de prioridad, necesidad de escalado.
Vector ICEA+ dominante: carga temporal critica, vigilancia dinamica, riesgo de omision en espera.

## 8.2. Hospitalizacion general

Contexto: Medicina Interna, Cirugia, Pediatria, Ginecologia, plantas mixtas.
Juicio critico enfermero dominante: fragilidad, dependencia, polifarmacia, delirium, continuidad, carga educativa.
Variables extra minimas: ABVD/dependencia, conciliacion terapeutica, riesgo de caidas/UPP, plan de alta, soporte familiar.
Escalas sugeridas: NEWS2, Braden, dolor, delirium local.
Eventos a anticipar: descompensacion insidiosa, caida, UPP, error de continuidad, fallo en educacion al alta.
Salida visible esperada: pacientes con mayor riesgo de omision, tareas no delegables, alta compleja, vigilancia reforzada.
Vector ICEA+ dominante: continuidad, dependencia, carga educativa, prevencion.

## 8.3. UCI adulto

Contexto: criticos adultos generales.
Juicio critico enfermero dominante: inestabilidad minuto a minuto, ventilacion, sedacion, perfusion, soporte vasoactivo, microvigilancia.
Variables extra minimas: VM, drogas vasoactivas, balance, dispositivos invasivos, metas hemodinamicas, aislamiento.
Escalas sugeridas: RASS, Glasgow, CAM-ICU, APACHE/SAPS cuando exista fuente.
Eventos a anticipar: shock, extubacion accidental, delirium, disfuncion de dispositivos, deterioro neurologico.
Salida visible esperada: prioridad por cama, checklist de vigilancia critica, reevaluacion abreviada, criterios de escalado.
Vector ICEA+ dominante: vigilancia intensiva, complejidad fisiologica, criticidad temporal.

## 8.4. UCI neonatal / pediatrica

Contexto: UCIN, UCIP.
Juicio critico enfermero dominante: variabilidad fisiologica por edad/peso, respiracion, termorregulacion, dosificacion por kg, rol familiar.
Variables extra minimas: edad/edad gestacional, peso, soporte respiratorio, alimentacion, cateteres, participacion de cuidadores.
Escalas sugeridas: PEWS/NPEWS local, dolor pediatrico, escalas neonatales.
Eventos a anticipar: deshidratacion, apnea, deterioro respiratorio, error de dosificacion, fallo de soporte familiar.
Salida visible esperada: pacientes mas inestables por edad, alertas de dosificacion, necesidades de apoyo parental.
Vector ICEA+ dominante: vigilancia fina, seguridad farmacologica, carga familiar.

## 8.5. UCI especializada

Contexto: cardiovascular, neuro-UCI, quemados.
Juicio critico enfermero dominante: vigilancia altamente especifica segun soporte y dano organico predominante.
Variables extra minimas: VAD/marcapasos, drenajes ventriculares, superficie quemada, neurovigilancia, fluidos complejos.
Escalas sugeridas: hemodinamicas o neuro locales, balance, dolor.
Eventos a anticipar: arritmias, hipertension intracraneal, sepsis por quemaduras, fallo de injerto/dispositivo.
Salida visible esperada: foco por soporte critico dominante, eventos centinela por subunidad, prioridades de vigilancia.
Vector ICEA+ dominante: soporte complejo, riesgo critico especifico, vigilancia especializada.

## 8.6. Materno-perinatal

Contexto: alto riesgo obstetrico, puerperio, neonatologia integrada.
Juicio critico enfermero dominante: binomio madre-hijo, hemorragia, hipertension, lactancia, adaptacion neonatal, educacion.
Variables extra minimas: edad gestacional, sangrado, TA materna, analgesia, lactancia, riesgos neonatales, apoyo familiar.
Escalas sugeridas: MEOWS u obstetrica local, dolor, neonatal local.
Eventos a anticipar: hemorragia posparto, eclampsia, infeccion, depresion respiratoria, deterioro neonatal.
Salida visible esperada: pacientes binomiales prioritarios, vigilancia obstetrica, educacion critica antes del alta.
Vector ICEA+ dominante: doble foco asistencial, educacion, seguridad materno-neonatal.

## 8.7. Quirofano / Recuperacion

Contexto: pabellon, URPA, cirugia minimamente invasiva o alta complejidad.
Juicio critico enfermero dominante: seguridad perioperatoria, dolor, sangrado, via aerea, drenajes, recuperacion funcional temprana.
Variables extra minimas: procedimiento, tiempo postoperatorio, drenajes, herida, perfusion distal, analgesia, profilaxis.
Escalas sugeridas: Aldrete o recuperacion local, dolor.
Eventos a anticipar: hemorragia, broncoaspiracion, retencion urinaria, ileo, dolor mal controlado.
Salida visible esperada: pendientes postoperatorios criticos, control de drenajes, criterios de alta/traslado.
Vector ICEA+ dominante: criticidad postoperatoria, control de eventos, seguridad de transicion.

## 8.8. Consulta externa / ambulatoria

Contexto: hospital de dia, seguimiento cronico, curaciones, controles.
Juicio critico enfermero dominante: adherencia, educacion, seguridad del tratamiento, capacidad de autocuidado.
Variables extra minimas: motivo de consulta, tratamiento reciente, accesos venosos, eventos desde ultima visita, soporte familiar.
Escalas sugeridas: dolor, escalas especificas por programa.
Eventos a anticipar: reaccion adversa, deshidratacion, baja adherencia, progresion sintomatica.
Salida visible esperada: pacientes que requieren intervencion hoy, educacion pendiente, contingencias domiciliarias.
Vector ICEA+ dominante: prevencion, educacion, adherencia, continuidad longitudinal.

## 8.9. Rehabilitacion / Terapias

Contexto: kinesioterapia, terapia ocupacional, rehabilitacion funcional.
Juicio critico enfermero dominante: evolucion funcional, tolerancia al esfuerzo, dolor, riesgo de caida, metas de autonomia.
Variables extra minimas: movilidad basal, ayudas tecnicas, tolerancia, dolor, metas diarias, barreras del entorno.
Escalas sugeridas: Barthel o funcional local, dolor, riesgo de caida.
Eventos a anticipar: caidas, intolerancia al esfuerzo, dolor refractario, perdida de progreso funcional.
Salida visible esperada: pacientes que no pueden perder sesion critica, alertas de seguridad en movilizacion.
Vector ICEA+ dominante: recuperacion funcional, seguridad, continuidad de metas.

## 8.10. Residencias / larga estadia

Contexto: geriatria residencial, cuidados prolongados.
Juicio critico enfermero dominante: fragilidad extrema, deterioro cognitivo, cronicidad, piel, nutricion, continuidad longitudinal.
Variables extra minimas: fragilidad, cognicion, patron conductual, nutricion, continencia, red familiar, polifarmacia.
Escalas sugeridas: Braden, Barthel, dolor, delirium/demencia local.
Eventos a anticipar: deshidratacion, delirium, infeccion, caida, deterioro cutaneo, abandono de plan.
Salida visible esperada: residentes de alto riesgo, cambios respecto a basal, necesidades familiares y de continuidad.
Vector ICEA+ dominante: carga cronica, prevencion, continuidad, dependencia.

## 8.11. Salud mental

Contexto: psiquiatria aguda o prolongada.
Juicio critico enfermero dominante: riesgo conductual, adherencia, agitacion, contencion minima necesaria, alianza terapeutica.
Variables extra minimas: riesgo auto/heteroagresivo, adherencia, sueno, consumo, contenciones, observacion especial.
Escalas sugeridas: escalas conductuales locales, sueno, riesgo suicida institucional.
Eventos a anticipar: agitacion, fuga, autoagresion, abstinencia, rechazo terapeutico.
Salida visible esperada: pacientes con observacion intensiva, cambio conductual, necesidades de seguridad relacional.
Vector ICEA+ dominante: vigilancia conductual, relacion terapeutica, seguridad.

## 8.12. Atencion domiciliaria

Contexto: visita domiciliaria, programas cronicos y paliativos.
Juicio critico enfermero dominante: entorno, cuidadores, adherencia real, riesgo social, capacidad de respuesta fuera del hospital.
Variables extra minimas: condiciones del hogar, cuidador principal, insumos, acceso a medicacion, signos de alarma, teleapoyo.
Escalas sugeridas: dolor, funcionalidad, paliativos si aplica.
Eventos a anticipar: descompensacion no detectada, abandono, error de administracion, barreras de acceso.
Salida visible esperada: casos con mayor riesgo de rehospitalizacion, educacion prioritaria, contingencia domiciliaria.
Vector ICEA+ dominante: continuidad extrahospitalaria, autocuidado, soporte social.

## 8.13. Observacion / Resucitacion

Contexto: observacion prolongada, sala de reanimacion, soporte inmediato.
Juicio critico enfermero dominante: ABCDE real, reevaluacion en ventana corta, perfusion, via aerea, respuesta a maniobras inmediatas.
Variables extra minimas: soporte avanzado, ventana critica de reevaluacion, hemoderivados/vasopresores, estado postevento, vigilancia neurologica.
Escalas sugeridas: Glasgow, dolor, escalas de reanimacion locales.
Eventos a anticipar: re-parada, perdida de via aerea, inestabilidad refractaria, deterioro subito.
Salida visible esperada: pacientes de reevaluacion inmediata, criterios de aviso urgente, vigilancia concentrada.
Vector ICEA+ dominante: criticidad extrema, velocidad de intervencion, vigilancia intensiva.

---

# 9. Specialty Overlay Packs (SOP)

## 9.1. Definicion

Los overlays de especialidad no crean un formulario completo nuevo.

Ajustan:
- foco clinico,
- variables extra,
- riesgos,
- dispositivos,
- escalas,
- reglas MPAC,
- vector ICEA+ esperado.

## 9.2. Estructura conceptual sugerida

```ts
type SpecialtyOverlayPack = {
  id: string
  label: string
  allowedBaseUnits: string[]
  extraFields?: string[]
  extraScales?: string[]
  extraSentinelEvents?: string[]
  priorityModifiers?: string[]
  anticipationModifiers?: string[]
  summaryModifiers?: string[]
  iceaModifiers?: string[]
}
```

---

# 10. Matriz maestra de SOP

## 10.1. Cardiologia / Cirugia cardiovascular

Cruce tipico: UCI cardio, hospitalizacion, recuperacion, hemodinamia.
Foco dominante: perfusion, arritmias, dolor isquemico, marcapasos/dispositivos, balance fino.
Variables extra minimas: soporte hemodinamico, dispositivos, dolor toracico, anticoagulacion, perfusion periferica.
Escalas sugeridas: NEWS2 + hemodinamica local, dolor.
Eventos a anticipar: arritmias, isquemia, taponamiento, sangrado, fallo de dispositivo.
Regla de overlay: elevar peso de perfusion, dispositivo critico y cambio hemodinamico.
Vector ICEA+: vigilancia intensiva cardiovascular.

## 10.2. Neurologia / Neurocirugia

Cruce tipico: stroke unit, neuro-UCI, planta neuro.
Foco dominante: cambios neurologicos sutiles, conciencia, deficit focal, PIC, seguridad deglutoria.
Variables extra minimas: Glasgow, pupilas, deficit focal, drenajes ventriculares, riesgo broncoaspiracion.
Escalas sugeridas: Glasgow, NIHSS u otras locales.
Eventos a anticipar: convulsion, herniacion, broncoaspiracion, deterioro subito.
Regla de overlay: cualquier cambio neurologico nuevo sube prioridad de forma importante.
Vector ICEA+: peso alto de vigilancia neurologica.

## 10.3. Oncologia / Hematologia (EOPROP-IA)

Cruce tipico: hospitalizacion, hospital de dia, urgencias oncologicas, paliativos.
Foco dominante: toxicidad, neutropenia, dolor, mucositis, extravasacion, sufrimiento, soporte anticipatorio.
Variables extra minimas: fase terapeutica, inmunosupresion, CVC, sintomas toxicos, transfusiones, paliacion.
Escalas sugeridas: NEWS2, dolor, escalas sintomaticas locales.
Eventos a anticipar: neutropenia febril, sepsis, extravasacion, dolor no controlado, deshidratacion.
Regla de overlay: priorizacion oncologica dinamica con enfasis en deterioro infeccioso y carga sintomatica.
Vector ICEA+: complejidad dinamica, vigilancia anticipatoria, carga de soporte.

## 10.4. Traumatologia / Ortopedia

Cruce tipico: planta quirurgica, policlinico, rehabilitacion.
Foco dominante: dolor, movilidad, perfusion distal, tromboprofilaxis, seguridad en movilizacion.
Variables extra minimas: inmovilizaciones, protesis, drenajes, dolor, ayudas tecnicas, riesgo de caida.
Escalas sugeridas: dolor, riesgo de caida, funcionalidad local.
Eventos a anticipar: sindrome compartimental, sangrado, TVP/TEP, caida, perdida funcional.
Regla de overlay: priorizar movilizacion segura y control neurovascular.
Vector ICEA+: seguridad funcional, carga de movilizacion.

## 10.5. Nefrologia / Urologia

Cruce tipico: dialisis, planta, trasplante renal, post-urologico.
Foco dominante: balance hidrico, accesos, diuresis, electrolitos, riesgo infeccioso.
Variables extra minimas: dialisis, diuresis, acceso vascular, urostomias, hematuria, trasplante, balance.
Escalas sugeridas: balance hidrico local, dolor.
Eventos a anticipar: sobrecarga, hiperK, obstruccion, infeccion, sangrado.
Regla de overlay: elevar criticidad del balance y del acceso.
Vector ICEA+: vigilancia hidroelectrolitica, seguridad de acceso.

## 10.6. Gastroenterologia / Hepatologia

Cruce tipico: planta digestiva, hepatologia, endoscopia.
Foco dominante: sangrado digestivo, encefalopatia, nutricion, ostomias, drenajes, dolor abdominal.
Variables extra minimas: sangrado, deposiciones, ostomia, drenajes, funcion hepatica clinica, ascitis.
Escalas sugeridas: dolor, balance, escalas locales digestivas.
Eventos a anticipar: hemorragia digestiva, encefalopatia, perforacion, sepsis abdominal.
Regla de overlay: dar peso alto a cambio de estado mental en hepatopatia y sangrado activo.
Vector ICEA+: vigilancia digestiva/hepatica, carga de manejo de dispositivos y eliminacion.

## 10.7. Endocrinologia / Diabetes compleja

Cruce tipico: planta, urgencias, ambulatorio.
Foco dominante: hipoglucemia/hiperglucemia, crisis metabolicas, educacion y autocuidado.
Variables extra minimas: pauta insulinica, glicemias, bomba/CGM, ingesta, cetosis si aplica.
Escalas sugeridas: glucemia seriada, dolor si aplica.
Eventos a anticipar: hipoglucemia severa, cetoacidosis, descompensacion hiperosmolar, error de dosificacion.
Regla de overlay: priorizar seguridad metabolica y adherencia.
Vector ICEA+: educacion, vigilancia metabolica, prevencion.

## 10.8. Neumologia

Cruce tipico: planta, UCI respiratoria, rehabilitacion, ambulatorio.
Foco dominante: intercambio gaseoso, secreciones, VM prolongada, tolerancia respiratoria.
Variables extra minimas: oxigeno, dispositivo respiratorio, secreciones, gasometria si existe fuente, fisioterapia respiratoria.
Escalas sugeridas: NEWS2, disnea, escalas respiratorias locales.
Eventos a anticipar: insuficiencia respiratoria, fatiga, broncoaspiracion, fracaso de soporte.
Regla de overlay: elevar peso del deterioro respiratorio y del soporte activo.
Vector ICEA+: vigilancia respiratoria, dependencia de soporte.

## 10.9. Infectologia

Cruce tipico: planta, UCI, aislamiento, ambulatorio VIH.
Foco dominante: aislamiento, multirresistencia, adherencia, sepsis, vigilancia de focos.
Variables extra minimas: aislamiento, foco infeccioso, antimicrobianos, estado inmunologico, adherencia si aplica.
Escalas sugeridas: NEWS2, dolor, escalas locales.
Eventos a anticipar: sepsis, fallo terapeutico, deterioro rapido, transmision cruzada.
Regla de overlay: reforzar alertas de aislamiento y reevaluacion.
Vector ICEA+: seguridad infecciosa, carga de vigilancia y prevencion.

## 10.10. Pediatria y subespecialidades

Cruce tipico: hospitalizacion pediatrica, UCIP, ambulatorio, onco-pediatria.
Foco dominante: edad/peso, respiracion, hidratacion, dolor, rol del cuidador.
Variables extra minimas: peso, edad, tolerancia oral, soporte parental, dosificacion por kg.
Escalas sugeridas: PEWS, dolor pediatrico, escalas locales.
Eventos a anticipar: deshidratacion, deterioro rapido, error de dosis, baja adherencia familiar.
Regla de overlay: priorizar variacion respecto al basal y seguridad farmacologica.
Vector ICEA+: dependencia familiar, vigilancia pediatrica, seguridad.

## 10.11. Ginecologia y Obstetricia

Cruce tipico: planta, materno-perinatal, recuperacion.
Foco dominante: sangrado, dolor, infeccion, lactancia, adaptacion puerperal.
Variables extra minimas: sangrado, involucion uterina, analgesia, lactancia, apoyo.
Escalas sugeridas: MEOWS local, dolor.
Eventos a anticipar: hemorragia, infeccion, complicacion posquirurgica/obstetrica.
Regla de overlay: elevar criticidad del sangrado y del binomio madre-hijo cuando aplique.
Vector ICEA+: seguridad obstetrica, educacion, continuidad.

## 10.12. Oftalmologia / Otorrinolaringologia

Cruce tipico: postoperatorio, ambulatorio.
Foco dominante: dolor, sangrado localizado, dispositivos, instrucciones de alta.
Variables extra minimas: procedimiento, curacion, drenajes/taponamiento, vision/audicion funcional, analgesia.
Escalas sugeridas: dolor, escalas locales.
Eventos a anticipar: sangrado, obstruccion, dolor no controlado, incumplimiento de cuidados.
Regla de overlay: reforzar educacion y control de complicaciones tempranas.
Vector ICEA+: continuidad, educacion, seguridad postprocedimiento.

## 10.13. Cirugia plastica / Quemados

Cruce tipico: unidad de quemados, quirofano, recuperacion, planta.
Foco dominante: superficie afectada, dolor, fluidos, riesgo infeccioso, injertos, soporte emocional.
Variables extra minimas: superficie quemada, curaciones, injertos, fluidos, analgesia, aislamiento.
Escalas sugeridas: dolor, balance, escalas locales de quemados.
Eventos a anticipar: sepsis, dolor extremo, perdida de injerto, desequilibrio hidrico.
Regla de overlay: peso alto de dolor, balance y vigilancia de injerto.
Vector ICEA+: complejidad curativa, vigilancia intensiva, carga sintomatica.

## 10.14. Trasplante de organos solidos

Cruce tipico: UCI o planta; corazon, higado, rinon, pancreas.
Foco dominante: inmunosupresion, rechazo, infeccion, balance, vigilancia del injerto.
Variables extra minimas: tipo de injerto, inmunosupresores, drenajes, balance, funcion del organo, aislamiento.
Escalas sugeridas: balance, dolor, escalas locales por organo.
Eventos a anticipar: rechazo agudo, sepsis, sangrado, fallo del injerto.
Regla de overlay: priorizar riesgo biologico y tareas criticas de vigilancia del injerto.
Vector ICEA+: vigilancia compleja, riesgo biologico, continuidad critica.

---

# 11. MPAC - Motor de Priorizacion y Anticipacion Contextual

## 11.1. Definicion

MPAC es el motor que convierte:

- datos comunes del Core,
- contexto de unidad,
- overlay de especialidad,
- riesgos y pendientes,

en prioridades, alertas y sintesis accionables.

## 11.2. Secuencia de maduracion

MPAC no debe empezar como caja negra.

Orden obligatorio:

- reglas clinicas explicitas,
- pesos contextuales por perfil,
- ranking explicable,
- alertas contextuales,
- validacion clinica de campo,
- solo despues: ML/XAI si procede.

## 11.3. Variables nucleares minimas

- inestabilidad actual,
- riesgo de deterioro proximo,
- dependencia/vigilancia requerida,
- carga terapeutica,
- criticidad temporal de pendientes,
- riesgo de omision,
- complejidad de coordinacion,
- modificadores de unidad,
- modificadores de especialidad.

## 11.4. Formula conceptual

```text
Prioridad enfermera contextual =
inestabilidad actual
+ riesgo de deterioro proximo
+ dependencia / vigilancia requerida
+ criticidad temporal de pendientes
+ carga terapeutica
+ modificadores de unidad
+ modificadores de especialidad
```

## 11.5. Restricciones

- no confundir prioridad enfermera con gravedad medica pura,
- no usar una unica escala universal como sustituto del juicio de contexto,
- no emitir decisiones irreversibles,
- no ocultar el razonamiento de la salida.

## 11.6. Salidas minimas de MPAC

- top pacientes prioritarios,
- eventos a anticipar,
- pendientes no delegables,
- criterios de aviso/escalado,
- resumen breve accionable,
- motivo visible de la priorizacion.

---

# 12. Interfaz y experiencia clinica

## 12.1. Regla general

La especializacion debe cambiar la lectura y la priorizacion, no multiplicar pantallas.

## 12.2. Siempre visible

- SBAR
- signos vitales
- riesgos
- dispositivos
- pendientes
- resumen final

## 12.3. Visible segun perfil

Solo se muestran campos y secciones que cambian el juicio enfermero del turno.

## 12.4. Invisible salvo necesidad

- campos redundantes,
- secciones no aplicables,
- listas completas si el dato ya esta en HCE/FHIR,
- texto libre innecesario.

## 12.5. Proposito UX

Reducir:

- carga cognitiva,
- omision,
- duplicacion documental,
- navegacion irrelevante.

---

# 13. Interoperabilidad y contratos

## 13.1. Principio

Toda expansion clinica debe mantenerse compatible con:

- validacion existente,
- mapeo FHIR,
- flujo offline-first,
- contratos del backend,
- exportacion futura a ICEA+.

## 13.2. Semantica preferente

- HL7 FHIR
- SNOMED CT
- LOINC
- NANDA / NIC / NOC cuando aplique
- OMOP en capa analitica si corresponde

## 13.3. Patron de flujo esperado

```text
UI enfermera
-> validacion
-> mapping semantico/FHIR
-> bundle
-> cola offline
-> servidor clinico / repositorio
-> MPAC / explotacion
-> exportacion analitica ICEA+
```

---

# 14. ICEA+ Layer

## 14.1. Definicion

ICEA+ es una capa analitica de atribucion y gestion del valor enfermero ajustado.

No mide cantidad de campos ni cantidad simple de tareas.

## 14.2. Variables minimas exportables desde HANDOVER

Cada UPP/SOP debe proyectarse, cuando corresponda, sobre:

- complejidad basal,
- intensidad de vigilancia,
- carga terapeutica,
- criticidad temporal,
- continuidad del cuidado,
- intervencion realizada,
- resultado observado,
- riesgo prevenido,
- carga educativa/familiar,
- coordinacion requerida.

## 14.3. Regla critica

Toda comparacion entre unidades, turnos o equipos requiere ajuste por:

- severidad basal,
- comorbilidad,
- agudeza,
- dependencia,
- contexto asistencial,
- skill-mix cuando aplique.

## 14.4. Estado de despliegue recomendado

- explotacion descriptiva y dashboards de proceso,
- shadow mode,
- ajuste por complejidad,
- inferencia/atribucion explicable,
- validacion prospectiva,
- solo despues: usos institucionales sensibles.

---

# 15. Gobernanza clinica, etica y de fairness

## 15.1. Minimos obligatorios

- comite clinico-enfermero para validar cada UPP,
- trazabilidad de version por perfil,
- trazabilidad de reglas MPAC,
- auditoria de fairness,
- override humano explicito,
- revision de sesgos por unidad, turno, case-mix y skill-mix.

## 15.2. Lo que no debe ocurrir

- convertir cada servicio en un formulario distinto e incompatible,
- usar prioridad enfermera como sinonimo simplista de gravedad medica,
- penalizar unidades complejas sin ajuste por case-mix, dotacion y flujo,
- desplegar IA opaca antes de consolidar reglas y trazabilidad,
- usar ICEA+ con finalidad punitiva o salarial precoz.

---

# 16. Roadmap de implementacion

## Fase 1 - Cierre del Core

Objetivo:

- consolidar nucleo comun,
- validacion Zod/FHIR,
- catalogo base,
- seguridad,
- cierre de turno,
- datos administrativos de unidad.

## Fase 2 - Packs prioritarios

Desplegar primero:

1. UCI
2. Medicina Interna / hospitalizacion general
3. Urgencias

Luego:

4. Oncologia (EOPROP-IA)
5. Quirurgico
6. Materno-perinatal

## Fase 3 - Overlay de especialidad

Activar SOP donde realmente cambie juicio clinico y vigilancia.

## Fase 4 - MPAC hibrido

Partir por reglas explicitas + pesos contextuales. Incorporar IA explicable solo tras validar desempeno clinico.

## Fase 5 - ICEA+ escalado

Consumir datos transaccionales y proyectarlos a complejidad, carga, continuidad y valor ajustados por case-mix.

---

# 17. Definition of Done clinica para cambios multiunidad

Un cambio multiunidad/multiespecialidad esta terminado solo si:

- no rompe el Core,
- no crea formularios paralelos,
- activa perfil u overlay de forma configurable,
- respeta contratos de validacion,
- respeta mapeo FHIR,
- genera salidas visibles coherentes,
- deja trazabilidad de reglas,
- define vector ICEA+ exportable,
- anade pruebas razonables,
- actualiza documentacion.

---

# 18. Reglas de decision para cualquier implementacion

Antes de tocar codigo, responder internamente:

- Esto amplia el Core o lo duplica?
- Esto corresponde a UPP, SOP o MPAC?
- Estoy pidiendo a enfermeria un dato que ya existe?
- Estoy anadiendo campos que no cambian la decision del turno?
- La salida sera explicable?
- ICEA+ podra leer esto de forma comparable?
- Estoy aumentando carga o reduciendola?

Si la respuesta indica fragmentacion, duplicacion o sobrecarga, redisenar antes de codificar.

---

# 19. Principio rector final

La direccion correcta del proyecto es:

**un nucleo comun de relevo, multiples perfiles clinicos configurables, priorizacion contextual explicable y una capa ICEA+ ajustada por case-mix.**

Nunca convertir HANDOVER en una coleccion de formularios independientes por servicio.

---

## Como se lo das a Codex
En la **misma rama**, despues del push, arrancas la tarea con algo como esto:

```text
Lee primero AGENTS.md y docs/clinical-profiles-framework.md.
Aplica la cirugia guardrail definida en AGENTS.md.
No reinventes la arquitectura.
Trabaja sobre el estado real actual del repo HANDOVER.
Implementa solo el cambio pedido en esta tarea y manten coherencia con Core + UPP + SOP + MPAC + ICEA+.
```
